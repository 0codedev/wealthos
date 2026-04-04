import React, { useState, useEffect } from 'react';
import { FileText, Download, Loader2, AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Info, IndianRupee, Calendar } from 'lucide-react';
import { ITRGeneratorService, ScheduleCG, CGTransaction } from '../../services/ITRGeneratorService';
import { formatCurrency } from '../../utils/helpers';
import { useFiscalYear } from '../../hooks/useFiscalYear';

export const ITRPreFillPanel: React.FC = () => {
    const { label: fyLabel } = useFiscalYear();
    const [isLoading, setIsLoading] = useState(false);
    const [schedule, setSchedule] = useState<ScheduleCG | null>(null);
    const [transactions, setTransactions] = useState<CGTransaction[]>([]);
    const [isExpanded, setIsExpanded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleGenerate = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const service = new ITRGeneratorService(fyLabel);
            const result = await service.generateScheduleCG();
            setSchedule(result.schedule);
            setTransactions(result.transactions);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message || 'Failed to generate ITR data');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDownload = () => {
        if (!schedule) return;
        const service = new ITRGeneratorService(fyLabel);
        service.downloadJSON(schedule, transactions);
    };

    return (
        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-950/50 dark:to-purple-950/50 border border-indigo-200 dark:border-indigo-800/50 rounded-2xl p-5">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-500/20 rounded-xl">
                        <FileText className="text-indigo-600 dark:text-indigo-400" size={22} />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white">ITR Pre-Fill Generator</h3>
                        <p className="text-xs text-slate-500">Generate Schedule CG data for ITR-2/ITR-3</p>
                    </div>
                </div>
                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/50 px-2 py-1 rounded-full">
                    AY {schedule?.assessmentYear || '2025-26'}
                </span>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 mb-4">
                <button
                    onClick={handleGenerate}
                    disabled={isLoading}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-indigo-500/30"
                >
                    {isLoading ? (
                        <>
                            <Loader2 size={16} className="animate-spin" />
                            Generating...
                        </>
                    ) : (
                        <>
                            <FileText size={16} />
                            Generate Report
                        </>
                    )}
                </button>
                {schedule && (
                    <button
                        onClick={handleDownload}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-emerald-500/30"
                    >
                        <Download size={16} />
                        Download JSON
                    </button>
                )}
            </div>

            {/* Error Message */}
            {error && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-2 mb-4">
                    <AlertCircle className="text-rose-500" size={16} />
                    <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
                </div>
            )}

            {/* Schedule Summary */}
            {schedule && (
                <div className="space-y-4">
                    {/* Summary Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="p-3 bg-white/70 dark:bg-slate-900/70 rounded-xl border border-slate-200 dark:border-slate-800">
                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Gross STCG</p>
                            <p className={`text-lg font-black ${schedule.summary.grossSTCG >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {formatCurrency(schedule.summary.grossSTCG)}
                            </p>
                        </div>
                        <div className="p-3 bg-white/70 dark:bg-slate-900/70 rounded-xl border border-slate-200 dark:border-slate-800">
                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Gross LTCG</p>
                            <p className={`text-lg font-black ${schedule.summary.grossLTCG >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {formatCurrency(schedule.summary.grossLTCG)}
                            </p>
                        </div>
                        <div className="p-3 bg-white/70 dark:bg-slate-900/70 rounded-xl border border-slate-200 dark:border-slate-800">
                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">₹1.25L Exemption</p>
                            <p className="text-lg font-black text-blue-600">
                                {formatCurrency(schedule.summary.exemptionsApplied)}
                            </p>
                        </div>
                        <div className="p-3 bg-gradient-to-br from-rose-100 to-amber-100 dark:from-rose-900/30 dark:to-amber-900/30 rounded-xl border border-rose-200 dark:border-rose-800/50">
                            <p className="text-[10px] font-bold text-rose-500 uppercase mb-1">Estimated Tax</p>
                            <p className="text-lg font-black text-rose-600">
                                {formatCurrency(schedule.summary.estimatedTax)}
                            </p>
                        </div>
                    </div>

                    {/* Section Breakdown */}
                    <div className="p-4 bg-white/50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800">
                        <button
                            onClick={() => setIsExpanded(!isExpanded)}
                            className="w-full flex items-center justify-between"
                        >
                            <span className="text-sm font-bold text-slate-700 dark:text-white">Section-wise Breakdown</span>
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>

                        {isExpanded && (
                            <div className="mt-4 space-y-4 text-xs">
                                {/* Section 111A */}
                                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800/50">
                                    <p className="font-bold text-blue-600 dark:text-blue-400 mb-2">
                                        Section 111A (STCG on Listed Equity @ 15%)
                                    </p>
                                    <div className="grid grid-cols-3 gap-2 text-slate-600 dark:text-slate-400">
                                        <div>
                                            <span className="text-slate-400">Sale Value:</span>
                                            <span className="ml-1 font-mono font-bold">{formatCurrency(schedule.shortTermGains.section111A.fullValue)}</span>
                                        </div>
                                        <div>
                                            <span className="text-slate-400">Cost:</span>
                                            <span className="ml-1 font-mono font-bold">{formatCurrency(schedule.shortTermGains.section111A.costOfAcquisition)}</span>
                                        </div>
                                        <div>
                                            <span className="text-slate-400">Gain:</span>
                                            <span className={`ml-1 font-mono font-bold ${schedule.shortTermGains.section111A.gains >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                {formatCurrency(schedule.shortTermGains.section111A.gains)}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Section 112A */}
                                <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800/50">
                                    <p className="font-bold text-purple-600 dark:text-purple-400 mb-2">
                                        Section 112A (LTCG on Listed Equity @ 12.5%)
                                    </p>
                                    <div className="grid grid-cols-2 gap-2 text-slate-600 dark:text-slate-400">
                                        <div>
                                            <span className="text-slate-400">Gains Before Exemption:</span>
                                            <span className="ml-1 font-mono font-bold">{formatCurrency(schedule.longTermGains.section112A.gainsBeforeExemption)}</span>
                                        </div>
                                        <div>
                                            <span className="text-slate-400">Exemption Applied:</span>
                                            <span className="ml-1 font-mono font-bold text-emerald-600">-{formatCurrency(schedule.longTermGains.section112A.exemption)}</span>
                                        </div>
                                        <div className="col-span-2">
                                            <span className="text-slate-400">Taxable Gains:</span>
                                            <span className="ml-1 font-mono font-bold text-rose-600">{formatCurrency(schedule.longTermGains.section112A.taxableGains)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Transaction Count */}
                    <div className="flex items-center justify-between p-3 bg-slate-100 dark:bg-slate-800/50 rounded-xl text-xs">
                        <span className="text-slate-500">Transactions Processed:</span>
                        <span className="font-bold text-slate-700 dark:text-white">{transactions.length}</span>
                    </div>

                    {/* Disclaimer */}
                    <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl">
                        <Info className="text-amber-600 shrink-0 mt-0.5" size={14} />
                        <p className="text-[11px] text-amber-700 dark:text-amber-300">
                            <span className="font-bold">Disclaimer:</span> This is an auto-generated report for reference only.
                            Capital gains calculations may require adjustments for grandfathering, cost inflation index, and specific exemptions.
                            Please verify with your CA before filing ITR.
                        </p>
                    </div>
                </div>
            )}

            {/* Empty State */}
            {!schedule && !isLoading && (
                <div className="text-center py-6">
                    <FileText className="mx-auto text-slate-300 dark:text-slate-700 mb-3" size={32} />
                    <p className="text-sm text-slate-500">Click "Generate Report" to calculate capital gains from your trades</p>
                </div>
            )}
        </div>
    );
};

export default ITRPreFillPanel;
