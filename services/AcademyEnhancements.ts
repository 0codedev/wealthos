/**
 * AcademyEnhancements - Video content, psychology assessments, risk questionnaire
 */

// ==================== VIDEO CONTENT INTEGRATION ====================

export interface VideoLesson {
    id: string;
    day: number;
    title: string;
    youtubeId: string;
    duration: string;
    description: string;
    tags: string[];
}

export const VIDEO_LESSONS: VideoLesson[] = [
    // Week 1 - Basics
    { id: 'v1', day: 1, title: 'What is a Stock Market?', youtubeId: 'p7HKvqRI_Bo', duration: '12:34', description: 'Understanding the basics of stock markets and how they work', tags: ['beginner', 'basics'] },
    { id: 'v2', day: 2, title: 'How to Read Stock Charts', youtubeId: 'eynxyoKgpng', duration: '15:20', description: 'Introduction to candlestick charts and patterns', tags: ['technical', 'charts'] },
    { id: 'v3', day: 3, title: 'Understanding P/E Ratio', youtubeId: 'pq7JzIhVzHc', duration: '8:45', description: 'Price to Earnings ratio explained simply', tags: ['fundamentals', 'valuation'] },
    { id: 'v4', day: 4, title: 'Mutual Funds vs Stocks', youtubeId: 'ngfKXvfzC74', duration: '11:15', description: 'Which is better for you?', tags: ['mutual-funds', 'comparison'] },
    { id: 'v5', day: 5, title: 'SIP - Power of Compounding', youtubeId: 'NZbB80TzrZ8', duration: '9:30', description: 'How SIP helps build wealth over time', tags: ['sip', 'compounding'] },

    // Week 2 - Intermediate
    { id: 'v6', day: 6, title: 'Technical Analysis Basics', youtubeId: 'x1jd7RZ9GjI', duration: '18:00', description: 'Support, resistance, and moving averages', tags: ['technical', 'intermediate'] },
    { id: 'v7', day: 7, title: 'Fundamental Analysis', youtubeId: '2OjY5mEZgvs', duration: '20:15', description: 'Reading balance sheets and annual reports', tags: ['fundamentals', 'analysis'] },
    { id: 'v8', day: 8, title: 'IPO Investing Guide', youtubeId: 'zK6FgU64PbI', duration: '14:45', description: 'How to analyze and apply for IPOs', tags: ['ipo', 'investing'] },
    { id: 'v9', day: 9, title: 'Tax on Stock Market Gains', youtubeId: 'YWrN3Z7Qs_s', duration: '16:30', description: 'STCG, LTCG, and tax saving strategies', tags: ['tax', 'capital-gains'] },
    { id: 'v10', day: 10, title: 'Building a Portfolio', youtubeId: 'f5j9v9dfinQ', duration: '13:20', description: 'Asset allocation and diversification', tags: ['portfolio', 'strategy'] },

    // Week 3 - Advanced
    { id: 'v11', day: 11, title: 'Options Trading Basics', youtubeId: 'VJgHkAqohbU', duration: '22:00', description: 'Call and Put options explained', tags: ['options', 'derivatives'] },
    { id: 'v12', day: 12, title: 'Risk Management', youtubeId: 'eeAamIggjZE', duration: '15:45', description: 'Stop loss, position sizing, and hedging', tags: ['risk', 'management'] },
    { id: 'v13', day: 13, title: 'Trading Psychology', youtubeId: 'R9M2EbEwJDQ', duration: '17:30', description: 'Mastering emotions in trading', tags: ['psychology', 'mindset'] },
    { id: 'v14', day: 14, title: 'Sector Analysis', youtubeId: 'c9EshPxCyXo', duration: '19:00', description: 'How to analyze different sectors', tags: ['sectors', 'analysis'] },
    { id: 'v15', day: 15, title: 'Value Investing', youtubeId: 'KfDB9e_cO4k', duration: '21:15', description: 'Warren Buffett style investing', tags: ['value', 'buffett'] },

    // Week 4 - Mastery
    { id: 'v16', day: 16, title: 'Momentum Trading', youtubeId: 'NZs9mLnmxDk', duration: '16:00', description: 'Riding market trends', tags: ['momentum', 'trading'] },
    { id: 'v17', day: 17, title: 'Dividend Investing', youtubeId: 'bSQVPCJjR7c', duration: '12:30', description: 'Building passive income from stocks', tags: ['dividends', 'income'] },
    { id: 'v18', day: 18, title: 'Global Markets', youtubeId: 'dF6kP_Kw68k', duration: '14:00', description: 'Investing in US stocks and crypto', tags: ['global', 'international'] },
    { id: 'v19', day: 19, title: 'FIRE Movement', youtubeId: 'hq_CofHzNbs', duration: '18:45', description: 'Financial Independence Retire Early', tags: ['fire', 'retirement'] },
    { id: 'v20', day: 20, title: 'Wealth Creation Masterclass', youtubeId: 'gTs7ywuWvGU', duration: '25:00', description: 'Putting it all together', tags: ['masterclass', 'summary'] },
];

export function generateYouTubeEmbed(videoId: string, width: string = '100%', height: string = '315'): string {
    return `<iframe width="${width}" height="${height}" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
}

// ==================== TRADING PSYCHOLOGY ASSESSMENT ====================

export interface PsychologyQuestion {
    id: string;
    question: string;
    options: Array<{ text: string; score: number; trait: string }>;
}

export interface PsychologyProfile {
    overallScore: number;
    traits: {
        discipline: number;
        riskTolerance: number;
        patience: number;
        emotionalControl: number;
        adaptability: number;
    };
    tradingStyle: 'Scalper' | 'Day Trader' | 'Swing Trader' | 'Position Trader' | 'Investor';
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
}

export const PSYCHOLOGY_QUESTIONS: PsychologyQuestion[] = [
    {
        id: 'p1',
        question: 'When a trade goes against you by 5%, what do you typically do?',
        options: [
            { text: 'Exit immediately to cut losses', score: 8, trait: 'discipline' },
            { text: 'Wait for it to recover', score: 3, trait: 'patience' },
            { text: 'Average down by buying more', score: 2, trait: 'riskTolerance' },
            { text: 'Panic and make impulsive decisions', score: 1, trait: 'emotionalControl' }
        ]
    },
    {
        id: 'p2',
        question: 'How do you feel after a big winning trade?',
        options: [
            { text: 'Stick to my plan, this is expected', score: 9, trait: 'discipline' },
            { text: 'Excited, want to make another trade quickly', score: 3, trait: 'emotionalControl' },
            { text: 'Feel like a genius, increase position sizes', score: 2, trait: 'riskTolerance' },
            { text: 'Celebrate moderately, stay focused', score: 7, trait: 'emotionalControl' }
        ]
    },
    {
        id: 'p3',
        question: 'How long can you hold a winning position?',
        options: [
            { text: 'Minutes to hours', score: 3, trait: 'patience' },
            { text: 'Days to weeks', score: 6, trait: 'patience' },
            { text: 'Months to years', score: 9, trait: 'patience' },
            { text: 'Until my target is hit, regardless of time', score: 8, trait: 'discipline' }
        ]
    },
    {
        id: 'p4',
        question: 'When the market crashes 10%, you:',
        options: [
            { text: 'See it as a buying opportunity', score: 8, trait: 'adaptability' },
            { text: 'Sell everything and wait', score: 3, trait: 'riskTolerance' },
            { text: 'Do nothing, stick to SIPs', score: 7, trait: 'discipline' },
            { text: 'Feel stressed and lose sleep', score: 2, trait: 'emotionalControl' }
        ]
    },
    {
        id: 'p5',
        question: 'How do you handle FOMO (Fear of Missing Out)?',
        options: [
            { text: 'Jump in even without analysis', score: 2, trait: 'discipline' },
            { text: 'Wait and watch, rarely chase', score: 8, trait: 'patience' },
            { text: 'Do quick analysis then decide', score: 6, trait: 'adaptability' },
            { text: 'Always have a watchlist ready', score: 7, trait: 'discipline' }
        ]
    },
    {
        id: 'p6',
        question: 'What percentage of your portfolio would you put in a single stock?',
        options: [
            { text: 'Up to 5%', score: 9, trait: 'riskTolerance' },
            { text: '10-20%', score: 6, trait: 'riskTolerance' },
            { text: '20-50%', score: 3, trait: 'riskTolerance' },
            { text: 'More than 50% if I\'m confident', score: 1, trait: 'riskTolerance' }
        ]
    },
    {
        id: 'p7',
        question: 'How often do you check your portfolio?',
        options: [
            { text: 'Multiple times a day', score: 3, trait: 'patience' },
            { text: 'Once a day', score: 5, trait: 'patience' },
            { text: 'Weekly', score: 7, trait: 'patience' },
            { text: 'Monthly or less', score: 9, trait: 'patience' }
        ]
    },
    {
        id: 'p8',
        question: 'When you make a loss, how long does it affect you?',
        options: [
            { text: 'Minutes, I move on quickly', score: 9, trait: 'emotionalControl' },
            { text: 'Hours, but I recover', score: 7, trait: 'emotionalControl' },
            { text: 'Days, it haunts me', score: 4, trait: 'emotionalControl' },
            { text: 'Very long, affects future decisions', score: 2, trait: 'emotionalControl' }
        ]
    },
    {
        id: 'p9',
        question: 'How prepared are you to change your strategy when market conditions change?',
        options: [
            { text: 'I adapt quickly', score: 8, trait: 'adaptability' },
            { text: 'I stick to what works', score: 5, trait: 'discipline' },
            { text: 'I\'m slow to change', score: 3, trait: 'adaptability' },
            { text: 'I have multiple strategies ready', score: 9, trait: 'adaptability' }
        ]
    },
    {
        id: 'p10',
        question: 'Do you maintain a trading journal?',
        options: [
            { text: 'Yes, detailed entries for every trade', score: 9, trait: 'discipline' },
            { text: 'Sometimes, for important trades', score: 5, trait: 'discipline' },
            { text: 'No, I track mentally', score: 2, trait: 'discipline' },
            { text: 'No, but I should start', score: 3, trait: 'discipline' }
        ]
    }
];

export function calculatePsychologyProfile(answers: Record<string, number>): PsychologyProfile {
    const traits = {
        discipline: 0,
        riskTolerance: 0,
        patience: 0,
        emotionalControl: 0,
        adaptability: 0
    };

    let traitCounts: Record<string, number> = {
        discipline: 0,
        riskTolerance: 0,
        patience: 0,
        emotionalControl: 0,
        adaptability: 0
    };

    // Calculate trait scores
    PSYCHOLOGY_QUESTIONS.forEach(q => {
        if (answers[q.id] !== undefined) {
            const selectedOption = q.options[answers[q.id]];
            if (selectedOption) {
                traits[selectedOption.trait as keyof typeof traits] += selectedOption.score;
                traitCounts[selectedOption.trait]++;
            }
        }
    });

    // Normalize scores to 0-100
    Object.keys(traits).forEach(key => {
        const k = key as keyof typeof traits;
        if (traitCounts[k] > 0) {
            traits[k] = Math.round((traits[k] / (traitCounts[k] * 9)) * 100);
        }
    });

    const overallScore = Math.round(Object.values(traits).reduce((a, b) => a + b) / 5);

    // Determine trading style
    let tradingStyle: PsychologyProfile['tradingStyle'] = 'Swing Trader';
    if (traits.patience < 40) {
        tradingStyle = traits.riskTolerance > 60 ? 'Scalper' : 'Day Trader';
    } else if (traits.patience > 80) {
        tradingStyle = 'Investor';
    } else if (traits.patience > 60) {
        tradingStyle = 'Position Trader';
    }

    // Identify strengths and weaknesses
    const sortedTraits = Object.entries(traits).sort((a, b) => b[1] - a[1]);
    const strengths = sortedTraits.slice(0, 2).map(([trait]) => trait);
    const weaknesses = sortedTraits.slice(-2).map(([trait]) => trait);

    // Generate recommendations
    const recommendations: string[] = [];
    if (traits.discipline < 60) {
        recommendations.push('Create and strictly follow a trading plan');
    }
    if (traits.emotionalControl < 60) {
        recommendations.push('Practice meditation and take breaks during volatile sessions');
    }
    if (traits.patience < 60) {
        recommendations.push('Consider longer-term strategies to reduce overtrading');
    }
    if (traits.riskTolerance > 80) {
        recommendations.push('Implement strict position sizing rules');
    }
    if (traits.adaptability < 60) {
        recommendations.push('Study different market conditions and prepare backup strategies');
    }

    return {
        overallScore,
        traits,
        tradingStyle,
        strengths,
        weaknesses,
        recommendations
    };
}

// ==================== RISK TOLERANCE QUESTIONNAIRE ====================

export interface RiskQuestion {
    id: string;
    question: string;
    options: Array<{ text: string; score: number }>;
}

export const RISK_QUESTIONS: RiskQuestion[] = [
    {
        id: 'r1',
        question: 'What is your investment time horizon?',
        options: [
            { text: 'Less than 1 year', score: 1 },
            { text: '1-3 years', score: 2 },
            { text: '3-5 years', score: 3 },
            { text: '5-10 years', score: 4 },
            { text: 'More than 10 years', score: 5 }
        ]
    },
    {
        id: 'r2',
        question: 'If your portfolio dropped 20% in a month, what would you do?',
        options: [
            { text: 'Sell everything immediately', score: 1 },
            { text: 'Sell some holdings to reduce risk', score: 2 },
            { text: 'Hold and wait for recovery', score: 3 },
            { text: 'Buy more at lower prices', score: 4 },
            { text: 'Significantly increase investments', score: 5 }
        ]
    },
    {
        id: 'r3',
        question: 'What percentage of your monthly income can you invest?',
        options: [
            { text: 'Less than 10%', score: 1 },
            { text: '10-20%', score: 2 },
            { text: '20-30%', score: 3 },
            { text: '30-50%', score: 4 },
            { text: 'More than 50%', score: 5 }
        ]
    },
    {
        id: 'r4',
        question: 'How stable is your primary source of income?',
        options: [
            { text: 'Very unstable (freelance/business)', score: 1 },
            { text: 'Somewhat unstable', score: 2 },
            { text: 'Moderately stable', score: 3 },
            { text: 'Stable (salaried job)', score: 4 },
            { text: 'Very stable (government/multiple income)', score: 5 }
        ]
    },
    {
        id: 'r5',
        question: 'How many months of emergency fund do you have?',
        options: [
            { text: 'None', score: 1 },
            { text: '1-3 months', score: 2 },
            { text: '3-6 months', score: 3 },
            { text: '6-12 months', score: 4 },
            { text: 'More than 12 months', score: 5 }
        ]
    },
    {
        id: 'r6',
        question: 'How would you describe your investment knowledge?',
        options: [
            { text: 'Complete beginner', score: 1 },
            { text: 'Basic understanding', score: 2 },
            { text: 'Intermediate knowledge', score: 3 },
            { text: 'Advanced knowledge', score: 4 },
            { text: 'Expert/Professional', score: 5 }
        ]
    },
    {
        id: 'r7',
        question: 'Which statement best describes your investment goal?',
        options: [
            { text: 'Preserve capital, avoid any losses', score: 1 },
            { text: 'Generate regular income', score: 2 },
            { text: 'Balanced growth with some income', score: 3 },
            { text: 'Long-term capital appreciation', score: 4 },
            { text: 'Maximum growth, willing to accept volatility', score: 5 }
        ]
    }
];

export interface RiskProfile {
    score: number;
    category: 'Conservative' | 'Moderately Conservative' | 'Moderate' | 'Moderately Aggressive' | 'Aggressive';
    suggestedAllocation: {
        equity: number;
        debt: number;
        gold: number;
        cash: number;
    };
    description: string;
}

export function calculateRiskProfile(answers: Record<string, number>): RiskProfile {
    const totalScore = Object.values(answers).reduce((sum, val) => sum + val, 0);
    const maxScore = RISK_QUESTIONS.length * 5;
    const normalizedScore = Math.round((totalScore / maxScore) * 100);

    let profile: RiskProfile;

    if (normalizedScore < 30) {
        profile = {
            score: normalizedScore,
            category: 'Conservative',
            suggestedAllocation: { equity: 20, debt: 60, gold: 10, cash: 10 },
            description: 'You prefer capital preservation over growth. Focus on fixed income and low-risk investments.'
        };
    } else if (normalizedScore < 45) {
        profile = {
            score: normalizedScore,
            category: 'Moderately Conservative',
            suggestedAllocation: { equity: 35, debt: 45, gold: 10, cash: 10 },
            description: 'You want some growth but prioritize stability. A mix of equity and debt suits you.'
        };
    } else if (normalizedScore < 60) {
        profile = {
            score: normalizedScore,
            category: 'Moderate',
            suggestedAllocation: { equity: 50, debt: 35, gold: 10, cash: 5 },
            description: 'You are comfortable with moderate risk for reasonable returns. Balanced portfolio recommended.'
        };
    } else if (normalizedScore < 80) {
        profile = {
            score: normalizedScore,
            category: 'Moderately Aggressive',
            suggestedAllocation: { equity: 70, debt: 20, gold: 5, cash: 5 },
            description: 'You can handle volatility for higher returns. Growth-focused portfolio suits you.'
        };
    } else {
        profile = {
            score: normalizedScore,
            category: 'Aggressive',
            suggestedAllocation: { equity: 85, debt: 10, gold: 5, cash: 0 },
            description: 'You seek maximum growth and can tolerate significant volatility. High equity allocation recommended.'
        };
    }

    return profile;
}

export default {
    VIDEO_LESSONS,
    generateYouTubeEmbed,
    PSYCHOLOGY_QUESTIONS,
    calculatePsychologyProfile,
    RISK_QUESTIONS,
    calculateRiskProfile
};
