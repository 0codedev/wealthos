/**
 * InvestmentClubService - Family/Friends group portfolios and shared goals
 * Covers: Collaborative investing, shared watchlists, group challenges
 */

// ==================== CLUB TYPES ====================

export interface ClubMember {
    id: string;
    name: string;
    email?: string;
    role: 'admin' | 'member' | 'viewer';
    joinedAt: string;
    contributionPercent?: number;
    avatar?: string;
}

export interface SharedGoal {
    id: string;
    title: string;
    targetAmount: number;
    currentAmount: number;
    deadline: string;
    contributions: Array<{
        memberId: string;
        amount: number;
        date: string;
    }>;
    status: 'active' | 'completed' | 'failed';
}

export interface SharedWatchlist {
    id: string;
    name: string;
    stocks: Array<{
        symbol: string;
        addedBy: string;
        addedAt: string;
        notes?: string;
        targetPrice?: number;
    }>;
    createdAt: string;
}

export interface ClubDiscussion {
    id: string;
    authorId: string;
    authorName: string;
    content: string;
    timestamp: string;
    reactions: Record<string, string[]>; // emoji -> memberIds
    replies?: ClubDiscussion[];
}

export interface InvestmentClub {
    id: string;
    name: string;
    description: string;
    createdAt: string;
    createdBy: string;
    members: ClubMember[];
    sharedGoals: SharedGoal[];
    watchlists: SharedWatchlist[];
    discussions: ClubDiscussion[];
    settings: {
        isPrivate: boolean;
        requireApproval: boolean;
        showContributions: boolean;
        allowDiscussions: boolean;
    };
    stats: {
        totalContributions: number;
        goalsCompleted: number;
        activeMembers: number;
    };
}

// ==================== CLUB MANAGEMENT ====================

class InvestmentClubManager {
    private clubs: InvestmentClub[] = [];
    private storageKey = 'wealth_aggregator_clubs';

    constructor() {
        this.loadFromStorage();
    }

    private loadFromStorage(): void {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                this.clubs = JSON.parse(stored);
            }
        } catch {
            this.clubs = [];
        }
    }

    private saveToStorage(): void {
        localStorage.setItem(this.storageKey, JSON.stringify(this.clubs));
    }

    /**
     * Create a new investment club
     */
    createClub(
        name: string,
        description: string,
        creatorId: string,
        creatorName: string
    ): InvestmentClub {
        const club: InvestmentClub = {
            id: `club-${Date.now()}`,
            name,
            description,
            createdAt: new Date().toISOString(),
            createdBy: creatorId,
            members: [{
                id: creatorId,
                name: creatorName,
                role: 'admin',
                joinedAt: new Date().toISOString()
            }],
            sharedGoals: [],
            watchlists: [],
            discussions: [],
            settings: {
                isPrivate: true,
                requireApproval: true,
                showContributions: true,
                allowDiscussions: true
            },
            stats: {
                totalContributions: 0,
                goalsCompleted: 0,
                activeMembers: 1
            }
        };

        this.clubs.push(club);
        this.saveToStorage();
        return club;
    }

    /**
     * Get all clubs for a user
     */
    getUserClubs(userId: string): InvestmentClub[] {
        return this.clubs.filter(club =>
            club.members.some(m => m.id === userId)
        );
    }

    /**
     * Add member to club
     */
    addMember(
        clubId: string,
        member: Omit<ClubMember, 'joinedAt'>
    ): boolean {
        const club = this.clubs.find(c => c.id === clubId);
        if (!club) return false;

        if (club.members.some(m => m.id === member.id)) {
            return false; // Already a member
        }

        club.members.push({
            ...member,
            joinedAt: new Date().toISOString()
        });
        club.stats.activeMembers = club.members.length;

        this.saveToStorage();
        return true;
    }

    /**
     * Create shared goal
     */
    createSharedGoal(
        clubId: string,
        title: string,
        targetAmount: number,
        deadline: string
    ): SharedGoal | null {
        const club = this.clubs.find(c => c.id === clubId);
        if (!club) return null;

        const goal: SharedGoal = {
            id: `goal-${Date.now()}`,
            title,
            targetAmount,
            currentAmount: 0,
            deadline,
            contributions: [],
            status: 'active'
        };

        club.sharedGoals.push(goal);
        this.saveToStorage();
        return goal;
    }

    /**
     * Add contribution to goal
     */
    contributeToGoal(
        clubId: string,
        goalId: string,
        memberId: string,
        amount: number
    ): boolean {
        const club = this.clubs.find(c => c.id === clubId);
        if (!club) return false;

        const goal = club.sharedGoals.find(g => g.id === goalId);
        if (!goal || goal.status !== 'active') return false;

        goal.contributions.push({
            memberId,
            amount,
            date: new Date().toISOString()
        });
        goal.currentAmount += amount;
        club.stats.totalContributions += amount;

        // Check if goal is completed
        if (goal.currentAmount >= goal.targetAmount) {
            goal.status = 'completed';
            club.stats.goalsCompleted++;
        }

        this.saveToStorage();
        return true;
    }

    /**
     * Add to shared watchlist
     */
    addToWatchlist(
        clubId: string,
        watchlistId: string,
        symbol: string,
        addedBy: string,
        notes?: string
    ): boolean {
        const club = this.clubs.find(c => c.id === clubId);
        if (!club) return false;

        let watchlist = club.watchlists.find(w => w.id === watchlistId);

        if (!watchlist) {
            watchlist = {
                id: watchlistId || `watch-${Date.now()}`,
                name: 'Default',
                stocks: [],
                createdAt: new Date().toISOString()
            };
            club.watchlists.push(watchlist);
        }

        if (watchlist.stocks.some(s => s.symbol === symbol)) {
            return false; // Already in watchlist
        }

        watchlist.stocks.push({
            symbol,
            addedBy,
            addedAt: new Date().toISOString(),
            notes
        });

        this.saveToStorage();
        return true;
    }

    /**
     * Post discussion
     */
    postDiscussion(
        clubId: string,
        authorId: string,
        authorName: string,
        content: string
    ): ClubDiscussion | null {
        const club = this.clubs.find(c => c.id === clubId);
        if (!club || !club.settings.allowDiscussions) return null;

        const discussion: ClubDiscussion = {
            id: `disc-${Date.now()}`,
            authorId,
            authorName,
            content,
            timestamp: new Date().toISOString(),
            reactions: {},
            replies: []
        };

        club.discussions.unshift(discussion);

        // Keep only last 100 discussions
        if (club.discussions.length > 100) {
            club.discussions = club.discussions.slice(0, 100);
        }

        this.saveToStorage();
        return discussion;
    }

    /**
     * Get club leaderboard
     */
    getClubLeaderboard(clubId: string): Array<{
        member: ClubMember;
        totalContributed: number;
        goalsContributed: number;
        rank: number;
    }> {
        const club = this.clubs.find(c => c.id === clubId);
        if (!club) return [];

        const contributions: Record<string, { total: number; goals: number }> = {};

        club.sharedGoals.forEach(goal => {
            goal.contributions.forEach(c => {
                if (!contributions[c.memberId]) {
                    contributions[c.memberId] = { total: 0, goals: 0 };
                }
                contributions[c.memberId].total += c.amount;
                contributions[c.memberId].goals++;
            });
        });

        const leaderboard = club.members.map(member => ({
            member,
            totalContributed: contributions[member.id]?.total || 0,
            goalsContributed: contributions[member.id]?.goals || 0,
            rank: 0
        }));

        leaderboard.sort((a, b) => b.totalContributed - a.totalContributed);
        leaderboard.forEach((entry, index) => entry.rank = index + 1);

        return leaderboard;
    }

    /**
     * Generate invite link
     */
    generateInviteLink(clubId: string): string {
        const club = this.clubs.find(c => c.id === clubId);
        if (!club) return '';

        const token = btoa(JSON.stringify({ clubId, created: Date.now() }));
        return `${window.location.origin}/join-club?invite=${token}`;
    }

    /**
     * Delete club
     */
    deleteClub(clubId: string, userId: string): boolean {
        const clubIndex = this.clubs.findIndex(c => c.id === clubId);
        if (clubIndex === -1) return false;

        const club = this.clubs[clubIndex];
        if (club.createdBy !== userId) return false;

        this.clubs.splice(clubIndex, 1);
        this.saveToStorage();
        return true;
    }
}

export const investmentClubManager = new InvestmentClubManager();

// ==================== PEER COMPARISON ====================

export interface PeerBenchmark {
    category: string;
    userValue: number;
    peerAverage: number;
    peerMedian: number;
    percentile: number;
    insight: string;
}

export function generatePeerComparison(
    portfolioValue: number,
    monthlyInvestment: number,
    age: number,
    riskScore: number
): PeerBenchmark[] {
    // Mock peer data (in production, aggregate anonymously)
    const peerData = {
        portfolioByAge: {
            '20-25': { avg: 150000, median: 100000 },
            '25-30': { avg: 500000, median: 350000 },
            '30-35': { avg: 1200000, median: 800000 },
            '35-40': { avg: 2500000, median: 1800000 },
            '40-50': { avg: 5000000, median: 3500000 },
        },
        sipByAge: {
            '20-25': { avg: 8000, median: 5000 },
            '25-30': { avg: 15000, median: 10000 },
            '30-35': { avg: 25000, median: 20000 },
            '35-40': { avg: 40000, median: 30000 },
            '40-50': { avg: 60000, median: 45000 },
        }
    };

    const ageGroup = age < 25 ? '20-25' : age < 30 ? '25-30' : age < 35 ? '30-35' : age < 40 ? '35-40' : '40-50';

    const portfolioPeer = peerData.portfolioByAge[ageGroup as keyof typeof peerData.portfolioByAge];
    const sipPeer = peerData.sipByAge[ageGroup as keyof typeof peerData.sipByAge];

    const portfolioPercentile = Math.min(99, Math.max(1,
        Math.round((1 - Math.exp(-portfolioValue / portfolioPeer.avg)) * 100)
    ));

    const sipPercentile = Math.min(99, Math.max(1,
        Math.round((1 - Math.exp(-monthlyInvestment / sipPeer.avg)) * 100)
    ));

    return [
        {
            category: 'Portfolio Value',
            userValue: portfolioValue,
            peerAverage: portfolioPeer.avg,
            peerMedian: portfolioPeer.median,
            percentile: portfolioPercentile,
            insight: portfolioPercentile > 70
                ? `You're in the top ${100 - portfolioPercentile}% of investors your age! 🎉`
                : portfolioPercentile > 50
                    ? 'You\'re doing better than most of your peers!'
                    : 'Room to grow - consider increasing your investments'
        },
        {
            category: 'Monthly Investment',
            userValue: monthlyInvestment,
            peerAverage: sipPeer.avg,
            peerMedian: sipPeer.median,
            percentile: sipPercentile,
            insight: sipPercentile > 70
                ? `Your savings rate is impressive! Top ${100 - sipPercentile}%`
                : sipPercentile > 50
                    ? 'Good steady investing habit!'
                    : 'Try to increase your monthly SIP'
        },
        {
            category: 'Risk Profile',
            userValue: riskScore,
            peerAverage: 55,
            peerMedian: 50,
            percentile: riskScore,
            insight: riskScore > 70
                ? 'Aggressive investor - higher potential but more volatility'
                : riskScore > 40
                    ? 'Balanced approach - good for long-term wealth building'
                    : 'Conservative investor - consider more equity for growth'
        }
    ];
}

export default {
    investmentClubManager,
    generatePeerComparison
};
