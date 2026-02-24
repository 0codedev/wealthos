import { z } from 'zod';

/**
 * Validation schemas for all user inputs
 * Prevents XSS and ensures data integrity
 */

// Investment Types
export const InvestmentTypeSchema = z.enum([
  'Mutual Fund',
  'Digital Gold', 
  'Digital Silver',
  'Smallcase',
  'Stocks',
  'Crypto',
  'Fixed Deposit',
  'ETF',
  'Real Estate',
  'Cash/Bank',
  'IPO',
  'Trading Alpha'
]);

// Investment Schema
export const InvestmentSchema = z.object({
  id: z.string().min(1, 'ID is required'),
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  ticker: z.string().max(20, 'Ticker too long').optional(),
  type: InvestmentTypeSchema,
  platform: z.string().min(1, 'Platform is required').max(50, 'Platform name too long'),
  sector: z.string().max(50, 'Sector name too long').optional(),
  country: z.string().max(50, 'Country name too long').optional(),
  tags: z.array(z.string().max(20)).max(10, 'Too many tags').optional(),
  category: z.enum(['PORTFOLIO', 'TRADING_WALLET']).optional(),
  quantity: z.number().positive().optional(),
  investedAmount: z.number().min(0, 'Amount cannot be negative'),
  currentValue: z.number().min(0, 'Value cannot be negative'),
  lastUpdated: z.string().datetime(),
  isHiddenFromTotals: z.boolean().optional(),
  owner: z.enum(['SELF', 'SPOUSE', 'HUF', 'KIDS', 'JOINT', 'MOM']).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional()
});

// Trade Schema
export const TradeSchema = z.object({
  ticker: z.string().min(1, 'Ticker is required').max(20, 'Ticker too long'),
  entryPrice: z.number().positive('Entry price must be positive'),
  exitPrice: z.number().min(0, 'Exit price cannot be negative'),
  quantity: z.number().int().positive('Quantity must be positive'),
  direction: z.enum(['Long', 'Short']),
  date: z.string().datetime(),
  moodEntry: z.enum(['Focused', 'Anxious', 'Bored', 'Revenge', 'Greedy']),
  moodExit: z.enum(['Satisfied', 'Panic', 'Regret', 'Euphoric']),
  mistakes: z.array(z.string()).max(5, 'Too many mistakes').optional(),
  notes: z.string().max(500, 'Notes too long').optional()
});

// Goal Schema
export const GoalSchema = z.object({
  name: z.string().min(1, 'Goal name is required').max(100, 'Name too long'),
  targetAmount: z.number().positive('Target amount must be positive'),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  currentAmount: z.number().min(0, 'Current amount cannot be negative'),
  priority: z.enum(['Critical', 'Important', 'Nice-to-Have']),
  category: z.enum(['Retirement', 'House', 'Education', 'Travel', 'Emergency', 'Wedding', 'Vehicle', 'Other'])
});

// User Input Sanitization
export const sanitizeInput = (input: string): string => {
  // Remove HTML tags
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
};

// Validate and sanitize string
export const validateString = (value: string, maxLength: number = 100): string => {
  const sanitized = sanitizeInput(value);
  if (sanitized.length > maxLength) {
    throw new Error(`Input exceeds maximum length of ${maxLength}`);
  }
  return sanitized;
};

// Type exports
export type ValidatedInvestment = z.infer<typeof InvestmentSchema>;
export type ValidatedTrade = z.infer<typeof TradeSchema>;
export type ValidatedGoal = z.infer<typeof GoalSchema>;
