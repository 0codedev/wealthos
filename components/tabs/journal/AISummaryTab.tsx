import React, { Suspense, lazy } from 'react';
import { motion } from 'framer-motion';
import { DashboardSkeleton } from '../../shared/Skeleton';
import { ErrorBoundary } from '../../ErrorBoundary';

const BehavioralAudit = lazy(() =>
    import('../advisor/BehavioralAudit').then(m => ({ default: m.BehavioralAudit }))
);

/**
 * AI Summary tab — surfaces the BehavioralAudit / SWOT-style trading analysis
 * as a full standalone journal sub-tab, matching TradeDiary's "AI Summarizer" page.
 */
const AISummaryTab: React.FC = () => {
    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="flex flex-col h-full gap-6"
        >
            {/* Page header */}
            <div className="flex-shrink-0">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">AI Trading Analysis</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    AI-powered SWOT audit of your trading journal — strengths, weaknesses, and priority actions
                </p>
            </div>

            <ErrorBoundary message="AI Summary encountered an error." layout="card">
                <Suspense fallback={<DashboardSkeleton />}>
                    <BehavioralAudit />
                </Suspense>
            </ErrorBoundary>
        </motion.div>
    );
};

export default AISummaryTab;
