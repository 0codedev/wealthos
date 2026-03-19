import { db, Friend, IPOApplication } from '../database';
import { findMatchingVaultFriend, normalizeSyndicateName } from './SyndicateNameResolver';

export interface ReconciliationResult {
    totalAccountsAudited: number;
    accountsCorrected: number;
    totalBalanceAdjusted: number;
    corrections: {
        memberName: string;
        oldBalance: number;
        newBalance: number;
        difference: number;
        reason: string;
    }[];
}

/**
 * Calculates the exact mathematical balance from a friend's history ledger.
 * Handles all debit/credit classifications with strict precision.
 */
export const calculateBalanceFromHistory = (friend: Friend): number => {
    const history = friend.history || [];
    if (!history || history.length === 0) {
        // If no history exists, preserve existing balance as baseline
        return Number(friend.balance) || 0;
    }

    // Check for explicit CALIBRATION checkpoint (search newest to oldest)
    let latestCalibIdx = -1;
    let baselineBalance = 0;

    for (let i = history.length - 1; i >= 0; i--) {
        const h = history[i];
        const type = (h.type || '').toUpperCase().trim();
        const notes = (h.notes || '').toLowerCase().trim();

        if (type === 'CALIBRATION' || notes.includes('direct balance calibration') || notes.includes('calibration')) {
            latestCalibIdx = i;
            const match = notes.match(/set to [^0-9]*([0-9,]+(\.[0-9]+)?)/i);
            if (match && match[1]) {
                baselineBalance = parseFloat(match[1].replace(/,/g, ''));
            } else {
                baselineBalance = Math.abs(Number(h.amount) || 0);
            }
            break;
        }
    }

    let calculatedBalance = 0;
    let startIdx = 0;

    if (latestCalibIdx >= 0) {
        calculatedBalance = baselineBalance;
        startIdx = latestCalibIdx + 1; // Only replay transactions occurring after the calibration checkpoint
    } else {
        // Check if history has an initial funding/deposit entry
        const hasInitialDeposit = history.some(h => {
            const type = (h.type || '').toUpperCase().trim();
            const notes = (h.notes || '').toLowerCase().trim();
            return type === 'DEPOSIT' || notes.includes('initial balance') || notes.includes('master treasury initialized');
        });

        if (!hasInitialDeposit) {
            // Member was created with initial capital before ledger history tracking.
            // Do not wipe their balance to 0 or negative.
            return Number(Number(friend.balance || 0).toFixed(2));
        }
    }

    for (let i = startIdx; i < history.length; i++) {
        const h = history[i];
        const amt = Math.abs(Number(h.amount) || 0);
        if (isNaN(amt) || amt === 0) continue;

        const type = (h.type || '').toUpperCase().trim();
        const notes = (h.notes || '').toLowerCase().trim();

        // 1. Primary check by explicit transaction type
        if (type === 'PROFIT' || type === 'REFUND' || type === 'DEPOSIT' || type === 'TRANSFER_IN') {
            calculatedBalance += amt;
            continue;
        }

        if (type === 'WITHDRAW' || type === 'BLOCKED' || type === 'TRANSFER_OUT') {
            calculatedBalance -= amt;
            continue;
        }

        // 2. Secondary check by semantic notes (for legacy or untyped records)
        if (notes.includes('received from') || notes.includes('from self') || notes.includes('initial balance')) {
            calculatedBalance += amt;
        } else if (notes.includes('transferred to') || notes.includes('returned to') || notes.includes('applied for')) {
            calculatedBalance -= amt;
        } else {
            // Default fallback based on sign if positive/negative
            if (Number(h.amount) < 0) {
                calculatedBalance -= amt;
            } else {
                calculatedBalance += amt;
            }
        }
    }

    return Number(calculatedBalance.toFixed(2));
};

/**
 * Audits and reconciles all Syndicate Vault accounts against both:
 * 1. Active IPO applications in db.ipo_applications (auto-injects missing BLOCKED entries)
 * 2. Immutable transaction history ledger (replays mathematical ground truth)
 */
export const reconcileVaultBalances = async (): Promise<ReconciliationResult> => {
    const rawFriends = await db.friends.toArray();
    const friends = rawFriends.filter(f => !(f as any).isDeleted);
    const rawApps = await db.ipo_applications.toArray();
    const applications = rawApps.filter(a => !(a as any).isDeleted);

    const corrections: ReconciliationResult['corrections'] = [];
    let totalBalanceAdjusted = 0;

    for (const friend of friends) {
        let history = [...(friend.history || [])];
        let historyUpdated = false;

        // 1. Audit active IPO applications for this member with STRICT exact name matching
        const memberApps = applications.filter(app => {
            if (!app.applicantName) return false;
            const target = app.applicantName.trim().toLowerCase();
            const friendName = friend.name.trim().toLowerCase();
            return target === friendName;
        });

        for (const app of memberApps) {
            if (app.status === 'BLOCKED') {
                // Check if this application has a matching BLOCKED entry in friend's history
                const hasBlockEntry = history.some(h => {
                    const type = (h.type || '').toUpperCase();
                    const notes = (h.notes || '').toLowerCase();
                    const cleanAppIpo = (app.ipoName || '').toLowerCase().replace(/ipo/g, '').trim();
                    return (type === 'BLOCKED' || notes.includes('applied for')) && 
                           (notes.includes(cleanAppIpo) || Math.abs(h.amount - app.amount) < 1);
                });

                if (!hasBlockEntry) {
                    // Inject missing BLOCKED debit into history
                    history.push({
                        date: app.appliedDate || new Date().toISOString(),
                        amount: app.amount || 0,
                        type: 'BLOCKED',
                        notes: `Applied for ${app.ipoName}`
                    });
                    historyUpdated = true;
                }
            }
        }

        const friendWithHistory = { ...friend, history };
        const replayedBalance = calculateBalanceFromHistory(friendWithHistory);
        const currentBalance = Math.round((Number(friend.balance) || 0) * 100) / 100;

        // If balance discrepancy or history updated
        if (Math.abs(replayedBalance - currentBalance) > 0.05 || historyUpdated) {
            const diff = replayedBalance - currentBalance;
            await db.friends.update(friend.id!, {
                balance: replayedBalance,
                history: history,
                updated_at: Date.now()
            } as any);

            corrections.push({
                memberName: friend.name,
                oldBalance: currentBalance,
                newBalance: replayedBalance,
                difference: diff,
                reason: historyUpdated 
                    ? `Synced missing IPO mandate blocks & realigned ledger`
                    : `Realigned with ${history.length} ledger transactions`
            });

            totalBalanceAdjusted += Math.abs(diff);
        }
    }

    return {
        totalAccountsAudited: friends.length,
        accountsCorrected: corrections.length,
        totalBalanceAdjusted,
        corrections
    };
};
