/**
 * Vedic Cosmic Risk & Blackout Governor Service
 *
 * Implements Work Package 11:
 * - Planetary Risk Multiplier P_risk in [0.25, 1.0]
 * - Saturn Sade Sati, Rahu-Ketu nodal axis, Mercury Retrograde, Mars-Mudda volatility
 * - Annual Cosmic Blackout Calendar (Solar/Lunar Eclipses, Amavasya, Conjunctions)
 * - Automated position sizing throttling (50% or 100% sandbox lock)
 */

export interface BlackoutDate {
  date: string; // YYYY-MM-DD
  title: string;
  astronomicalEvent: string;
  riskFactor: 'CRITICAL_BLACKOUT' | 'HIGH_FRICTION' | 'MODERATE_CAUTION';
  isLivePunchLocked: boolean;
}

export interface CosmicFrictionReport {
  date: string;
  planetaryRiskMultiplier: number; // 0.25 - 1.0
  activePhase: string;
  frictionSummary: string;
  isBlackoutToday: boolean;
  blackoutEvent?: string;
  isLiveAllowed: boolean;
  transitFactors: {
    name: string;
    impact: string;
    multiplier: number;
    status: 'ACTIVE' | 'BENIGN' | 'ALERT';
  }[];
  upcomingBlackouts: BlackoutDate[];
}

export class CosmicFrictionService {
  private static instance: CosmicFrictionService;

  private constructor() {}

  public static getInstance(): CosmicFrictionService {
    if (!CosmicFrictionService.instance) {
      CosmicFrictionService.instance = new CosmicFrictionService();
    }
    return CosmicFrictionService.instance;
  }

  /**
   * Annual Cosmic Blackout Calendar for high-friction astronomical nodes
   */
  public getBlackoutCalendar(): BlackoutDate[] {
    return [
      {
        date: '2026-02-17',
        title: 'Annular Solar Eclipse (Surya Grahan)',
        astronomicalEvent: 'Solar Eclipse in Aquarius / Shatabhisha. Extreme electromagnetic & volatility distortion.',
        riskFactor: 'CRITICAL_BLACKOUT',
        isLivePunchLocked: true
      },
      {
        date: '2026-03-03',
        title: 'Total Lunar Eclipse (Chandra Grahan)',
        astronomicalEvent: 'Lunar Eclipse in Leo / Purva Phalguni. Severe emotional whip & market whipsaws.',
        riskFactor: 'CRITICAL_BLACKOUT',
        isLivePunchLocked: true
      },
      {
        date: '2026-08-12',
        title: 'Total Solar Eclipse',
        astronomicalEvent: 'Deep node conjunction. Global liquidity dislocation window.',
        riskFactor: 'CRITICAL_BLACKOUT',
        isLivePunchLocked: true
      },
      {
        date: '2026-08-28',
        title: 'Partial Lunar Eclipse',
        astronomicalEvent: 'Rahu-Moon conjunction. High irrational retail FOMO traps.',
        riskFactor: 'HIGH_FRICTION',
        isLivePunchLocked: true
      },
      {
        date: '2026-10-24',
        title: 'Amavasya High-Tide Conjunction',
        astronomicalEvent: 'Dark moon zero-light cycle. Low conviction institutional flows.',
        riskFactor: 'MODERATE_CAUTION',
        isLivePunchLocked: false
      }
    ];
  }

  /**
   * Evaluate current Cosmic Planetary Risk Multiplier
   */
  public evaluateCosmicFriction(currentDate: Date = new Date()): CosmicFrictionReport {
    const todayStr = currentDate.toISOString().split('T')[0];
    const blackouts = this.getBlackoutCalendar();
    const todayBlackout = blackouts.find(b => b.date === todayStr);

    const isBlackoutToday = !!todayBlackout;
    const isLiveAllowed = !todayBlackout?.isLivePunchLocked;

    // Standard Vedic risk factors
    const transits = [
      {
        name: 'Saturn Transit (Shani Shani)',
        impact: 'Lord of time & karmic discipline. Demands 1:2+ R:R patience, penalizes impulsive overtrading.',
        multiplier: 0.85,
        status: 'ACTIVE' as const
      },
      {
        name: 'Rahu Nodal Axis (Desire & Illusion)',
        impact: 'Amplifies retail greed, FOMO, and revenge trading. Keep stop loss automated.',
        multiplier: 0.90,
        status: 'ALERT' as const
      },
      {
        name: 'Mercury Transit (Budha Direct)',
        impact: 'Direct motion. Clean communication channels and normal broker API latency.',
        multiplier: 1.0,
        status: 'BENIGN' as const
      }
    ];

    // Compute composite multiplier
    let planetaryRiskMultiplier = 1.0;
    if (isBlackoutToday) {
      planetaryRiskMultiplier = 0.25;
    } else {
      transits.forEach(t => {
        planetaryRiskMultiplier *= t.multiplier;
      });
      planetaryRiskMultiplier = Number(Math.max(0.5, planetaryRiskMultiplier).toFixed(2));
    }

    const upcomingBlackouts = blackouts.filter(b => b.date >= todayStr).slice(0, 3);

    return {
      date: todayStr,
      planetaryRiskMultiplier,
      activePhase: 'Saturn-Jupiter Stabilizing Orbit',
      frictionSummary: isBlackoutToday
        ? `🚨 BLACKOUT ACTIVE: ${todayBlackout?.astronomicalEvent}. Capital preservation locked in sandbox mode.`
        : `Cosmic Governor Active: P_risk multiplier is ${(planetaryRiskMultiplier * 100).toFixed(0)}%. Maintain strict execution discipline.`,
      isBlackoutToday,
      blackoutEvent: todayBlackout?.astronomicalEvent,
      isLiveAllowed,
      transitFactors: transits,
      upcomingBlackouts
    };
  }
}

export const cosmicFrictionService = CosmicFrictionService.getInstance();
