/**
 * GamificationService - Leaderboards, achievements, certificates, challenges
 * Covers: Community features, social sharing, competition modes
 */

// ==================== ACHIEVEMENTS ====================

export interface Achievement {
    id: string;
    title: string;
    description: string;
    icon: string;
    category: 'portfolio' | 'learning' | 'trading' | 'streak' | 'milestone';
    requirement: number;
    current: number;
    unlocked: boolean;
    unlockedAt?: string;
    rarity: 'Common' | 'Rare' | 'Epic' | 'Legendary';
    xpReward: number;
}

export const ACHIEVEMENTS: Achievement[] = [
    // Portfolio Milestones
    { id: 'first-1l', title: 'First Lakh', description: 'Portfolio crossed ₹1 Lakh', icon: '💰', category: 'milestone', requirement: 100000, current: 0, unlocked: false, rarity: 'Common', xpReward: 100 },
    { id: 'first-10l', title: 'Lakhpati', description: 'Portfolio crossed ₹10 Lakhs', icon: '💎', category: 'milestone', requirement: 1000000, current: 0, unlocked: false, rarity: 'Rare', xpReward: 500 },
    { id: 'first-1cr', title: 'Crorepati', description: 'Portfolio crossed ₹1 Crore', icon: '👑', category: 'milestone', requirement: 10000000, current: 0, unlocked: false, rarity: 'Epic', xpReward: 2000 },
    { id: 'first-10cr', title: 'Decamillionaire', description: 'Portfolio crossed ₹10 Crores', icon: '🏆', category: 'milestone', requirement: 100000000, current: 0, unlocked: false, rarity: 'Legendary', xpReward: 10000 },

    // Learning Achievements
    { id: 'first-lesson', title: 'Eager Learner', description: 'Completed first lesson', icon: '📚', category: 'learning', requirement: 1, current: 0, unlocked: false, rarity: 'Common', xpReward: 25 },
    { id: 'week-complete', title: 'Week Warrior', description: 'Completed all 5 weekday lessons', icon: '🎯', category: 'learning', requirement: 5, current: 0, unlocked: false, rarity: 'Common', xpReward: 100 },
    { id: 'sprint-complete', title: 'Sprint Champion', description: 'Completed 20-day learning sprint', icon: '🏅', category: 'learning', requirement: 20, current: 0, unlocked: false, rarity: 'Rare', xpReward: 500 },
    { id: 'quiz-master', title: 'Quiz Master', description: 'Got 100% on 10 quizzes', icon: '🧠', category: 'learning', requirement: 10, current: 0, unlocked: false, rarity: 'Rare', xpReward: 300 },

    // Streak Achievements  
    { id: 'streak-7', title: 'Week Streak', description: '7-day login streak', icon: '🔥', category: 'streak', requirement: 7, current: 0, unlocked: false, rarity: 'Common', xpReward: 50 },
    { id: 'streak-30', title: 'Monthly Devotee', description: '30-day login streak', icon: '⚡', category: 'streak', requirement: 30, current: 0, unlocked: false, rarity: 'Rare', xpReward: 250 },
    { id: 'streak-100', title: 'Centurion', description: '100-day login streak', icon: '💯', category: 'streak', requirement: 100, current: 0, unlocked: false, rarity: 'Epic', xpReward: 1000 },
    { id: 'streak-365', title: 'Year Champion', description: '365-day login streak', icon: '🌟', category: 'streak', requirement: 365, current: 0, unlocked: false, rarity: 'Legendary', xpReward: 5000 },

    // Trading Achievements
    { id: 'first-trade', title: 'First Blood', description: 'Logged first trade', icon: '📊', category: 'trading', requirement: 1, current: 0, unlocked: false, rarity: 'Common', xpReward: 25 },
    { id: 'win-streak-5', title: 'Hot Hand', description: '5 consecutive winning trades', icon: '🎰', category: 'trading', requirement: 5, current: 0, unlocked: false, rarity: 'Rare', xpReward: 200 },
    { id: 'trades-100', title: 'Century Club', description: '100 trades logged', icon: '📈', category: 'trading', requirement: 100, current: 0, unlocked: false, rarity: 'Rare', xpReward: 300 },
    { id: 'green-year', title: 'Green Year', description: 'Profitable year in trading', icon: '💚', category: 'trading', requirement: 1, current: 0, unlocked: false, rarity: 'Epic', xpReward: 1000 },

    // Portfolio Achievements
    { id: 'diversified', title: 'Diversifier', description: 'Hold 5+ asset types', icon: '🎨', category: 'portfolio', requirement: 5, current: 0, unlocked: false, rarity: 'Common', xpReward: 75 },
    { id: 'multi-platform', title: 'Platform Hopper', description: 'Use 3+ investment platforms', icon: '🌐', category: 'portfolio', requirement: 3, current: 0, unlocked: false, rarity: 'Common', xpReward: 50 },
    { id: 'sip-warrior', title: 'SIP Warrior', description: 'Set up 5+ SIPs', icon: '⏰', category: 'portfolio', requirement: 5, current: 0, unlocked: false, rarity: 'Rare', xpReward: 150 },
    { id: 'ipo-hunter', title: 'IPO Hunter', description: 'Applied to 10+ IPOs', icon: '🎯', category: 'portfolio', requirement: 10, current: 0, unlocked: false, rarity: 'Rare', xpReward: 200 },
];

export function checkAchievements(
    portfolioValue: number,
    streakDays: number,
    lessonsCompleted: number,
    tradesLogged: number,
    assetTypes: number
): Achievement[] {
    const updated = [...ACHIEVEMENTS];

    // Update current progress
    updated.forEach(a => {
        switch (a.id) {
            case 'first-1l': case 'first-10l': case 'first-1cr': case 'first-10cr':
                a.current = portfolioValue;
                a.unlocked = portfolioValue >= a.requirement;
                break;
            case 'streak-7': case 'streak-30': case 'streak-100': case 'streak-365':
                a.current = streakDays;
                a.unlocked = streakDays >= a.requirement;
                break;
            case 'first-lesson': case 'week-complete': case 'sprint-complete':
                a.current = lessonsCompleted;
                a.unlocked = lessonsCompleted >= a.requirement;
                break;
            case 'first-trade': case 'trades-100':
                a.current = tradesLogged;
                a.unlocked = tradesLogged >= a.requirement;
                break;
            case 'diversified':
                a.current = assetTypes;
                a.unlocked = assetTypes >= a.requirement;
                break;
        }

        if (a.unlocked && !a.unlockedAt) {
            a.unlockedAt = new Date().toISOString();
        }
    });

    return updated;
}

// ==================== CERTIFICATES ====================

export interface Certificate {
    id: string;
    title: string;
    description: string;
    earnedDate: string;
    type: 'course' | 'challenge' | 'achievement';
    grade?: 'A+' | 'A' | 'B' | 'C';
    verificationCode: string;
}

export function generateCertificate(
    userId: string,
    title: string,
    type: Certificate['type'],
    score?: number
): Certificate {
    const grade = score ?
        score >= 95 ? 'A+' :
            score >= 85 ? 'A' :
                score >= 75 ? 'B' : 'C'
        : undefined;

    return {
        id: `CERT-${Date.now()}`,
        title,
        description: `Successfully completed ${title}`,
        earnedDate: new Date().toISOString(),
        type,
        grade,
        verificationCode: `WA-${userId.substring(0, 4).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`
    };
}

export function generateCertificateHTML(cert: Certificate, userName: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Certificate - ${cert.title}</title>
    <style>
        body { 
            font-family: 'Georgia', serif; 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            min-height: 100vh; 
            background: linear-gradient(135deg, #1e1b4b, #312e81);
            margin: 0;
        }
        .certificate {
            width: 800px; 
            padding: 60px; 
            background: linear-gradient(135deg, #fefce8, #fef3c7);
            border: 8px double #d97706;
            border-radius: 20px;
            text-align: center;
            box-shadow: 0 25px 50px rgba(0,0,0,0.3);
        }
        .logo { font-size: 32px; margin-bottom: 10px; }
        .title { font-size: 42px; color: #92400e; margin: 20px 0; font-weight: bold; }
        .subtitle { font-size: 18px; color: #78716c; margin-bottom: 30px; }
        .recipient { font-size: 36px; color: #1e1b4b; font-style: italic; margin: 30px 0; }
        .course { font-size: 24px; color: #4f46e5; margin: 20px 0; }
        .date { font-size: 14px; color: #78716c; margin-top: 40px; }
        .grade { 
            display: inline-block; 
            padding: 10px 30px; 
            background: #4f46e5; 
            color: white; 
            border-radius: 50px;
            font-size: 18px;
            margin-top: 20px;
        }
        .verification { 
            font-size: 12px; 
            color: #a8a29e; 
            margin-top: 30px; 
            font-family: monospace;
        }
    </style>
</head>
<body>
    <div class="certificate">
        <div class="logo">📊 Wealth Aggregator</div>
        <div class="title">Certificate of ${cert.type === 'course' ? 'Completion' : 'Achievement'}</div>
        <div class="subtitle">This is to certify that</div>
        <div class="recipient">${userName}</div>
        <div class="subtitle">has successfully completed</div>
        <div class="course">${cert.title}</div>
        ${cert.grade ? `<div class="grade">Grade: ${cert.grade}</div>` : ''}
        <div class="date">Awarded on ${new Date(cert.earnedDate).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    })}</div>
        <div class="verification">Verification Code: ${cert.verificationCode}</div>
    </div>
</body>
</html>
    `;
}

// ==================== LEADERBOARDS ====================

export interface LeaderboardEntry {
    rank: number;
    userId: string;
    displayName: string;
    avatar: string;
    score: number;
    change: number; // Position change from yesterday
    isCurrentUser?: boolean;
}

export interface Leaderboard {
    type: 'xp' | 'streak' | 'returns' | 'trades';
    title: string;
    entries: LeaderboardEntry[];
    userRank?: number;
    lastUpdated: string;
}

export function generateMockLeaderboard(
    type: Leaderboard['type'],
    currentUserId: string,
    currentUserScore: number
): Leaderboard {
    const titles = {
        xp: '🏆 XP Leaders',
        streak: '🔥 Streak Champions',
        returns: '📈 Top Performers',
        trades: '📊 Most Active Traders'
    };

    // Generate mock entries
    const names = [
        'Rakesh J.', 'Priya S.', 'Amit K.', 'Sneha R.', 'Vikram M.',
        'Ananya P.', 'Rohit G.', 'Kavya N.', 'Arjun B.', 'Meera T.',
        'Karthik L.', 'Divya C.', 'Suresh V.', 'Pooja D.', 'Nikhil A.'
    ];

    const avatars = ['👨‍💼', '👩‍💼', '🧑‍💻', '👨‍🎓', '👩‍🎓', '🦁', '🐯', '🦅', '🦊', '🐺'];

    let entries: LeaderboardEntry[] = names.map((name, i) => ({
        rank: i + 1,
        userId: `user-${i}`,
        displayName: name,
        avatar: avatars[i % avatars.length],
        score: Math.round((15 - i) * 1000 + Math.random() * 500),
        change: Math.floor(Math.random() * 5) - 2
    }));

    // Insert current user
    const userRank = entries.findIndex(e => e.score < currentUserScore);
    const insertAt = userRank === -1 ? entries.length : userRank;

    entries.splice(insertAt, 0, {
        rank: insertAt + 1,
        userId: currentUserId,
        displayName: 'You',
        avatar: '🧑‍💻',
        score: currentUserScore,
        change: 2,
        isCurrentUser: true
    });

    // Update ranks
    entries.forEach((e, i) => e.rank = i + 1);

    return {
        type,
        title: titles[type],
        entries: entries.slice(0, 15),
        userRank: insertAt + 1,
        lastUpdated: new Date().toISOString()
    };
}

// ==================== CHALLENGES ====================

export interface Challenge {
    id: string;
    title: string;
    description: string;
    type: 'savings' | 'trading' | 'learning' | 'streak';
    duration: number; // days
    target: number;
    current: number;
    startDate: string;
    endDate: string;
    participants: number;
    reward: { xp: number; badge?: string };
    status: 'active' | 'completed' | 'failed' | 'upcoming';
}

export const AVAILABLE_CHALLENGES: Omit<Challenge, 'current' | 'startDate' | 'endDate' | 'status'>[] = [
    {
        id: 'save-30k',
        title: '30-Day Savings Sprint',
        description: 'Save ₹30,000 in 30 days',
        type: 'savings',
        duration: 30,
        target: 30000,
        participants: 1250,
        reward: { xp: 500, badge: '💰 Saver' }
    },
    {
        id: 'no-loss-week',
        title: 'No Loss Week',
        description: 'Complete 7 days without any losing trades',
        type: 'trading',
        duration: 7,
        target: 7,
        participants: 450,
        reward: { xp: 300, badge: '🎯 Precise' }
    },
    {
        id: 'learn-everyday',
        title: 'Daily Learner',
        description: 'Complete a lesson every day for 14 days',
        type: 'learning',
        duration: 14,
        target: 14,
        participants: 2100,
        reward: { xp: 400, badge: '📚 Scholar' }
    },
    {
        id: 'paper-profit',
        title: 'Paper Trade Pro',
        description: 'Achieve 10% gains in paper trading',
        type: 'trading',
        duration: 30,
        target: 10,
        participants: 890,
        reward: { xp: 600, badge: '📈 Paper Pro' }
    }
];

// ==================== SOCIAL SHARING ====================

export interface ShareableContent {
    type: 'milestone' | 'achievement' | 'certificate' | 'portfolio';
    title: string;
    image?: string;
    text: string;
    url: string;
}

export function generateShareText(content: ShareableContent): {
    twitter: string;
    linkedin: string;
    whatsapp: string;
} {
    const hashtags = '#WealthAggregator #FinancialFreedom #Investing';

    return {
        twitter: `${content.text} ${hashtags}\n\n${content.url}`,
        linkedin: `🎉 ${content.title}\n\n${content.text}\n\nTracking my journey with Wealth Aggregator.\n\n${content.url}`,
        whatsapp: `${content.title}\n\n${content.text}\n\nTrack yours: ${content.url}`
    };
}

export function shareToSocial(
    platform: 'twitter' | 'linkedin' | 'whatsapp',
    content: ShareableContent
): void {
    const texts = generateShareText(content);
    const text = encodeURIComponent(texts[platform]);

    const urls = {
        twitter: `https://twitter.com/intent/tweet?text=${text}`,
        linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(content.url)}`,
        whatsapp: `https://wa.me/?text=${text}`
    };

    window.open(urls[platform], '_blank', 'width=600,height=400');
}

export default {
    ACHIEVEMENTS,
    checkAchievements,
    generateCertificate,
    generateCertificateHTML,
    generateMockLeaderboard,
    AVAILABLE_CHALLENGES,
    shareToSocial,
    generateShareText
};
