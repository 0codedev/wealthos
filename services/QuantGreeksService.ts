import { StrikeData, OptionChainSnapshot } from './OptionChainService';

export interface GEXData {
    netGex: number;
    zeroGammaLevel: number;
    maxPain: number;
    regime: 'TRENDING' | 'PINNING';
}

export interface QCSComponents {
    gFactor: number;
    convictionIndex: number;
    greekFlowImbalance: number;
    maxPainGravity: number;
    vrpFactor: number;
    ivSkewFactor: number;
}

export interface QCSResult {
    qcs: number;
    grade: 'ELITE' | 'STRONG_BULLISH' | 'MODERATE' | 'NEUTRAL' | 'AVOID';
    components: QCSComponents;
    entryChecks: Record<string, boolean>; // 6-check entry gate
    holdSignal: boolean;
    exitTriggers: string[];
    isPartial: boolean;
}

export interface EntryGate {
    checks: Record<string, boolean>;
    passedCount: number;
    approved: boolean;
}

export interface PositionSignal {
    holdSignal: boolean;
    exitTriggers: string[];
    exitUrgency: 'NORMAL' | 'URGENT';
}

export interface DWOIResult {
    ceDwoiSum: number;
    peDwoiSum: number;
    deltaAdjustedPcr: number;
}

export interface VRPData {
    vrp: number;
    regime: 'PREMIUM_SELLER_FAVORABLE' | 'LONG_GAMMA_FAVORABLE' | 'NEUTRAL';
}

export interface IVSkewData {
    skew: number;
    rank: number | null;
}

export interface IVRankData {
    symbol: string;
    current_iv: number;
    iv_rank: number;
    iv_percentile: number;
    "52w_high_iv": number;
    "52w_low_iv": number;
    mean_iv: number;
    samples_count: number;
    regime: string;
}

export interface HeroZeroCandidate {
    strike: number;
    option_type: 'CE' | 'PE';
    instrument_key: string;
    ltp: number;
    delta: number;
    gamma: number;
    speed: number;
    volga: number;
    oi: number;
    volume: number;
    convexity_score: number;
    entry_price: number;
    target_1: number;
    target_2: number;
    stop_loss: number;
    risk_reward: string;
    dealer_alignment: string;
    mandatory_exit: string;
}

export interface HeroZeroResponse {
    symbol: string;
    expiry?: string;
    spot: number;
    net_gex_crores: number;
    zero_gamma_level: number;
    market_phase: string;
    survival_fraction_u: number;
    risk_parity_er: number;
    risk_parity_breached: boolean;
    actionable_signal: boolean;
    candidates_count: number;
    candidates: HeroZeroCandidate[];
    rules: {
        entry_window: string;
        profit_taking: string;
        hard_stop: string;
        hard_square_off: string;
    };
}

export class QuantGreeksService {
    private static instance: QuantGreeksService;
    private prevNetGex: Record<string, number> = {};
    private prevVEX: Record<string, number> = {};

    private constructor() {}

    public static getInstance(): QuantGreeksService {
        if (!QuantGreeksService.instance) {
            QuantGreeksService.instance = new QuantGreeksService();
        }
        return QuantGreeksService.instance;
    }

    /**
     * P0.2 — Implement computeDWOI
     */
    public computeDWOI(snapshot: OptionChainSnapshot): DWOIResult {
        let ceDwoiSum = 0;
        let peDwoiSum = 0;

        if (snapshot && snapshot.strikes) {
            for (const strike of snapshot.strikes) {
                if (strike.CE) {
                    const oi = strike.CE.oi ?? 0;
                    const delta = strike.CE.delta ?? 0;
                    ceDwoiSum += oi * Math.abs(delta);
                }
                if (strike.PE) {
                    const oi = strike.PE.oi ?? 0;
                    const delta = strike.PE.delta ?? 0;
                    peDwoiSum += oi * Math.abs(delta);
                }
            }
        }

        const deltaAdjustedPcr = ceDwoiSum > 0 ? peDwoiSum / ceDwoiSum : (peDwoiSum > 0 ? 99.0 : 1.0);

        return {
            ceDwoiSum: Math.round(ceDwoiSum * 100) / 100,
            peDwoiSum: Math.round(peDwoiSum * 100) / 100,
            deltaAdjustedPcr: Math.round(deltaAdjustedPcr * 100) / 100
        };
    }

    /**
     * P0.3 — Implement computeGEX
     */
    public computeGEX(snapshot: OptionChainSnapshot, lotSize: number, spotPrice: number): GEXData {
        const spot = spotPrice || snapshot.underlyingValue || 0;
        let netGex = 0;
        const strikeGexMap: { strike: number; gex: number }[] = [];

        if (snapshot && snapshot.strikes && spot > 0) {
            for (const strike of snapshot.strikes) {
                const strikePrice = strike.strikePrice;
                let strikeGex = 0;

                // Calls: dealer short = negative gamma exposure
                if (strike.CE) {
                    const callOi = strike.CE.oi ?? 0;
                    const callGamma = strike.CE.gamma ?? 0;
                    const callDealerGamma = -callOi * callGamma;
                    strikeGex += callDealerGamma * lotSize * spot * spot * 0.01;
                }

                // Puts: dealer short = positive gamma exposure (under put-call sign convention)
                if (strike.PE) {
                    const putOi = strike.PE.oi ?? 0;
                    const putGamma = strike.PE.gamma ?? 0;
                    const putDealerGamma = putOi * putGamma;
                    strikeGex += putDealerGamma * lotSize * spot * spot * 0.01;
                }

                netGex += strikeGex;
                strikeGexMap.push({ strike: strikePrice, gex: strikeGex });
            }
        }

        // Zero-Gamma Level (ZGL): find where cumulative GEX flips sign
        // Sort strikes ascending
        strikeGexMap.sort((a, b) => a.strike - b.strike);
        let zeroGammaLevel = spot;
        let runningGex = 0;
        let prevRunningGex = 0;
        let foundCrossover = false;

        for (let i = 0; i < strikeGexMap.length; i++) {
            runningGex += strikeGexMap[i].gex;
            if (i > 0) {
                // Check for crossover (sign change)
                if ((prevRunningGex < 0 && runningGex >= 0) || (prevRunningGex > 0 && runningGex <= 0)) {
                    // Linear interpolation to find closer strike
                    const distPrev = Math.abs(prevRunningGex);
                    const distCurr = Math.abs(runningGex);
                    zeroGammaLevel = distPrev < distCurr ? strikeGexMap[i-1].strike : strikeGexMap[i].strike;
                    foundCrossover = true;
                    break;
                }
            }
            prevRunningGex = runningGex;
        }

        // Fallback if no crossover found: strike closest to cumulative sum zero or ATM
        if (!foundCrossover && strikeGexMap.length > 0) {
            let minAbsGex = Infinity;
            let closestStrike = spot;
            let tempSum = 0;
            for (const item of strikeGexMap) {
                tempSum += item.gex;
                if (Math.abs(tempSum) < minAbsGex) {
                    minAbsGex = Math.abs(tempSum);
                    closestStrike = item.strike;
                }
            }
            zeroGammaLevel = closestStrike;
        }

        const regime = netGex < 0 ? 'TRENDING' : 'PINNING';

        return {
            netGex: Math.round(netGex * 100) / 100,
            zeroGammaLevel,
            maxPain: snapshot.maxPain || spot,
            regime
        };
    }

    /**
     * P1.1 — Implement computeConvictionIndex
     */
    public computeConvictionIndex(snapshot: OptionChainSnapshot, spotPrice: number, avgOI20d: number): number {
        const spot = spotPrice || snapshot.underlyingValue || 0;
        if (spot === 0 || avgOI20d <= 0 || !snapshot.strikes) return 0;

        let totalCE_DeltaOI = 0;
        let totalPE_DeltaOI = 0;
        let sumGammaVolume = 0;
        let sumVolume = 0;
        let totalOI = 0;
        let atmIV = 0.15; // default 15% IV decimal

        // Find ATM strike to get ATM IV
        let minAtmDist = Infinity;
        
        for (const strike of snapshot.strikes) {
            const ce = strike.CE;
            const pe = strike.PE;
            const strikePrice = strike.strikePrice;
            const dist = Math.abs(strikePrice - spot);
            
            if (dist < minAtmDist) {
                minAtmDist = dist;
                const ceIv = ce?.iv && ce.iv > 0 ? ce.iv / 100 : 0;
                const peIv = pe?.iv && pe.iv > 0 ? pe.iv / 100 : 0;
                if (ceIv > 0 && peIv > 0) {
                    atmIV = (ceIv + peIv) / 2;
                } else if (ceIv > 0) {
                    atmIV = ceIv;
                } else if (peIv > 0) {
                    atmIV = peIv;
                }
            }

            if (ce) {
                totalOI += ce.oi ?? 0;
                totalCE_DeltaOI += (ce.oi ?? 0) * Math.abs(ce.delta ?? 0);
                if (ce.gamma && ce.volume) {
                    sumGammaVolume += ce.gamma * ce.volume;
                    sumVolume += ce.volume;
                }
            }
            if (pe) {
                totalOI += pe.oi ?? 0;
                totalPE_DeltaOI += (pe.oi ?? 0) * Math.abs(pe.delta ?? 0);
                if (pe.gamma && pe.volume) {
                    sumGammaVolume += pe.gamma * pe.volume;
                    sumVolume += pe.volume;
                }
            }
        }

        const netDelta = totalCE_DeltaOI - totalPE_DeltaOI;
        const sign = netDelta > 0 ? 1 : (netDelta < 0 ? -1 : 0);
        
        const volumeWeightedGamma = sumVolume > 0 ? sumGammaVolume / sumVolume : 0.0001;
        const ivDenominator = atmIV * atmIV || 0.0225; // 15% IV squared = 0.0225
        const oiRatio = totalOI / avgOI20d;

        const rawCI = sign * (volumeWeightedGamma / ivDenominator) * oiRatio;
        
        // Clamp to approximately [-5, +5] range
        const ci = Math.max(-5, Math.min(5, rawCI));
        
        return Math.round(ci * 100) / 100;
    }

    /**
     * P1.2 — Implement computeGFI
     */
    public computeGFI(symbol: string, currentNetGex: number, currentVEX: number, dte: number): number {
        const prevGex = this.prevNetGex[symbol] !== undefined ? this.prevNetGex[symbol] : currentNetGex;
        const prevVex = this.prevVEX[symbol] !== undefined ? this.prevVEX[symbol] : currentVEX;

        const deltaGEX = currentNetGex - prevGex;
        const deltaVEX = currentVEX - prevVex;

        // CharmFlow approximation: 0 for DTE > 5, else simple estimate based on near-expiry decay pressure
        const charmFlow = dte <= 5 ? 0.05 * (6 - dte) : 0;

        const wGamma = 0.5;
        const wVega = 0.35;
        const wCharm = 0.15;

        // Normalize delta values to fit a sensible range (GEX is in millions/billions, VEX is in thousands)
        // Let's scale deltaGEX by 1e7 (Crores scale) and deltaVEX by 1e5
        const normDeltaGEX = deltaGEX / 10000000;
        const normDeltaVEX = deltaVEX / 100000;

        const rawGFI = wGamma * normDeltaGEX + wVega * normDeltaVEX + wCharm * charmFlow;

        // Store current values for the next tick
        this.prevNetGex[symbol] = currentNetGex;
        this.prevVEX[symbol] = currentVEX;

        // Clamp to [-5, +5]
        return Math.round(Math.max(-5, Math.min(5, rawGFI)) * 100) / 100;
    }

    /**
     * P1.3 / P2.5 — Implement computeQCS
     */
    public async computeQCS(symbol: string, gFactor: number, snapshot: OptionChainSnapshot, lotSize: number): Promise<QCSResult> {
        const spot = snapshot.underlyingValue || 0;
        
        // Calculate CI
        // For avgOI20d, fallback if missing (average F&O stock has about 2,000,000 lots OI)
        const avgOI20d = 2000000;
        const ci = this.computeConvictionIndex(snapshot, spot, avgOI20d);

        // Calculate VEX to pass to GFI
        let currentVEX = 0;
        let atmStrike = spot;
        let minAtmDist = Infinity;
        if (snapshot.strikes) {
            for (const strike of snapshot.strikes) {
                const dist = Math.abs(strike.strikePrice - spot);
                if (dist < minAtmDist) {
                    minAtmDist = dist;
                    atmStrike = strike.strikePrice;
                }
            }
            
            // Sum vega * OI for strikes around ATM (ATM +/- 2 strikes)
            for (const strike of snapshot.strikes) {
                if (Math.abs(strike.strikePrice - atmStrike) <= 200) { // approx +/- 2 strikes for standard 50/100 intervals
                    if (strike.CE) {
                        currentVEX += (strike.CE.vega ?? 0) * (strike.CE.oi ?? 0);
                    }
                    if (strike.PE) {
                        currentVEX += (strike.PE.vega ?? 0) * (strike.PE.oi ?? 0);
                    }
                }
            }
        }

        // Calculate GEX
        const gexData = this.computeGEX(snapshot, lotSize, spot);

        // Calculate GFI (assume DTE = 5 for mock/initial)
        const gfi = this.computeGFI(symbol, gexData.netGex, currentVEX, 5);

        // Normalize components to 0-10 scale
        const ciNorm = ci + 5; // [-5, 5] -> [0, 10]
        const gfiNorm = gfi + 5; // [-5, 5] -> [0, 10]

        // Fetch dynamic Phase 2 components
        let vrpFactor = 5.0; // default neutral
        let ivSkewFactor = 5.0; // default neutral
        let ivSkewRankVal: number | null = null;

        try {
            const vrpData = await this.fetchVRP(symbol);
            if (vrpData && vrpData.vrp !== undefined) {
                // Map VRP from normal range [-5, +15] to [0, 10]
                vrpFactor = Math.max(0, Math.min(10, (vrpData.vrp + 5) / 2));
            }
        } catch (e) {
            console.error("VRP fetch failed inside computeQCS:", e);
        }

        try {
            const skewData = await this.fetchIVSkew(symbol, '');
            if (skewData && skewData.rank !== null && skewData.rank !== undefined) {
                // Map skew rank (0-100) to 0-10
                ivSkewFactor = skewData.rank / 10;
                ivSkewRankVal = skewData.rank;
            }
        } catch (e) {
            console.error("IV Skew fetch failed inside computeQCS:", e);
        }

        // Calculate MPGS: (MaxPain - Spot) / (Spot * IV_ATM * sqrt(tau))
        // DTE-scaling prevents denominator distortion across 0-DTE to monthly expirations
        const maxPain = gexData.maxPain || spot;
        let atmIV = 0.15;
        if (snapshot.strikes) {
            const atmStrikeRow = snapshot.strikes.find(s => s.strikePrice === atmStrike);
            if (atmStrikeRow) {
                const ivCE = atmStrikeRow.CE?.iv ?? 0;
                const ivPE = atmStrikeRow.PE?.iv ?? 0;
                atmIV = (ivCE + ivPE) / 2 || 0.15;
            }
        }
        const dte = 5; // default weekly horizon
        const tau = Math.max(dte, 0.5) / 365.0;
        const expectedMove = spot * atmIV * Math.sqrt(tau);
        const rawMPGS = expectedMove > 0 ? (maxPain - spot) / expectedMove : 0;
        // Map rawMPGS from [-3σ, +3σ] to [0, 10]
        const mpgsFactor = Math.max(0, Math.min(10, (rawMPGS * 1.66) + 5));

        // Compute QCS
        const qcs = 0.30 * gFactor +
                    0.25 * ciNorm +
                    0.20 * gfiNorm +
                    0.10 * mpgsFactor +
                    0.10 * vrpFactor +
                    0.05 * ivSkewFactor;

        const finalQcs = Math.round(Math.max(0, Math.min(10, qcs)) * 10) / 10;

        let grade: QCSResult['grade'] = 'NEUTRAL';
        if (finalQcs >= 8.0) grade = 'ELITE';
        else if (finalQcs >= 6.0) grade = 'STRONG_BULLISH';
        else if (finalQcs >= 4.0) grade = 'MODERATE';
        else if (finalQcs >= 2.0) grade = 'NEUTRAL';
        else grade = 'AVOID';

        return {
            qcs: finalQcs,
            grade,
            components: {
                gFactor,
                convictionIndex: Math.round(ciNorm * 10) / 10,
                greekFlowImbalance: Math.round(gfiNorm * 10) / 10,
                maxPainGravity: Math.round(mpgsFactor * 10) / 10,
                vrpFactor: Math.round(vrpFactor * 10) / 10,
                ivSkewFactor: Math.round(ivSkewFactor * 10) / 10
            },
            entryChecks: {
                gFactorCheck: gFactor > 6.0,
                ciCheck: ci > 1.5,
                gexCheck: gexData.regime === 'TRENDING',
                gfiCheck: gfi > 1.0,
                mpgsCheck: Math.abs(rawMPGS) > 0.5,
                ivSkewCheck: ivSkewRankVal !== null ? ivSkewRankVal < 50 : true
            },
            holdSignal: true,
            exitTriggers: [],
            isPartial: false
        };
    }

    /**
     * Synchronous version of computeQCS for use inside render loops
     */
    public computeQCSSync(symbol: string, gFactor: number, snapshot: OptionChainSnapshot, lotSize: number): QCSResult {
        const spot = snapshot.underlyingValue || 0;
        
        // Calculate CI
        const avgOI20d = 2000000;
        const ci = this.computeConvictionIndex(snapshot, spot, avgOI20d);

        // Calculate VEX to pass to GFI
        let currentVEX = 0;
        let atmStrike = spot;
        let minAtmDist = Infinity;
        if (snapshot.strikes) {
            for (const strike of snapshot.strikes) {
                const dist = Math.abs(strike.strikePrice - spot);
                if (dist < minAtmDist) {
                    minAtmDist = dist;
                    atmStrike = strike.strikePrice;
                }
            }
            
            for (const strike of snapshot.strikes) {
                if (Math.abs(strike.strikePrice - atmStrike) <= 200) {
                    if (strike.CE) {
                        currentVEX += (strike.CE.vega ?? 0) * (strike.CE.oi ?? 0);
                    }
                    if (strike.PE) {
                        currentVEX += (strike.PE.vega ?? 0) * (strike.PE.oi ?? 0);
                    }
                }
            }
        }

        // Calculate GEX
        const gexData = this.computeGEX(snapshot, lotSize, spot);

        // Calculate GFI
        const gfi = this.computeGFI(symbol, gexData.netGex, currentVEX, 5);

        // Normalize
        const ciNorm = ci + 5;
        const gfiNorm = gfi + 5;

        // Calculate dynamic MPGS with DTE-scaling
        const maxPainSync = gexData.maxPain || spot;
        let atmIVSync = 0.15;
        if (snapshot.strikes) {
            const atmStrikeRow = snapshot.strikes.find(s => s.strikePrice === atmStrike);
            if (atmStrikeRow) {
                const ivCE = atmStrikeRow.CE?.iv ?? 0;
                const ivPE = atmStrikeRow.PE?.iv ?? 0;
                atmIVSync = (ivCE + ivPE) / 2 || 0.15;
            }
        }
        const dteSync = 5;
        const tauSync = Math.max(dteSync, 0.5) / 365.0;
        const expectedMoveSync = spot * atmIVSync * Math.sqrt(tauSync);
        const rawMPGSSync = expectedMoveSync > 0 ? (maxPainSync - spot) / expectedMoveSync : 0;
        const mpgsFactor = Math.max(0, Math.min(10, (rawMPGSSync * 1.66) + 5));

        const vrpFactor = 5.0;
        const ivSkewFactor = 5.0;

        const qcs = 0.30 * gFactor +
                    0.25 * ciNorm +
                    0.20 * gfiNorm +
                    0.10 * mpgsFactor +
                    0.10 * vrpFactor +
                    0.05 * ivSkewFactor;

        const finalQcs = Math.round(Math.max(0, Math.min(10, qcs)) * 10) / 10;

        let grade: QCSResult['grade'] = 'NEUTRAL';
        if (finalQcs >= 8.0) grade = 'ELITE';
        else if (finalQcs >= 6.0) grade = 'STRONG_BULLISH';
        else if (finalQcs >= 4.0) grade = 'MODERATE';
        else if (finalQcs >= 2.0) grade = 'NEUTRAL';
        else grade = 'AVOID';

        return {
            qcs: finalQcs,
            grade,
            components: {
                gFactor,
                convictionIndex: Math.round(ciNorm * 10) / 10,
                greekFlowImbalance: Math.round(gfiNorm * 10) / 10,
                maxPainGravity: mpgsFactor,
                vrpFactor,
                ivSkewFactor
            },
            entryChecks: {
                gFactorCheck: gFactor > 6.0,
                ciCheck: ci > 1.5,
                gexCheck: gexData.regime === 'TRENDING',
                gfiCheck: gfi > 1.0,
                mpgsCheck: true,
                ivSkewCheck: true
            },
            holdSignal: true,
            exitTriggers: [],
            isPartial: true
        };
    }

    /**
     * P2.5 — Fetch VRP
     */
    public async fetchVRP(symbol: string): Promise<VRPData> {
        try {
            const url = `/api/python-nse/api/greeks/vrp?symbol=${encodeURIComponent(symbol)}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`VRP HTTP error: ${response.status}`);
            const data = await response.json();
            return {
                vrp: data.vrp ?? 0,
                regime: data.regime ?? 'NEUTRAL'
            };
        } catch (e) {
            console.error(`fetchVRP failed for ${symbol}:`, e);
            return {
                vrp: 0,
                regime: 'NEUTRAL'
            };
        }
    }

    /**
     * P2.5 — Fetch IV Skew
     */
    public async fetchIVSkew(symbol: string, expiry: string): Promise<IVSkewData> {
        try {
            const expiryParam = expiry ? `&expiry=${encodeURIComponent(expiry)}` : '';
            const url = `/api/python-nse/api/greeks/skew?symbol=${encodeURIComponent(symbol)}${expiryParam}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`IVSkew HTTP error: ${response.status}`);
            const data = await response.json();
            return {
                skew: data.skew_raw ?? 0,
                rank: data.iv_skew_rank ?? null
            };
        } catch (e) {
            console.error(`fetchIVSkew failed for ${symbol}:`, e);
            return {
                skew: 0,
                rank: null
            };
        }
    }

    /**
     * WP01 — Fetch 52-Week IV Rank and Percentile
     */
    public async fetchIVRank(symbol: string, expiry?: string): Promise<IVRankData | null> {
        try {
            const expParam = expiry ? `&expiry=${encodeURIComponent(expiry)}` : '';
            const url = `/api/python-nse/api/greeks/iv-rank?symbol=${encodeURIComponent(symbol)}${expParam}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`IVRank HTTP error: ${response.status}`);
            return await response.json();
        } catch (e) {
            console.error(`fetchIVRank failed for ${symbol}:`, e);
            return null;
        }
    }

    /**
     * WP01 — Fetch 2:00 PM Hero-Zero Gamma Explosion Candidates
     */
    public async fetchHeroZeroCandidates(symbol = 'NIFTY', expiry?: string): Promise<HeroZeroResponse | null> {
        try {
            const expParam = expiry ? `&expiry=${encodeURIComponent(expiry)}` : '';
            const url = `/api/python-nse/api/greeks/hero-zero/candidates?symbol=${encodeURIComponent(symbol)}${expParam}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HeroZero HTTP error: ${response.status}`);
            return await response.json();
        } catch (e) {
            console.error(`fetchHeroZeroCandidates failed for ${symbol}:`, e);
            return null;
        }
    }

    /**
     * WP01 — Fetch In-Memory Strike Fusion Chain State
     */
    public async fetchChainState(symbol: string, expiry?: string, forceRefresh = false): Promise<any> {
        try {
            const expParam = expiry ? `&expiry=${encodeURIComponent(expiry)}` : '';
            const refreshParam = forceRefresh ? '&force_refresh=true' : '';
            const url = `/api/python-nse/api/greeks/chain-state?symbol=${encodeURIComponent(symbol)}${expParam}${refreshParam}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`ChainState HTTP error: ${response.status}`);
            return await response.json();
        } catch (e) {
            console.error(`fetchChainState failed for ${symbol}:`, e);
            return null;
        }
    }

    /**
     * P3.1 — Implement 6-check Entry Gate
     */
    public computeEntryGate(direction: 'LONG' | 'SHORT', qcsResult: QCSResult): EntryGate {
        const { components, entryChecks } = qcsResult;
        const checks: Record<string, boolean> = {};

        // 1. G-Factor check: > 6.0
        checks.gFactor = components.gFactor > 6.0;

        // 2. Conviction Index check: > 1.5 for LONG, < -1.5 for SHORT
        // Note: CI in components is normalized to 0-10 scale (ciNorm = ci + 5)
        const rawCI = components.convictionIndex - 5;
        checks.convictionIndex = direction === 'LONG' ? rawCI > 1.5 : rawCI < -1.5;

        // 3. GEX Regime check: negative GEX (trending) is preferred for momentum
        checks.gexRegime = entryChecks.gexCheck ?? false;

        // 4. GFI Flow check: > 1.0 for LONG, < -1.0 for SHORT
        const rawGFI = components.greekFlowImbalance - 5;
        checks.gfiFlow = direction === 'LONG' ? rawGFI > 1.0 : rawGFI < -1.0;

        // 5. MPGS check: below Max Pain (MPGS > 0.5) for LONG, above Max Pain (MPGS < -0.5) for SHORT
        const rawMPGS = components.maxPainGravity - 5;
        checks.mpgs = direction === 'LONG' ? rawMPGS > 0.5 : rawMPGS < -0.5;

        // 6. IV Skew Rank check: < 50 for LONG (no fear premium), > 60 for SHORT (fear elevated)
        const rank = components.ivSkewFactor * 10;
        checks.ivSkewRank = direction === 'LONG' ? rank < 50 : rank > 60;

        // Count checks that passed
        let passedCount = 0;
        for (const key of Object.keys(checks)) {
            if (checks[key]) passedCount++;
        }

        return {
            checks,
            passedCount,
            approved: passedCount >= 4
        };
    }

    /**
     * P3.3 — Implement Hold/Exit Signal monitor
     */
    public monitorPositionSignal(
        direction: 'LONG' | 'SHORT',
        entryQCS: QCSResult,
        currentQCS: QCSResult
    ): PositionSignal {
        const exitTriggers: string[] = [];
        
        const entryGexRegime = entryQCS.entryChecks.gexCheck ? 'TRENDING' : 'PINNING'; 
        const currentGexRegime = currentQCS.entryChecks.gexCheck ? 'TRENDING' : 'PINNING';
        
        const currentRawCI = currentQCS.components.convictionIndex - 5;
        const currentRawMPGS = currentQCS.components.maxPainGravity - 5;
        const currentSkewRank = currentQCS.components.ivSkewFactor * 10;
        
        if (direction === 'LONG') {
            // 1. GEX flips from negative (TRENDING) to positive (PINNING)
            if (entryGexRegime === 'TRENDING' && currentGexRegime === 'PINNING') {
                exitTriggers.push('GEX Regime flipped to PINNING');
            }
            
            // 2. CI drops below 0
            if (currentRawCI < 0) {
                exitTriggers.push('Conviction Index dropped below 0');
            }
            
            // 3. MPGS reversal (flips to below Max Pain, i.e. MPGS < 0)
            if (currentRawMPGS < 0) {
                exitTriggers.push('Max Pain Gravity reversed');
            }
        } else {
            // SHORT exits
            // 1. GEX flips
            if (entryGexRegime === 'PINNING' && currentGexRegime === 'TRENDING') {
                exitTriggers.push('GEX Regime flipped to TRENDING');
            }
            
            // 2. Skew Rank drops below 30
            if (currentSkewRank < 30) {
                exitTriggers.push('IV Skew Rank fell below 30');
            }
            
            // 3. CI rises above 0
            if (currentRawCI > 0) {
                exitTriggers.push('Conviction Index rose above 0');
            }
        }
        
        const holdSignal = exitTriggers.length === 0;
        let exitUrgency: PositionSignal['exitUrgency'] = 'NORMAL';
        if (exitTriggers.length >= 2) {
            exitUrgency = 'URGENT';
        }
        
        return {
            holdSignal,
            exitTriggers,
            exitUrgency
        };
    }
}

export const quantGreeksService = QuantGreeksService.getInstance();
