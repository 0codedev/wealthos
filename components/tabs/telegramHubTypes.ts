/**
 * CC40 — Shared types for the Telegram Intel Hub shell + hook.
 */
import type { ParsedSignalRecord, TelegramMessage } from '../../database';
import type { ParsedSignal as TelegramParsedSignal } from '../../services/TelegramSignalParser';
import type { DteDetails } from '../telegram';

export type LedgerFilter = 'ALL' | ParsedSignalRecord['status'];
export type FilterType = 'all' | 'signals' | 'news' | 'starred';

export interface ViewMessage {
  msg: TelegramMessage;
  parsed: TelegramParsedSignal | null;
  isSignal: boolean;
  isNews: boolean;
  earColor: string | undefined;
  dteDetails: DteDetails | null;
  newsTags: string[];
}
