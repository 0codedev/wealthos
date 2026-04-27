import React, { Suspense, lazy, useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { DashboardSkeleton } from '../../shared/Skeleton';
import { ErrorBoundary } from '../../ErrorBoundary';
import { liveQuery } from 'dexie';
import { db, Trade, DailyReview } from '../../../database';
import { deleteWithUndo } from '../../../lib/deleteWithUndo';
import { consumeUndo } from '../../../lib/undoStack';
import { COPY } from '../../../utils/appCopy';
import { useToast } from '../../shared/ToastProvider';
import { useSandboxStore } from '../../../store/sandboxStore';

const JournalCalendarView = lazy(() => import('../../journal/JournalCalendarView'));

const CalendarTab: React.FC = () => {
    const { toast } = useToast();
    const isSandboxMode = useSandboxStore(state => state.isSandboxMode);
    const [trades, setTrades] = useState<Trade[]>([]);
    const [dailyReviews, setDailyReviews] = useState<DailyReview[]>([]);
    const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);

    useEffect(() => {
        const subTrades = liveQuery(() => db.trades.filter((t: any) => !t.isDeleted).toArray()).subscribe(setTrades);
        const subReviews = liveQuery(() => db.daily_reviews.toArray()).subscribe(setDailyReviews);
        return () => {
            subTrades.unsubscribe();
            subReviews.unsubscribe();
        };
    }, []);

    const modeTrades = useMemo(() => {
        return trades.filter(t => isSandboxMode ? t.source === 'SANDBOX' : t.source !== 'SANDBOX');
    }, [trades, isSandboxMode]);

    const handleDeleteTrade = useCallback(async (tradeId: number) => {
        const t = trades.find(x => x.id === tradeId);
        const label = t?.ticker ?? 'Trade';
        const entryId = await deleteWithUndo({
            table: 'trades',
            id: tradeId,
            kind: 'trade',
            label,
            message: COPY.undo.tradeDeleted(label),
        });
        if (!entryId) {
            toast.error(COPY.undo.failed);
            return;
        }
        toast.success(COPY.undo.tradeDeleted(label), {
            duration: 30000,
            action: { label: 'Undo', onClick: () => { void consumeUndo(entryId)?.undo(); } },
        });
    }, [trades, toast]);

    const selectedDayReview = useMemo(() => {
        return selectedCalendarDate
            ? dailyReviews.find(r => r.date === selectedCalendarDate) || null
            : null;
    }, [dailyReviews, selectedCalendarDate]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="flex flex-col h-full tab-content"
        >
            <ErrorBoundary message="Calendar view encountered an error." layout="card">
                <Suspense fallback={<DashboardSkeleton />}>
                    <JournalCalendarView
                        trades={modeTrades}
                        dailyReviews={dailyReviews}
                        selectedCalendarDate={selectedCalendarDate}
                        setSelectedCalendarDate={setSelectedCalendarDate}
                        selectedDayReview={selectedDayReview}
                        onOpenDailyReviewModal={() => {}}
                        onTradeClick={() => {}}
                        onDeleteTrade={handleDeleteTrade}
                    />
                </Suspense>
            </ErrorBoundary>
        </motion.div>
    );
};

export default CalendarTab;
