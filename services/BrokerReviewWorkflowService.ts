import { db, Trade } from '../database';

const hasTradeNotes = (trade: Trade) =>
    Boolean(trade.notes?.trim() || trade.ahaMoment?.trim());

const hasTradeScreenshots = (trade: Trade) =>
    Boolean(
        trade.screenshot ||
        trade.screenshotHTF ||
        trade.screenshotEntry ||
        trade.screenshotExit ||
        trade.screenshots?.length
    );

const hasLesson = (trade: Trade) => Boolean(trade.coreLesson?.trim());

const isBrokerImportedTrade = (trade: Trade) =>
    trade.isImported || trade.broker === 'dhan' || trade.source === 'dhan' || !!trade.reviewStatus;

export const resolveTradeReviewStatus = (trade: Trade): Trade['reviewStatus'] => {
    if (!isBrokerImportedTrade(trade)) {
        return trade.reviewStatus;
    }

    if (!hasTradeNotes(trade)) {
        return 'NEEDS_ANNOTATION';
    }

    if (!hasTradeScreenshots(trade)) {
        return 'NEEDS_SCREENSHOTS';
    }

    if (!hasLesson(trade)) {
        return 'READY_FOR_LESSON';
    }

    return 'ANNOTATED';
};

export const refreshImportedTradeReviewQueue = async (): Promise<number> => {
    try {
        const importedTrades = await db.trades
            .filter((trade) => isBrokerImportedTrade(trade))
            .toArray();

        let updated = 0;
        for (const trade of importedTrades) {
            const nextStatus = resolveTradeReviewStatus(trade);
            if (trade.id && nextStatus !== trade.reviewStatus) {
                await db.trades.update(trade.id, { reviewStatus: nextStatus });
                updated += 1;
            }
        }

        return updated;
    } catch (error) {
        console.error('Failed to refresh trade review queue', error);
        return 0;
    }
};

export const getBrokerReviewQueue = (trades: Trade[]) =>
    trades.filter(
        (trade) =>
            isBrokerImportedTrade(trade) &&
            trade.reviewStatus &&
            trade.reviewStatus !== 'ANNOTATED'
    );

export interface BrokerReviewStatusMeta {
    label: string;
    shortLabel: string;
    description: string;
    recommendedStep: 4 | 5;
}

export const getBrokerReviewStatusMeta = (
    status?: Trade['reviewStatus']
): BrokerReviewStatusMeta => {
    switch (status) {
        case 'NEEDS_ANNOTATION':
            return {
                label: 'Needs Annotation',
                shortLabel: 'Annotation',
                description: 'Capture execution notes first so this imported trade has context before screenshots and lessons.',
                recommendedStep: 4,
            };
        case 'NEEDS_SCREENSHOTS':
            return {
                label: 'Needs Screenshots',
                shortLabel: 'Screenshots',
                description: 'Evidence is still missing. Add HTF, entry, or exit screenshots so the review is visually grounded.',
                recommendedStep: 4,
            };
        case 'READY_FOR_LESSON':
            return {
                label: 'Ready For Lesson',
                shortLabel: 'Lesson',
                description: 'The raw review is in place. Finish the loop by writing the one core lesson from this execution.',
                recommendedStep: 5,
            };
        case 'ANNOTATED':
            return {
                label: 'Review Complete',
                shortLabel: 'Complete',
                description: 'This imported trade has enough context, evidence, and lesson capture to count as reviewed.',
                recommendedStep: 5,
            };
        default:
            return {
                label: 'Review Pending',
                shortLabel: 'Pending',
                description: 'This trade still needs review work before it becomes a fully annotated lesson.',
                recommendedStep: 4,
            };
    }
};

export interface BrokerReviewQueueSummary {
    total: number;
    needsAnnotation: number;
    needsScreenshots: number;
    readyForLesson: number;
    nextTrade: Trade | null;
}

export const summarizeBrokerReviewQueue = (trades: Trade[]): BrokerReviewQueueSummary => {
    const queue = getBrokerReviewQueue(trades);

    return {
        total: queue.length,
        needsAnnotation: queue.filter((trade) => trade.reviewStatus === 'NEEDS_ANNOTATION').length,
        needsScreenshots: queue.filter((trade) => trade.reviewStatus === 'NEEDS_SCREENSHOTS').length,
        readyForLesson: queue.filter((trade) => trade.reviewStatus === 'READY_FOR_LESSON').length,
        nextTrade: queue[0] || null,
    };
};
