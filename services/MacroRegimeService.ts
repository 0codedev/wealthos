/**
 * WealthOS Macro Regime Service
 * TypeScript service to consume python-bridge /api/macro endpoints.
 */

export interface MacroRegimeResult {
  status: string;
  regime: 'STRONG_BULL' | 'BULL' | 'NEUTRAL' | 'BEAR' | 'STRONG_BEAR';
  probability_positive: number;
  expected_return_pct: number;
  confidence_interval_95: [number, number];
  var_95_pct: number;
  cvar_95_pct: number;
  last_updated_month: string;
}

export interface MacroWeights {
  status: string;
  regime: string;
  weight_modifiers: {
    g_factor: number;
    ci: number;
    gex: number;
    gfi: number;
    mpgs: number;
    iv_skew: number;
  };
}

export interface MacroDriver {
  feature: string;
  importance: number;
}

export interface MonthlyReport {
  status: string;
  regime: string;
  expected_return_pct: number;
  probability_positive: number;
  confidence_interval_95: [number, number];
  var_95_pct: number;
  cvar_95_pct: number;
  top_macro_drivers: MacroDriver[];
  training_samples: number;
  data_start: string;
  data_end: string;
}

export class MacroRegimeService {
  private static instance: MacroRegimeService;
  private baseUrl = '/api/python-nse/api/macro';

  public constructor() {}

  public static getInstance(): MacroRegimeService {
    if (!MacroRegimeService.instance) {
      MacroRegimeService.instance = new MacroRegimeService();
    }
    return MacroRegimeService.instance;
  }

  public getRegimeConfig(regime: string) {
    const r = (regime || 'NEUTRAL').toUpperCase();
    switch (r) {
      case 'STRONG_BULL':
        return {
          name: 'Strong Bullish',
          label: 'Strong Bullish',
          color: 'from-emerald-600/30 to-emerald-900/30',
          bg: 'bg-emerald-500/10',
          text: 'text-emerald-400',
          border: 'border-emerald-500/30',
          icon: 'TrendingUp',
          description: 'High positive momentum, low volatility environment. Aggressive long positioning favoured.',
          preferredSetups: ['Breakout Long', 'Trend Following', 'Bull Spreads']
        };
      case 'BULL':
        return {
          name: 'Bullish',
          label: 'Bullish',
          color: 'from-emerald-600/20 to-teal-900/20',
          bg: 'bg-emerald-500/10',
          text: 'text-emerald-400',
          border: 'border-emerald-500/30',
          icon: 'TrendingUp',
          description: 'Favourable market trend with controlled risk. Standard long strategies active.',
          preferredSetups: ['Dip Buying', 'Call Spreads', 'Momentum']
        };
      case 'STRONG_BEAR':
        return {
          name: 'Strong Bearish',
          label: 'Strong Bearish',
          color: 'from-rose-600/30 to-rose-900/30',
          bg: 'bg-rose-500/10',
          text: 'text-rose-400',
          border: 'border-rose-500/30',
          icon: 'TrendingDown',
          description: 'High volatility selloff regime. Hedging and short exposure strongly advised.',
          preferredSetups: ['Short Momentum', 'Put Buying', 'Cash Preservation']
        };
      case 'BEAR':
        return {
          name: 'Bearish',
          label: 'Bearish',
          color: 'from-rose-600/20 to-amber-900/20',
          bg: 'bg-rose-500/10',
          text: 'text-rose-400',
          border: 'border-rose-500/30',
          icon: 'TrendingDown',
          description: 'Downside pressure present. Strict stop losses and reduced position sizing active.',
          preferredSetups: ['Bear Spreads', 'Hedged Shorts']
        };
      default:
        return {
          name: 'Neutral / Rangebound',
          label: 'Neutral',
          color: 'from-slate-600/20 to-indigo-900/20',
          bg: 'bg-amber-500/10',
          text: 'text-amber-400',
          border: 'border-amber-500/30',
          icon: 'Activity',
          description: 'Sideways price action with balanced risk. Range trading & delta neutral strategies preferred.',
          preferredSetups: ['Iron Condor', 'VWAP Mean Reversion', 'Straddles']
        };
    }
  }

  public classifyRegime(vixOrIndicators?: any, returnPct: number = 0): 'STRONG_BULL' | 'BULL' | 'NEUTRAL' | 'BEAR' | 'STRONG_BEAR' {
    let vix = 15;
    if (typeof vixOrIndicators === 'number') {
      vix = vixOrIndicators;
    } else if (Array.isArray(vixOrIndicators)) {
      const vixInd = vixOrIndicators.find((i: any) => i.name?.includes('VIX') || i.symbol?.includes('VIX'));
      if (vixInd) vix = Number(vixInd.value || vixInd.price || 15);
    }
    if (vix < 14 && returnPct >= 0) return 'STRONG_BULL';
    if (vix < 18) return 'BULL';
    if (vix > 24) return 'STRONG_BEAR';
    if (vix > 20) return 'BEAR';
    return 'NEUTRAL';
  }

  public filterSignalsForRegime(signals: any[], regime: string): any[] {
    if (!signals || !Array.isArray(signals)) return [];
    if (!regime || regime === 'ALL' || regime === 'NEUTRAL') return signals;
    return signals.filter((s: any) => {
      const dir = (s.direction || s.action || s.type || '').toUpperCase();
      if (regime.includes('BULL')) return dir === 'BUY' || dir === 'LONG' || dir === 'BULLISH';
      if (regime.includes('BEAR')) return dir === 'SELL' || dir === 'SHORT' || dir === 'BEARISH';
      return true;
    });
  }

  public async getRegime(): Promise<MacroRegimeResult> {
    try {
      const res = await fetch(`${this.baseUrl}/regime`);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return await res.json();
    } catch (e) {
      console.error('MacroRegimeService.getRegime failed, returning fallback:', e);
      return {
        status: 'fallback',
        regime: 'NEUTRAL',
        probability_positive: 0.52,
        expected_return_pct: 0.8,
        confidence_interval_95: [-4.2, 5.8],
        var_95_pct: 4.2,
        cvar_95_pct: 6.1,
        last_updated_month: new Date().toISOString().substring(0, 7),
      };
    }
  }

  public async getWeights(): Promise<MacroWeights> {
    try {
      const res = await fetch(`${this.baseUrl}/weights`);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return await res.json();
    } catch (e) {
      console.error('MacroRegimeService.getWeights failed, returning fallback:', e);
      return {
        status: 'fallback',
        regime: 'NEUTRAL',
        weight_modifiers: {
          g_factor: 1.0,
          ci: 1.0,
          gex: 1.0,
          gfi: 1.0,
          mpgs: 1.0,
          iv_skew: 1.0,
        },
      };
    }
  }

  public async getMonthlyReport(): Promise<MonthlyReport> {
    try {
      const res = await fetch(`${this.baseUrl}/monthly-report`);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return await res.json();
    } catch (e) {
      console.error('MacroRegimeService.getMonthlyReport failed, returning fallback:', e);
      return {
        status: 'fallback',
        regime: 'NEUTRAL',
        expected_return_pct: 0.8,
        probability_positive: 0.52,
        confidence_interval_95: [-4.2, 5.8],
        var_95_pct: 4.2,
        cvar_95_pct: 6.1,
        top_macro_drivers: [
          { feature: 'SP500', importance: 0.22 },
          { feature: 'CBOE_VIX', importance: 0.18 },
          { feature: 'USDINR', importance: 0.15 },
          { feature: 'GOLD', importance: 0.12 },
          { feature: 'US10Y', importance: 0.09 },
        ],
        training_samples: 200,
        data_start: '2008-01-01',
        data_end: new Date().toISOString().substring(0, 7),
      };
    }
  }
}

export const macroRegimeService = MacroRegimeService.getInstance();
