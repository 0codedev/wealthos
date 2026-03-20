import { Trade, SyncRecordRow } from '../database';
import { Investment } from '../types';
import { generateSmartActions } from './ActionCenterService';
import { summarizeJournalPerformance } from './JournalPerformanceService';
import { generatePortfolioActionProposals } from './PortfolioActionService';
import { BrokerExecutionHandoff } from './BrokerExecutionHandoffService';

export interface UnifiedCommandInsight {
    id: string;
    title: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    lane: 'broker' | 'portfolio' | 'journal';
    action: string;
}

const priorityRank = { high: 0, medium: 1, low: 2 };

export const buildUnifiedCommandInsights = (
    investments: Investment[],
    trades: Trade[],
    syncRecords: SyncRecordRow[],
    allocationTargets: Record<string, number>,
    executionHandoffs: BrokerExecutionHandoff[] = [],
): UnifiedCommandInsight[] => {
    const insights: UnifiedCommandInsight[] = [];

    if (executionHandoffs.length > 0) {
        const latestExecution = executionHandoffs[0];
        insights.push({
            id: `execution-${latestExecution.id}`,
            title: `Verify fresh ${latestExecution.action.toLowerCase()} execution in Dhan`,
            description: `${latestExecution.ticker} was just sent via ${latestExecution.orderStyle} flow. Refresh broker state and confirm sync before trusting the book.`,
            priority: 'high',
            lane: 'broker',
            action: 'broker-sync',
        });
    }

    const smartActions = generateSmartActions(investments, trades, syncRecords);
    for (const action of smartActions) {
        insights.push({
            id: `smart-${action.id}`,
            title: action.title,
            description: action.description,
            priority: action.priority,
            lane: action.action === 'broker-sync' || action.action === 'trade-review' ? 'broker' : 'portfolio',
            action: action.action,
        });
    }

    const portfolioActions = generatePortfolioActionProposals(investments, allocationTargets)
        .slice(0, 3)
        .map<UnifiedCommandInsight>((proposal) => ({
            id: `proposal-${proposal.id}`,
            title: proposal.title,
            description: proposal.summary,
            priority: proposal.priority,
            lane: 'portfolio',
            action: proposal.category,
        }));
    insights.push(...portfolioActions);

    const journalSummary = summarizeJournalPerformance(trades);
    if (journalSummary.tradeCount >= 3) {
        if (journalSummary.processScore < 65) {
            insights.push({
                id: 'journal-process',
                title: 'Repair trade process discipline',
                description: `Process score is ${journalSummary.processScore.toFixed(0)}. Review checklist use, mistakes, and post-trade annotations.`,
                priority: 'high',
                lane: 'journal',
                action: 'journal-coach',
            });
        }

        if (journalSummary.weakestSetup) {
            insights.push({
                id: 'journal-weak-setup',
                title: `Review ${journalSummary.weakestSetup.setup}`,
                description: `${journalSummary.weakestSetup.setup} is your weakest recurring setup by expectancy right now.`,
                priority: 'medium',
                lane: 'journal',
                action: 'journal-coach',
            });
        }

        if (journalSummary.bestSetup && journalSummary.expectancy > 0) {
            insights.push({
                id: 'journal-best-setup',
                title: `Press your ${journalSummary.bestSetup.setup} edge`,
                description: `${journalSummary.bestSetup.setup} is leading your playbook. Keep sizing disciplined around that edge.`,
                priority: 'low',
                lane: 'journal',
                action: 'journal-coach',
            });
        }
    }

    const deduped = insights.filter((insight, index, collection) =>
        collection.findIndex((candidate) => candidate.title === insight.title) === index
    );

    return deduped
        .sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority])
        .slice(0, 6);
};
