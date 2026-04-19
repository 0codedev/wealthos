import React, { useEffect, useState } from 'react';
import { mceOrchestrator } from '../../services/mce/orchestrator';
import { useMceStore } from '../../store/mceStore';
import { logger } from '../../services/Logger';

/**
 * ActionabilityRing - SPRINT 2.C1
 *
 * The single "should I proceed?" answer for a symbol. Fuses:
 *   1. MCS hit-prob snapshot (the nightly-trained FIRE/WAIT model) — 50%
 *   2. Pool verdict score (0-100 conviction)                    — 30%
 *   3. Level proximity: distance of live price to the planned
 *      entry (targetBuyPrice)                                   — 20%
 *
 * Output: one ring, one number, one label (FIRE / BUILDP / WAIT / —).
 * MCS is fetched on mount via mceOrchestrator.score() which internally
 * dedupes; failures degrade gracefully to verdict+proximity only.
 */

interface ActionabilityRingProps {
    ticker: string;
    lastPrice?: number;
    targetBuy?: number;
    verdictScore?: number | null;
    size?: number;
    proximityPct?: number;
    isBreached?: boolean;
}

const WEIGHT_MCS = 0.5;
const WEIGHT_VERDICT = 0.3;
const WEIGHT_PROXIMITY = 0.2;

export const ActionabilityRing: React.FC<ActionabilityRingProps> = ({
    ticker,
    lastPrice,
    targetBuy,
    verdictScore,
    size = 46,
    proximityPct,
    isBreached
}) => {
    const snapshot = useMceStore((s) => s.preEntrySnapshots.get(ticker.toUpperCase()));
    const [mcsFailed, setMcsFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const sym = ticker.toUpperCase();
        // Fetch if we have nothing cached for this symbol yet.
        if (!useMceStore.getState().preEntrySnapshots.get(sym)) {
            mceOrchestrator.score(sym, 'PRE_ENTRY')
                .then((snap) => {
                    if (!cancelled && snap) {
                        useMceStore.getState().setPreEntrySnapshot(sym, snap);
                    } else if (!cancelled && !snap) {
                        setMcsFailed(true);
                    }
                })
                .catch((e) => {
                    if (!cancelled) {
                        setMcsFailed(true);
                        logger.debug(`[ActionabilityRing] MCS unavailable for ${sym}:`, e);
                    }
                });
        }
        return () => { cancelled = true; };
    }, [ticker]);

    const mcsScore: number | null = snapshot?.score?.total != null ? Number(snapshot.score.total) : null;
    const mcsVerdict: 'FIRE' | 'WAIT' | null = snapshot?.score?.verdict === 'FIRE' || snapshot?.score?.verdict === 'WAIT'
        ? snapshot.score.verdict
        : null;

    // Level proximity: 100 at/below entry, decays ~20 pts per 1% above it.
    let proximity: number | null = null;
    const effDist = proximityPct != null ? proximityPct : (lastPrice && targetBuy && targetBuy > 0 ? ((lastPrice - targetBuy) / targetBuy) * 100 : null);
    if (effDist != null) {
        proximity = Math.max(0, Math.min(100, 100 - Math.abs(effDist) * 20));
    }

    // Composite with graceful degradation over missing inputs.
    let parts = 0, sum = 0;
    if (mcsScore != null && !mcsFailed) { sum += mcsScore * WEIGHT_MCS; parts += WEIGHT_MCS; }
    if (verdictScore != null && Number.isFinite(verdictScore)) { sum += Math.max(0, Math.min(100, verdictScore)) * WEIGHT_VERDICT; parts += WEIGHT_VERDICT; }
    if (proximity != null) { sum += proximity * WEIGHT_PROXIMITY; parts += WEIGHT_PROXIMITY; }
    const composite = isBreached ? 100 : (parts > 0 ? Math.round(sum / parts) : null);

    // 4-Tier Visual States: Breached -> Close (<0.5%) -> In Range (1-3%) -> Far
    const isClose = effDist != null && Math.abs(effDist) <= 0.5;
    const isMid = effDist != null && Math.abs(effDist) <= 3.0;

    let label = '-';
    let color = '#64748b';
    let ringClass = '';

    if (isBreached) {
        label = 'HIT';
        color = '#10b981';
        ringClass = 'ring-2 ring-emerald-500/40 animate-pulse';
    } else if (isClose) {
        label = 'NEAR';
        color = '#f59e0b';
        ringClass = 'ring-2 ring-amber-500/30 animate-pulse';
    } else if (composite != null) {
        label = (mcsVerdict === 'FIRE' || composite >= 70) ? 'FIRE' : composite >= 45 ? 'BUILD' : 'WAIT';
        color = label === 'FIRE' ? '#10b981' : label === 'BUILD' ? (isMid ? '#818cf8' : '#f59e0b') : '#94a3b8';
    }

    const r = size / 2 - 4;
    const circumference = 2 * Math.PI * r;
    const dash = composite == null ? 0 : (composite / 100) * circumference;

    return (
        <div
            title={composite == null
                ? `${ticker}: actionability unavailable`
                : `${ticker} actionability ${composite}/100 - MCS ${mcsScore ?? 'n/a'}${mcsVerdict ? ` (${mcsVerdict})` : ''}, verdict ${verdictScore ?? 'n/a'}, distance ${effDist != null ? `${effDist.toFixed(1)}%` : 'n/a'}`}
            className={`relative inline-flex items-center justify-center shrink-0 rounded-full ${ringClass}`}
            style={{ width: size, height: size }}
        >
            <svg width={size} height={size} className="-rotate-90">
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={3.5}
                    className="text-slate-200 dark:text-slate-700" />
                <circle
                    cx={size / 2} cy={size / 2} r={r} fill="none"
                    stroke={color} strokeWidth={3.5} strokeLinecap="round"
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    style={{ transition: 'stroke-dasharray 400ms ease, stroke 300ms ease' }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
                <span className="font-black tabular-nums text-slate-800 dark:text-slate-100" style={{ fontSize: size * 0.26 }}>
                    {isBreached ? '100' : (composite ?? '-')}
                </span>
                <span style={{ fontSize: size * 0.155, color }} className="font-bold tracking-wider mt-0.5">
                    {label}
                </span>
            </div>
        </div>
    );
};
