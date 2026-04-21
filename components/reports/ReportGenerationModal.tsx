import React, { useState } from 'react';
import { FileText, Download, Sparkles, X, Check, Loader2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { modalOverlayVariants, modalContentVariants } from '../ui/animations';
import { usePortfolio } from '../../hooks/usePortfolio';
import { Investment, AggregatedData } from '../../types';

interface ReportGenerationModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentStats: any;
    investments: Investment[];
    allocationData: AggregatedData[];
}

const ReportGenerationModal: React.FC<ReportGenerationModalProps> = ({
    isOpen,
    onClose,
    currentStats,
    investments,
    allocationData
}) => {
    const [period, setPeriod] = useState<'MONTH' | 'QUARTER' | 'YTD'>('MONTH');
    const [includeAI, setIncludeAI] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [status, setStatus] = useState<string>('');

    const handleGenerate = async () => {
        setIsGenerating(true);
        setStatus('Preparing Data...');

        try {
            const reportService = await import('../../services/ReportService');
            let aiText = '';

            if (includeAI) {
                setStatus('Consulting AI Analyst (This may take 10s)...');
                // Mock pause if needed, but the API call is real
                // await new Promise(r => setTimeout(r, 1000)); 
                try {
                    aiText = await reportService.generateAIAnalysis({
                        investments,
                        stats: currentStats,
                        allocationData
                    });
                } catch (e) {
                    console.error("AI Generation Failed", e);
                    // Continue without AI if it fails, but maybe warn?
                }
            }

            setStatus('Rendering PDF...');
            await reportService.generateMonthlyReport({
                investments,
                stats: currentStats,
                allocationData,
                aiAnalysis: aiText
            });

            setStatus('Done!');
            setTimeout(() => {
                onClose();
                setIsGenerating(false);
                setStatus('');
            }, 1000);

        } catch (error) {
            console.error(error);
            setStatus('Error Generating Report');
            setIsGenerating(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 pointer-events-auto">
                    <motion.div
                        variants={modalOverlayVariants}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
                        onClick={onClose}
                    />
                    <motion.div
                        variants={modalContentVariants}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200 dark:border-slate-800 relative z-10"
                    >
                        {/* Header */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-start">
                            <div>
                                <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                    <FileText className="text-indigo-600 dark:text-indigo-400" />
                                    Report Generator
                                </h2>
                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Professional export for your records.</p>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="p-6 space-y-6">
                            {/* Period Selection */}
                            <div className="space-y-3">
                                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Time Period</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {['MONTH', 'QUARTER', 'YTD'].map((p) => (
                                        <button
                                            key={p}
                                            onClick={() => setPeriod(p as any)}
                                            className={`px-3 py-2 rounded-lg text-sm font-bold border transition-all ${period === p
                                                ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-300'
                                                }`}
                                        >
                                            {p === 'MONTH' ? 'Last Month' : p === 'QUARTER' ? 'Last Qtr' : 'YTD'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Options */}
                            <div className="space-y-3">
                                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Content Options</label>

                                <div
                                    onClick={() => !isGenerating && setIncludeAI(!includeAI)}
                                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-center justify-between ${includeAI
                                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                                        : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300'
                                        }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${includeAI ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                                            <Sparkles size={20} />
                                        </div>
                                        <div>
                                            <p className={`font-bold ${includeAI ? 'text-indigo-900 dark:text-indigo-100' : 'text-slate-700 dark:text-slate-300'}`}>AI Market Commentary</p>
                                            <p className="text-xs text-slate-500">Adds personalized insights (slower)</p>
                                        </div>
                                    </div>
                                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${includeAI ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300'}`}>
                                        {includeAI && <Check size={14} />}
                                    </div>
                                </div>
                            </div>

                            {/* Status Feedback */}
                            {status && (
                                <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg text-sm text-slate-600 dark:text-slate-300 animate-in fade-in">
                                    {isGenerating && <Loader2 size={16} className="animate-spin text-indigo-600" />}
                                    {status}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-6 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                            <button
                                onClick={onClose}
                                disabled={isGenerating}
                                className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleGenerate}
                                disabled={isGenerating}
                                className="flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-bold shadow-lg shadow-indigo-500/30 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                                {isGenerating ? 'Generating...' : (
                                    <>
                                        <Download size={16} />
                                        Generate PDF
                                    </>
                                )}
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default ReportGenerationModal;
