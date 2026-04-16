import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    Download, Upload, FileText, Cpu, CheckCircle2, 
    X, AlertCircle, RefreshCw, Table as TableIcon, 
    ExternalLink, Sparkles, ShieldCheck, ArrowRight
} from 'lucide-react';
import { 
    gatherTradeJournalData, 
    exportMachineReadableJSON, 
    exportHumanReadableHTML, 
    exportCSV, 
    restoreTradeJournalFromJSON,
    RestoreJournalResult
} from '../../services/journal/TradeJournalExportService';
import { useToast } from '../shared/ToastProvider';

interface TradeJournalExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onRestoreSuccess?: () => void;
}

export const TradeJournalExportModal: React.FC<TradeJournalExportModalProps> = ({
    isOpen,
    onClose,
    onRestoreSuccess
}) => {
    const [activeTab, setActiveTab] = useState<'EXPORT' | 'RESTORE'>('EXPORT');
    const [isExporting, setIsExporting] = useState<string | null>(null);
    const [isRestoring, setIsRestoring] = useState(false);
    
    // Live counts preview
    const [counts, setCounts] = useState<{
        trades: number;
        mistakes: number;
        dailyReviews: number;
        strategies: number;
    }>({ trades: 0, mistakes: 0, dailyReviews: 0, strategies: 0 });

    // Restore file state
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [restorePreview, setRestorePreview] = useState<{
        exportedAt?: string;
        counts?: Record<string, number>;
        netPnL?: number;
        winRate?: number;
    } | null>(null);
    const [restoreError, setRestoreError] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();

    // Fetch initial counts when opened
    useEffect(() => {
        if (!isOpen) return;
        gatherTradeJournalData().then(data => {
            setCounts({
                trades: data.trades.length,
                mistakes: data.mistakes.length,
                dailyReviews: data.dailyReviews.length,
                strategies: data.strategies.length
            });
        }).catch(() => {});
    }, [isOpen]);

    const handleExportJSON = async () => {
        setIsExporting('JSON');
        try {
            const res = await exportMachineReadableJSON();
            toast.success(`Exported ${res.counts.trades} trades to ${res.fileName}`);
            setTimeout(() => onClose(), 800);
        } catch (e: any) {
            toast.error(e?.message || 'Failed to export JSON');
        } finally {
            setIsExporting(null);
        }
    };

    const handleExportHTML = async () => {
        setIsExporting('HTML');
        try {
            const res = await exportHumanReadableHTML();
            toast.success(`Generated standalone visual dossier: ${res.fileName}`);
            setTimeout(() => onClose(), 800);
        } catch (e: any) {
            toast.error(e?.message || 'Failed to export HTML');
        } finally {
            setIsExporting(null);
        }
    };

    const handleExportCSV = async () => {
        setIsExporting('CSV');
        try {
            const res = await exportCSV();
            toast.success(`Exported ${res.tradeCount} trades to CSV spreadsheet`);
            setTimeout(() => onClose(), 800);
        } catch (e: any) {
            toast.error(e?.message || 'Failed to export CSV');
        } finally {
            setIsExporting(null);
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setRestoreError(null);
        setSelectedFile(file);

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const text = event.target?.result as string;
                const parsed = JSON.parse(text);
                if (!parsed.data) {
                    throw new Error("Invalid format: missing 'data' object.");
                }
                setRestorePreview({
                    exportedAt: parsed.meta?.exportedAt,
                    counts: parsed.meta?.counts || {
                        trades: parsed.data.trades?.length || 0,
                        mistakes: parsed.data.mistakes?.length || 0
                    },
                    netPnL: parsed.meta?.aiSummary?.netPnL,
                    winRate: parsed.meta?.aiSummary?.winRate
                });
            } catch (err: any) {
                setRestoreError(err?.message || 'Could not parse JSON file.');
                setRestorePreview(null);
            }
        };
        reader.readAsText(file);
    };

    const handleExecuteRestore = async () => {
        if (!selectedFile) return;
        setIsRestoring(true);
        setRestoreError(null);

        try {
            const text = await selectedFile.text();
            const result: RestoreJournalResult = await restoreTradeJournalFromJSON(text);

            if (result.success) {
                toast.success(`Successfully restored ${result.totalRows} trade journal records!`);
                if (onRestoreSuccess) onRestoreSuccess();
                setTimeout(() => onClose(), 600);
            } else {
                setRestoreError(result.error || 'Failed to restore trade journal.');
                toast.error(result.error || 'Restore failed');
            }
        } catch (err: any) {
            setRestoreError(err?.message || 'Error executing restore.');
            toast.error(err?.message || 'Restore error');
        } finally {
            setIsRestoring(false);
        }
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
                >
                    {/* Modal Header */}
                    <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between bg-slate-950/40">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                                <Download size={20} />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                                    Trade Journal Portability & Backup
                                    <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                        Pro
                                    </span>
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Surgically download or restore all trades, mistakes, reviews, and playbooks.
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={onClose}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {/* Mode Tabs */}
                    <div className="px-6 pt-3 pb-1 border-b border-white/[0.06] flex items-center justify-between bg-slate-950/20">
                        <div className="flex items-center gap-1 bg-slate-950/60 p-1 rounded-xl border border-white/[0.06]">
                            <button
                                type="button"
                                onClick={() => setActiveTab('EXPORT')}
                                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    activeTab === 'EXPORT'
                                        ? 'bg-indigo-600 text-white shadow-sm'
                                        : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                                }`}
                            >
                                Export Options
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('RESTORE')}
                                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    activeTab === 'RESTORE'
                                        ? 'bg-indigo-600 text-white shadow-sm'
                                        : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                                }`}
                            >
                                Restore to Device
                            </button>
                        </div>

                        {/* Live Counts Badge */}
                        <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono font-medium text-slate-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span>{counts.trades} Trades</span>
                            <span>·</span>
                            <span>{counts.mistakes} Mistakes</span>
                            <span>·</span>
                            <span>{counts.dailyReviews} Reviews</span>
                        </div>
                    </div>

                    {/* Modal Body */}
                    <div className="p-6 overflow-y-auto space-y-5">
                        {activeTab === 'EXPORT' ? (
                            <div className="space-y-4">
                                {/* Option 1: Machine-Readable (AI Agent & Restore Ready) */}
                                <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60 hover:border-indigo-500/40 transition-all flex flex-col justify-between group">
                                    <div className="flex items-start justify-between gap-4 mb-3">
                                        <div className="flex items-start gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0 mt-0.5">
                                                <Cpu size={22} />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h4 className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors">
                                                        Machine-Readable Export
                                                    </h4>
                                                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                                        JSON
                                                    </span>
                                                </div>
                                                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                                                    Complete normalized JSON with SHA-256 integrity checksum and pre-computed AI performance analytics.
                                                    Ideal for feeding directly to <strong>Claude, ChatGPT, Gemini, or DeepSeek</strong> for quantitative trade audits, or restoring to another computer.
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between">
                                        <div className="text-[11px] text-slate-400 flex items-center gap-1.5 font-mono">
                                            <Sparkles size={13} className="text-indigo-400" />
                                            <span>Full Schema + AI Summary Header</span>
                                        </div>
                                        <button
                                            type="button"
                                            disabled={isExporting !== null}
                                            onClick={handleExportJSON}
                                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all shadow-md shadow-indigo-600/20 flex items-center gap-2"
                                        >
                                            {isExporting === 'JSON' ? (
                                                <RefreshCw size={14} className="animate-spin" />
                                            ) : (
                                                <Download size={14} />
                                            )}
                                            Download AI-Ready JSON
                                        </button>
                                    </div>
                                </div>

                                {/* Option 2: Human-Readable (Visual Dossier & Spreadsheet) */}
                                <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60 hover:border-emerald-500/40 transition-all flex flex-col justify-between group">
                                    <div className="flex items-start justify-between gap-4 mb-3">
                                        <div className="flex items-start gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0 mt-0.5">
                                                <FileText size={22} />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h4 className="text-sm font-bold text-white group-hover:text-emerald-300 transition-colors">
                                                        Human-Readable Visual Dossier
                                                    </h4>
                                                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                                        HTML + CSV
                                                    </span>
                                                </div>
                                                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                                                    Standalone self-contained dark-mode report with interactive SVG equity curve, filterable trade ledger table, and mistake cost analysis.
                                                    Opens offline in any browser and formats into a PDF report via print (<kbd className="px-1 py-0.5 rounded bg-slate-800 text-[10px] font-mono border border-white/10">Ctrl+P</kbd>).
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between flex-wrap gap-2">
                                        <div className="text-[11px] text-slate-400 flex items-center gap-1.5 font-mono">
                                            <ShieldCheck size={13} className="text-emerald-400" />
                                            <span>Standalone · Zero Dependencies · Printable</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                disabled={isExporting !== null}
                                                onClick={handleExportCSV}
                                                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 hover:text-white rounded-lg text-xs font-bold border border-white/[0.08] transition-all flex items-center gap-1.5"
                                                title="Export raw tabular CSV for Microsoft Excel or Google Sheets"
                                            >
                                                {isExporting === 'CSV' ? (
                                                    <RefreshCw size={13} className="animate-spin" />
                                                ) : (
                                                    <TableIcon size={13} />
                                                )}
                                                CSV (Excel)
                                            </button>
                                            <button
                                                type="button"
                                                disabled={isExporting !== null}
                                                onClick={handleExportHTML}
                                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center gap-2"
                                            >
                                                {isExporting === 'HTML' ? (
                                                    <RefreshCw size={14} className="animate-spin" />
                                                ) : (
                                                    <ExternalLink size={14} />
                                                )}
                                                Visual Dossier (HTML)
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            /* Restore Tab */
                            <div className="space-y-4">
                                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-300 flex items-start gap-2.5">
                                    <AlertCircle size={16} className="text-indigo-400 shrink-0 mt-0.5" />
                                    <span>
                                        <strong>Surgical Restore Safety:</strong> Restoring this JSON file will only update Trade Journal tables (trades, sandbox trades, mistakes, reviews, and playbooks). Your bank accounts, investments, and personal assets will remain completely untouched.
                                    </span>
                                </div>

                                {/* Drag and drop upload box */}
                                <div
                                    onClick={() => fileInputRef.current?.click()}
                                    className="border-2 border-dashed border-slate-700 hover:border-indigo-500/80 bg-slate-950/40 hover:bg-slate-950/70 p-6 rounded-2xl text-center cursor-pointer transition-all group"
                                >
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        accept=".json"
                                        className="hidden"
                                        onChange={handleFileSelect}
                                    />
                                    <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 mx-auto flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform mb-3">
                                        <Upload size={22} />
                                    </div>
                                    <p className="text-sm font-bold text-white">
                                        {selectedFile ? selectedFile.name : 'Click to select or drag a Trade Journal JSON file'}
                                    </p>
                                    <p className="text-xs text-slate-400 mt-1">
                                        Accepts <code className="text-indigo-300 font-mono">wealthos_trade_journal_*.json</code> files
                                    </p>
                                </div>

                                {restoreError && (
                                    <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-center gap-2">
                                        <AlertCircle size={15} className="shrink-0" />
                                        <span>{restoreError}</span>
                                    </div>
                                )}

                                {restorePreview && (
                                    <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/80 space-y-3">
                                        <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
                                            <span className="text-xs font-bold text-white uppercase tracking-wider">Backup Contents Preview</span>
                                            {restorePreview.exportedAt && (
                                                <span className="text-[10px] font-mono text-slate-400">
                                                    Exported: {new Date(restorePreview.exportedAt).toLocaleDateString()}
                                                </span>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                                            <div className="p-2 rounded-lg bg-slate-900/60 border border-white/[0.04]">
                                                <span className="block text-[10px] uppercase font-bold text-slate-400">Trades</span>
                                                <span className="text-sm font-mono font-bold text-white">{restorePreview.counts?.trades || 0}</span>
                                            </div>
                                            <div className="p-2 rounded-lg bg-slate-900/60 border border-white/[0.04]">
                                                <span className="block text-[10px] uppercase font-bold text-slate-400">Mistakes</span>
                                                <span className="text-sm font-mono font-bold text-white">{restorePreview.counts?.mistakes || 0}</span>
                                            </div>
                                            <div className="p-2 rounded-lg bg-slate-900/60 border border-white/[0.04]">
                                                <span className="block text-[10px] uppercase font-bold text-slate-400">Reviews</span>
                                                <span className="text-sm font-mono font-bold text-white">{restorePreview.counts?.dailyReviews || 0}</span>
                                            </div>
                                            <div className="p-2 rounded-lg bg-slate-900/60 border border-white/[0.04]">
                                                <span className="block text-[10px] uppercase font-bold text-slate-400">Win Rate</span>
                                                <span className="text-sm font-mono font-bold text-emerald-400">{restorePreview.winRate ? `${restorePreview.winRate}%` : 'N/A'}</span>
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            disabled={isRestoring}
                                            onClick={handleExecuteRestore}
                                            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 mt-2"
                                        >
                                            {isRestoring ? (
                                                <>
                                                    <RefreshCw size={14} className="animate-spin" />
                                                    Restoring Database...
                                                </>
                                            ) : (
                                                <>
                                                    <CheckCircle2 size={15} />
                                                    Restore to Device
                                                </>
                                            )}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-3 border-t border-white/[0.06] bg-slate-950/40 flex items-center justify-between text-[11px] text-slate-400">
                        <span>WealthOS Data Portability Standard</span>
                        <button
                            type="button"
                            onClick={onClose}
                            className="text-slate-400 hover:text-white transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

export default TradeJournalExportModal;
