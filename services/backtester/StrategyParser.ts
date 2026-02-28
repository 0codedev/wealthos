import { StrategyDefinition, IndicatorCondition } from '../../types/backtester.types';
import type { HistoricalTradeNode } from './BacktestEngine';

export interface StrategyContext {
  currentLossStreak: number;
  todaysPnL: number;
  currentDateStr?: string;
  [key: string]: any;
}

export class StrategyParser {
  
  /**
   * Evaluates if a given historical trade meets the entry criteria of the strategy.
   * 
   * @param trade The historical trade candidate
   * @param strategy The strategy definition containing rules
   * @param context Additional context (e.g., current streak, today's PnL) if rules require it
   * @returns boolean true if the trade should be taken, false otherwise
   */
  static evaluateEntry(trade: HistoricalTradeNode, strategy: StrategyDefinition, context?: StrategyContext): boolean {
    if (!strategy.entryRules || strategy.entryRules.length === 0) {
      return true; // No rules means take everything (useful for pure exit-optimization testing)
    }

    // Default to AND logic for simplicity unless specified
    // A robust parser would build an AST for complex AND/OR logic.
    let isEntryValid = true;

    for (const rule of strategy.entryRules) {
      const result = this.evaluateSingleRule(trade, rule, context);
      
      if (rule.logic === 'OR') {
        isEntryValid = isEntryValid || result;
      } else { // Default AND
        isEntryValid = isEntryValid && result;
      }

      // Short circuit if AND fails
      if (!isEntryValid && (!rule.logic || rule.logic === 'AND')) {
        return false;
      }
    }

    return isEntryValid;
  }

  private static evaluateSingleRule(trade: HistoricalTradeNode, rule: IndicatorCondition, context?: StrategyContext): boolean {
    const tradeValue = this.extractFieldValue(trade, rule.leftIndicator, context);
    
    // Safety check for missing data
    if (tradeValue === undefined || tradeValue === null) {
      return false; 
    }

    switch (rule.operator) {
      case 'EQUALS':
        return tradeValue === rule.rightValue;
      case 'NOT_EQUALS':
        return tradeValue !== rule.rightValue;
      case 'GREATER_THAN':
        return tradeValue > (rule.rightValue ?? 0);
      case 'LESS_THAN':
        return tradeValue < (rule.rightValue ?? 0);
      case 'GREATER_EQUAL':
        return tradeValue >= (rule.rightValue ?? 0);
      case 'LESS_EQUAL':
        return tradeValue <= (rule.rightValue ?? 0);
      case 'IS_TRUE':
        return !!tradeValue;
      case 'BETWEEN':
        if (rule.rightValue !== undefined && rule.rightValueHigh !== undefined) {
          return tradeValue >= rule.rightValue && tradeValue <= rule.rightValueHigh;
        }
        if (typeof tradeValue === 'number' && typeof rule.rightValue === 'string' && (rule.rightValue as string).includes('-')) {
            const [start, end] = (rule.rightValue as string).split('-').map(v => {
                if (v && v.includes(':')) {
                    const [h, m] = v.split(':').map(Number);
                    return (h ?? 0) * 60 + (m ?? 0);
                }
                return Number(v);
            });
            return tradeValue >= (start ?? 0) && tradeValue <= (end ?? 0);
        }
        if (Array.isArray(rule.rightValue) && (rule.rightValue as any).length === 2) {
          return tradeValue >= (rule.rightValue as any)[0] && tradeValue <= (rule.rightValue as any)[1];
        }
        return false;
      default:
        return false;
    }
  }

  private static extractFieldValue(trade: HistoricalTradeNode, field: string, context?: StrategyContext): any {
    switch (field) {
      case 'timeOfDay':
        if (!trade.entryTime) return null;
        const parts = trade.entryTime.split(':');
        const h = parts[0] ? Number(parts[0]) : 0;
        const m = parts[1] ? Number(parts[1]) : 0;
        return h * 60 + m; // Minutes since midnight
      case 'dayOfWeek':
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[new Date(trade.date).getDay()];
      case 'ticker':
        return trade.ticker;
      case 'direction':
        return trade.direction;
      case 'mood':
        // Check direct property first, then fallback to notes
        return (trade as any).mood || (trade.notes ? this.extractMood(trade.notes) : null);
      case 'mistake':
        // Check if trade had specific mistakes
        return trade.mistakes || [];
      case 'consecutiveLosses':
        return context?.currentLossStreak || 0;
      case 'dailyPnL':
        return context?.todaysPnL || 0;
      default:
        // Try direct property access as fallback
        return (trade as any)[field];
    }
  }

  /**
   * Filters a list of trades based on strategy entry rules.
   */
  static filterTrades(strategy: StrategyDefinition, trades: HistoricalTradeNode[]): HistoricalTradeNode[] {
    let context: StrategyContext = {
      currentLossStreak: 0,
      todaysPnL: 0,
      currentDateStr: ''
    };

    return trades.filter(trade => {
      // Simple daily context reset
      if (trade.date !== context.currentDateStr) {
        context.todaysPnL = 0;
        context.currentDateStr = trade.date;
      }

      const isTaken = this.evaluateEntry(trade, strategy, context);
      
      // Update context for next trade (only if taken and result was negative)
      // This is basic and might need adjustment for more complex context rules
      if (isTaken) {
        const pnl = (trade.exitPrice - trade.entryPrice) * (trade.direction === 'Long' ? 1 : -1);
        context.todaysPnL += pnl;
        if (pnl < 0) {
          context.currentLossStreak++;
        } else {
          context.currentLossStreak = 0;
        }
      }

      return isTaken;
    });
  }

  private static extractMood(notes: string): string | null {
    // Basic extraction if mood is formatted in notes, e.g., "[Mood: Focused]"
    const match = notes.match(/\[Mood:\s*([^\]]+)\]/i);
    return match ? match[1].trim() : null;
  }
}
