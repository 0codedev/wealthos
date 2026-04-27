import React, { Suspense, lazy } from 'react';
import { motion } from 'framer-motion';
import { DashboardSkeleton } from '../../shared/Skeleton';
import { ErrorBoundary } from '../../ErrorBoundary';

const PreTradeChecklist = lazy(() => import('../../journal/PreTradeChecklist'));

const ChecklistTab: React.FC = () => {
    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="flex flex-col h-full"
        >
            <ErrorBoundary message="Trading Checklist encountered an error." layout="card">
                <Suspense fallback={<DashboardSkeleton />}>
                    <PreTradeChecklist />
                </Suspense>
            </ErrorBoundary>
        </motion.div>
    );
};

export default ChecklistTab;
