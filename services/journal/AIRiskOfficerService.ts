/**
 * AI Chief Risk Officer (CRO) & Behavioral Tilt Defense Service
 *
 * Implements DOMAIN 05 & Work Package 6:
 * - 3-Question Daily Debrief (Golden Window, GEX Alignment, Untampered Stop)
 * - Real-time Mathematical Expectancy Calculation: E = (W * R_win) - (L * R_loss)
 * - Tilt Warning Engine & Emotionless A-F Process Grading
 * - 48-Hour Slump-Buster / Cool-Off Enforcer on Tilt Violation
 */

export interface DailyDebriefAnswers {
  date: string;
  goldenWindowAdherence: boolean; // Was trade entered between 10:30 - 10:45 AM?
  gexAlignmentVerified: boolean; // Was GEX regime / S0 flip line verified?
  untamperedStopLoss: boolean; // Did you respect the pre-bracketed stop without widening?
  notes?: string;
}

export interface TradeMetricsHistory {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgWinR: number; // in R-multiples, e.g. 2.1R
  avgLossR: number; // in R-multiples, e.g. 1.0R
  consecutiveLosses: number;
}

export interface ExpectancyReport {
  winRate: number; // 0.0 - 1.0 (e.g. 0.55 = 55%)
  lossRate: number;
  avgWinR: number;
  avgLossR: number;
  expectancyR: number; // E in R multiples
  isPositiveExpectancy: boolean;
  verdict: 'INSTITUTIONAL_EDGE' | 'MEDIOCRE_EDGE' | 'NEGATIVE_EXPECTANCY_GAMBLING';
  verdictDescription: string;
}

export interface ProcessGradeReport {
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  score: number; // 0 - 100
  title: string;
  summary: string;
  debriefScore: number; // 0 - 3
  isCoolOffTriggered: boolean;
  coolOffDurationHours: number;
}

const STORAGE_KEY_DEBRIEF = 'wealth_cro_debrief_log_v1';
const STORAGE_KEY_TILT_LOCK = 'wealth_cro_tilt_lock_v1';

export class AIRiskOfficerService {
  private static instance: AIRiskOfficerService;

  private constructor() {}

  public static getInstance(): AIRiskOfficerService {
    if (!AIRiskOfficerService.instance) {
      AIRiskOfficerService.instance = new AIRiskOfficerService();
    }
    return AIRiskOfficerService.instance;
  }

  /**
   * Compute real-time mathematical expectancy:
   * E = (W * R_win) - (L * R_loss)
   */
  public computeExpectancy(history: TradeMetricsHistory): ExpectancyReport {
    const { totalTrades, winningTrades, losingTrades, avgWinR, avgLossR } = history;

    if (totalTrades === 0) {
      return {
        winRate: 0,
        lossRate: 0,
        avgWinR: 0,
        avgLossR: 0,
        expectancyR: 0,
        isPositiveExpectancy: false,
        verdict: 'MEDIOCRE_EDGE',
        verdictDescription: 'No historical trade data. 40-trade incubation required.'
      };
    }

    const winRate = winningTrades / totalTrades;
    const lossRate = losingTrades / totalTrades;
    const expectancyR = Number(((winRate * avgWinR) - (lossRate * avgLossR)).toFixed(2));
    const isPositiveExpectancy = expectancyR > 0;

    let verdict: ExpectancyReport['verdict'] = 'MEDIOCRE_EDGE';
    let verdictDescription = '';

    if (expectancyR >= 0.5) {
      verdict = 'INSTITUTIONAL_EDGE';
      verdictDescription = `Edge verified: Expectancy is +${expectancyR}R per trade. For every 100 trades, system produces +${(expectancyR * 100).toFixed(0)}R profit factor.`;
    } else if (expectancyR > 0) {
      verdict = 'MEDIOCRE_EDGE';
      verdictDescription = `Marginal edge: Expectancy is +${expectancyR}R. High friction risk from brokerage & slippage. Focus strictly on 1:2+ R:R setups.`;
    } else {
      verdict = 'NEGATIVE_EXPECTANCY_GAMBLING';
      verdictDescription = `CRITICAL DEFICIT: Expectancy is ${expectancyR}R. You are bleeding capital to the market. Order punching hard-locked.`;
    }

    return {
      winRate: Number((winRate * 100).toFixed(1)),
      lossRate: Number((lossRate * 100).toFixed(1)),
      avgWinR: Number(avgWinR.toFixed(2)),
      avgLossR: Number(avgLossR.toFixed(2)),
      expectancyR,
      isPositiveExpectancy,
      verdict,
      verdictDescription
    };
  }

  /**
   * Evaluates Daily Debrief & Process Grading (A to F)
   */
  public evaluateProcessGrade(answers: DailyDebriefAnswers, history: TradeMetricsHistory): ProcessGradeReport {
    const q1 = answers.goldenWindowAdherence ? 1 : 0;
    const q2 = answers.gexAlignmentVerified ? 1 : 0;
    const q3 = answers.untamperedStopLoss ? 1 : 0;
    const debriefScore = q1 + q2 + q3; // 0 to 3

    const expectancy = this.computeExpectancy(history);

    // Stop tampering is an automatic Grade F
    if (!answers.untamperedStopLoss) {
      this.triggerCoolOff(48, 'Manual stop tampering detected. 48-hour cool-off enforced.');
      return {
        grade: 'F',
        score: 25,
        title: 'Grade F: Fatal Discipline Breach',
        summary: 'You moved, widened, or canceled a pre-bracketed stop loss. This is the #1 killer of retail trading accounts. Mandatory 48-hour cool-off activated.',
        debriefScore,
        isCoolOffTriggered: true,
        coolOffDurationHours: 48
      };
    }

    if (debriefScore === 3 && expectancy.expectancyR >= 0.4) {
      return {
        grade: 'A',
        score: 95,
        title: 'Grade A: Institutional Sovereign Execution',
        summary: 'Flawless adherence to the Golden Window, GEX alignment, and pre-bracketed stops. Edge maintained.',
        debriefScore,
        isCoolOffTriggered: false,
        coolOffDurationHours: 0
      };
    }

    if (debriefScore >= 2 && expectancy.expectancyR >= 0.1) {
      return {
        grade: 'B',
        score: 80,
        title: 'Grade B: Acceptable Execution with Minor Drift',
        summary: 'Solid process with minor timing or macro friction. No fatal discipline errors.',
        debriefScore,
        isCoolOffTriggered: false,
        coolOffDurationHours: 0
      };
    }

    if (debriefScore === 1) {
      return {
        grade: 'C',
        score: 60,
        title: 'Grade C: Poor Process Compliance',
        summary: 'Two out of three execution rules violated. Size must be reduced to 50% tomorrow.',
        debriefScore,
        isCoolOffTriggered: false,
        coolOffDurationHours: 0
      };
    }

    this.triggerCoolOff(24, 'Repeated rule violations. 24-hour cool-off enforced.');
    return {
      grade: 'D',
      score: 45,
      title: 'Grade D: Critical Process Failure',
      summary: 'Failure across core rules. Standing down for 24 hours to reset dopamine receptors.',
      debriefScore,
      isCoolOffTriggered: true,
      coolOffDurationHours: 24
    };
  }

  /**
   * Activates mandatory cool-off lock in localStorage
   */
  public triggerCoolOff(hours: number, reason: string): void {
    if (typeof window === 'undefined') return;
    try {
      const endsAt = Date.now() + hours * 3600 * 1000;
      localStorage.setItem(STORAGE_KEY_TILT_LOCK, JSON.stringify({ endsAt, reason }));
      window.dispatchEvent(new CustomEvent('wealth-cro-tilt-locked', { detail: { endsAt, reason } }));
    } catch { /* non-fatal */ }
  }

  /**
   * Checks if an active cool-off is currently underway
   */
  public isCoolOffActive(): { isActive: boolean; reason?: string; remainingMinutes: number } {
    if (typeof window === 'undefined') return { isActive: false, remainingMinutes: 0 };
    try {
      const raw = localStorage.getItem(STORAGE_KEY_TILT_LOCK);
      if (!raw) return { isActive: false, remainingMinutes: 0 };
      const data = JSON.parse(raw);
      const remaining = data.endsAt - Date.now();
      if (remaining > 0) {
        return {
          isActive: true,
          reason: data.reason,
          remainingMinutes: Math.ceil(remaining / 60000)
        };
      }
      return { isActive: false, remainingMinutes: 0 };
    } catch {
      return { isActive: false, remainingMinutes: 0 };
    }
  }
}

export const aiRiskOfficerService = AIRiskOfficerService.getInstance();
