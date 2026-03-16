/**
 * Interactive Quiz Engine for Academy Tab
 * Gamified learning with scoring, streaks, and progress tracking
 */

export interface QuizQuestion {
    id: string;
    category: 'fundamentals' | 'technical' | 'psychology' | 'tax' | 'macros';
    difficulty: 'beginner' | 'intermediate' | 'advanced';
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
    points: number;
}

export interface QuizResult {
    quizId: string;
    score: number;
    totalPoints: number;
    correctAnswers: number;
    totalQuestions: number;
    timeTaken: number; // seconds
    completedAt: string;
    xpEarned: number;
}

export interface UserProgress {
    totalXP: number;
    currentStreak: number;
    longestStreak: number;
    quizzesCompleted: number;
    categoryProgress: Record<string, { correct: number; total: number }>;
    lastQuizDate: string | null;
    badges: string[];
}

// Quiz Database
const QUIZ_QUESTIONS: QuizQuestion[] = [
    // Fundamentals
    {
        id: 'f1',
        category: 'fundamentals',
        difficulty: 'beginner',
        question: 'What does P/E ratio measure?',
        options: [
            'Price relative to earnings',
            'Profit relative to expenses',
            'Portfolio efficiency',
            'Price elasticity'
        ],
        correctIndex: 0,
        explanation: 'P/E (Price-to-Earnings) ratio compares a company\'s stock price to its earnings per share. A high P/E may indicate overvaluation or high growth expectations.',
        points: 10
    },
    {
        id: 'f2',
        category: 'fundamentals',
        difficulty: 'beginner',
        question: 'What is a mutual fund NAV?',
        options: [
            'Number of Active Voters',
            'Net Asset Value per unit',
            'New Annual Valuation',
            'Nominal Average Value'
        ],
        correctIndex: 1,
        explanation: 'NAV (Net Asset Value) represents the per-unit market value of all securities held by a mutual fund. It\'s calculated daily after market close.',
        points: 10
    },
    {
        id: 'f3',
        category: 'fundamentals',
        difficulty: 'intermediate',
        question: 'What is the difference between absolute and relative returns?',
        options: [
            'There is no difference',
            'Absolute returns are adjusted for inflation',
            'Relative returns compare performance against a benchmark',
            'Absolute returns are tax-adjusted'
        ],
        correctIndex: 2,
        explanation: 'Absolute returns show the actual gain/loss percentage, while relative returns compare your performance against a benchmark like Nifty 50 or a peer group.',
        points: 15
    },
    {
        id: 'f4',
        category: 'fundamentals',
        difficulty: 'advanced',
        question: 'What is the Sharpe Ratio used for?',
        options: [
            'Measuring company leverage',
            'Calculating tax liability',
            'Risk-adjusted return measurement',
            'Dividend yield calculation'
        ],
        correctIndex: 2,
        explanation: 'Sharpe Ratio measures excess return per unit of risk. Higher is better. Formula: (Portfolio Return - Risk-free Rate) / Standard Deviation',
        points: 20
    },
    // Technical
    {
        id: 't1',
        category: 'technical',
        difficulty: 'beginner',
        question: 'What does RSI stand for?',
        options: [
            'Relative Strength Index',
            'Risk Strategy Indicator',
            'Return Surplus Interest',
            'Revenue Share Index'
        ],
        correctIndex: 0,
        explanation: 'RSI measures momentum on a 0-100 scale. Above 70 = overbought, below 30 = oversold. It helps identify potential reversal points.',
        points: 10
    },
    {
        id: 't2',
        category: 'technical',
        difficulty: 'intermediate',
        question: 'What is a "Golden Cross" pattern?',
        options: [
            'When stock hits all-time high',
            '50-day MA crosses above 200-day MA',
            'When volume exceeds 1M shares',
            'A bullish candlestick pattern'
        ],
        correctIndex: 1,
        explanation: 'A Golden Cross is a bullish signal where the 50-day moving average crosses above the 200-day moving average, indicating potential upward momentum.',
        points: 15
    },
    {
        id: 't3',
        category: 'technical',
        difficulty: 'advanced',
        question: 'What indicates a "Head and Shoulders" pattern completion?',
        options: [
            'Price breaks above the head',
            'Volume increases at left shoulder',
            'Neckline breakdown with volume',
            'Right shoulder higher than left'
        ],
        correctIndex: 2,
        explanation: 'A Head and Shoulders top is confirmed when price breaks below the neckline with increased volume, signaling a bearish reversal.',
        points: 20
    },
    // Psychology
    {
        id: 'p1',
        category: 'psychology',
        difficulty: 'beginner',
        question: 'What is "FOMO" in trading?',
        options: [
            'First Order Market Option',
            'Fear of Missing Out',
            'Forward Maximum Output',
            'Fund Operating Market Order'
        ],
        correctIndex: 1,
        explanation: 'FOMO (Fear of Missing Out) is the emotional drive to enter trades impulsively when seeing others profit, often leading to buying at peaks.',
        points: 10
    },
    {
        id: 'p2',
        category: 'psychology',
        difficulty: 'intermediate',
        question: 'What is "confirmation bias" in investing?',
        options: [
            'Waiting for broker confirmation',
            'Seeking info that supports existing beliefs',
            'Confirming trades via 2FA',
            'Verifying company fundamentals'
        ],
        correctIndex: 1,
        explanation: 'Confirmation bias is the tendency to search for, interpret, and recall information that confirms our pre-existing beliefs while ignoring contradicting evidence.',
        points: 15
    },
    {
        id: 'p3',
        category: 'psychology',
        difficulty: 'advanced',
        question: 'What is the "disposition effect"?',
        options: [
            'Tendency to diversify too much',
            'Selling winners too early, holding losers too long',
            'Over-trading during volatile markets',
            'Avoiding any risk in portfolio'
        ],
        correctIndex: 1,
        explanation: 'The disposition effect is a behavioral bias where investors sell winning positions too quickly to lock in gains, while holding losing positions hoping for recovery.',
        points: 20
    },
    // Tax
    {
        id: 'x1',
        category: 'tax',
        difficulty: 'beginner',
        question: 'What is the LTCG exemption limit in India (FY 24-25)?',
        options: [
            '₹50,000',
            '₹1,00,000',
            '₹1,25,000',
            '₹2,00,000'
        ],
        correctIndex: 2,
        explanation: 'From FY 2024-25, LTCG on listed equity up to ₹1.25 Lakh per year is exempt from tax. Beyond this, it\'s taxed at 12.5%.',
        points: 10
    },
    {
        id: 'x2',
        category: 'tax',
        difficulty: 'intermediate',
        question: 'What is the holding period for equity to qualify as LTCG?',
        options: [
            '6 months',
            '12 months',
            '24 months',
            '36 months'
        ],
        correctIndex: 1,
        explanation: 'For listed equity shares and equity mutual funds, holding period must exceed 12 months for gains to be classified as Long Term Capital Gains.',
        points: 15
    },
    {
        id: 'x3',
        category: 'tax',
        difficulty: 'advanced',
        question: 'What is "tax loss harvesting"?',
        options: [
            'Paying taxes in installments',
            'Selling losers to offset gains',
            'Claiming agricultural income exemption',
            'Donating stocks for tax benefits'
        ],
        correctIndex: 1,
        explanation: 'Tax loss harvesting involves strategically selling investments at a loss to offset capital gains, reducing your overall tax liability for the year.',
        points: 20
    },
    // Macros
    {
        id: 'm1',
        category: 'macros',
        difficulty: 'beginner',
        question: 'What does India VIX measure?',
        options: [
            'Volume of Indian stocks',
            'Volatility expectations',
            'Value of exports',
            'Velocity of money'
        ],
        correctIndex: 1,
        explanation: 'India VIX measures expected market volatility over the next 30 days. Higher VIX indicates fear, lower VIX indicates complacency.',
        points: 10
    },
    {
        id: 'm2',
        category: 'macros',
        difficulty: 'intermediate',
        question: 'How does rising crude oil typically affect Indian markets?',
        options: [
            'Generally positive',
            'Generally negative',
            'No impact',
            'Only affects IT sector'
        ],
        correctIndex: 1,
        explanation: 'India imports ~85% of its oil. Rising crude increases import bills, widens trade deficit, raises inflation, and pressures the rupee - generally negative for markets.',
        points: 15
    },
    {
        id: 'm3',
        category: 'macros',
        difficulty: 'advanced',
        question: 'What is the impact of FII outflows on INR?',
        options: [
            'Rupee strengthens',
            'Rupee weakens',
            'No impact on currency',
            'Depends on RBI policy only'
        ],
        correctIndex: 1,
        explanation: 'FII outflows create selling pressure on INR as foreign investors convert rupees to dollars to repatriate funds, leading to rupee depreciation.',
        points: 20
    },
];

// Badge Definitions
const BADGES = [
    { id: 'first_quiz', name: 'First Steps', icon: '🎯', description: 'Complete your first quiz' },
    { id: 'streak_3', name: 'On Fire', icon: '🔥', description: '3-day learning streak' },
    { id: 'streak_7', name: 'Dedicated', icon: '⚡', description: '7-day learning streak' },
    { id: 'perfect_score', name: 'Perfect!', icon: '💯', description: 'Score 100% on any quiz' },
    { id: 'fundamentals_master', name: 'Fundamentals Master', icon: '📊', description: 'Complete all fundamentals quizzes' },
    { id: 'tax_expert', name: 'Tax Expert', icon: '🏛️', description: 'Complete all tax quizzes' },
    { id: 'xp_100', name: 'Century', icon: '💎', description: 'Earn 100 XP' },
    { id: 'xp_500', name: 'Scholar', icon: '🎓', description: 'Earn 500 XP' },
];

import { db, QuizProgress } from '../database';

export class QuizEngine {
    private storageKey = 'wealth_quiz_progress';


    // Get questions by category and difficulty
    getQuestions(category?: string, difficulty?: string, count: number = 5): QuizQuestion[] {
        let filtered = [...QUIZ_QUESTIONS];

        if (category) {
            filtered = filtered.filter(q => q.category === category);
        }
        if (difficulty) {
            filtered = filtered.filter(q => q.difficulty === difficulty);
        }

        // Shuffle and return requested count
        return this.shuffle(filtered).slice(0, count);
    }

    // Get all categories
    getCategories(): { id: string; name: string; icon: string; questionCount: number }[] {
        return [
            { id: 'fundamentals', name: 'Fundamentals', icon: '📊', questionCount: QUIZ_QUESTIONS.filter(q => q.category === 'fundamentals').length },
            { id: 'technical', name: 'Technical Analysis', icon: '📈', questionCount: QUIZ_QUESTIONS.filter(q => q.category === 'technical').length },
            { id: 'psychology', name: 'Trading Psychology', icon: '🧠', questionCount: QUIZ_QUESTIONS.filter(q => q.category === 'psychology').length },
            { id: 'tax', name: 'Tax & Compliance', icon: '🏛️', questionCount: QUIZ_QUESTIONS.filter(q => q.category === 'tax').length },
            { id: 'macros', name: 'Macroeconomics', icon: '🌍', questionCount: QUIZ_QUESTIONS.filter(q => q.category === 'macros').length },
        ];
    }

    // Load user progress from DB (with localStorage fallback)
    async loadProgress(): Promise<UserProgress> {
        try {
            // Try DB first
            const fromDb = await db.quiz_progress.get({ userId: 'default' });
            if (fromDb) {
                return fromDb as unknown as UserProgress;
            }

            // Fallback to localStorage (Migration)
            const saved = localStorage.getItem(this.storageKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                // Migrate to DB
                await this.saveProgress(parsed);
                return parsed;
            }
        } catch (error) {
            console.error('Failed to load quiz progress', error);
        }

        return {
            totalXP: 0,
            currentStreak: 0,
            longestStreak: 0,
            quizzesCompleted: 0,
            categoryProgress: {},
            lastQuizDate: null,
            badges: [],
        };
    }

    // Save user progress
    async saveProgress(progress: UserProgress): Promise<void> {
        try {
            // @ts-ignore - Schema matches but types might be strict
            await db.quiz_progress.put({ ...progress, userId: 'default' });
            // Keep Backup
            localStorage.setItem(this.storageKey, JSON.stringify(progress));
        } catch (error) {
            console.error('Failed to save quiz progress', error);
        }
    }

    // Record quiz result and update progress
    async recordResult(result: QuizResult): Promise<UserProgress> {
        const progress = await this.loadProgress();

        // Update XP
        progress.totalXP += result.xpEarned;
        progress.quizzesCompleted += 1;

        // Update streak
        const today = new Date().toDateString();
        const lastDate = progress.lastQuizDate ? new Date(progress.lastQuizDate).toDateString() : null;
        const yesterday = new Date(Date.now() - 86400000).toDateString();

        if (lastDate === yesterday) {
            progress.currentStreak += 1;
        } else if (lastDate !== today) {
            progress.currentStreak = 1;
        }
        progress.longestStreak = Math.max(progress.longestStreak, progress.currentStreak);
        progress.lastQuizDate = new Date().toISOString();

        // Check for new badges
        this.checkBadges(progress, result);

        await this.saveProgress(progress);
        return progress;
    }

    // Check and award badges
    private checkBadges(progress: UserProgress, result: QuizResult): void {
        const newBadges: string[] = [];

        if (progress.quizzesCompleted === 1 && !progress.badges.includes('first_quiz')) {
            newBadges.push('first_quiz');
        }
        if (progress.currentStreak >= 3 && !progress.badges.includes('streak_3')) {
            newBadges.push('streak_3');
        }
        if (progress.currentStreak >= 7 && !progress.badges.includes('streak_7')) {
            newBadges.push('streak_7');
        }
        if (result.score === result.totalPoints && !progress.badges.includes('perfect_score')) {
            newBadges.push('perfect_score');
        }
        if (progress.totalXP >= 100 && !progress.badges.includes('xp_100')) {
            newBadges.push('xp_100');
        }
        if (progress.totalXP >= 500 && !progress.badges.includes('xp_500')) {
            newBadges.push('xp_500');
        }

        progress.badges = [...progress.badges, ...newBadges];
    }

    // Get badge info
    getBadges(): typeof BADGES {
        return BADGES;
    }

    // Calculate XP earned from quiz
    calculateXP(correctAnswers: number, totalQuestions: number, timeTaken: number): number {
        const accuracyBonus = (correctAnswers / totalQuestions) * 50;
        const speedBonus = Math.max(0, 20 - Math.floor(timeTaken / 60)); // Bonus for completing under 20 mins
        const baseXP = correctAnswers * 10;
        return Math.round(baseXP + accuracyBonus + speedBonus);
    }

    // Shuffle array
    private shuffle<T>(array: T[]): T[] {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }
}

export const quizEngine = new QuizEngine();
export default QuizEngine;
