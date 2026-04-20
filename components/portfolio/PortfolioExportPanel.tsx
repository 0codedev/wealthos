import React, { useState } from 'react';
import { Download, FileText, FileSpreadsheet, Printer, Check, Loader2 } from 'lucide-react';
import { portfolioExportService } from '../../services/PortfolioExportService';
import { Investment } from '../../types';

interface PortfolioExportPanelProps {
    investments: Investment[];
}

export const PortfolioExportPanel: React.FC<PortfolioExportPanelProps> = ({ investments }) => {
    const [isExporting, setIsExporting] = useState<string | null>(null);
    const [lastExported, setLastExported] = useState<string | null>(null);

    const handleExport = async (format: 'csv' | 'json' | 'html') => {
        setIsExporting(format);

        // Small delay for UX
        await new Promise(resolve => setTimeout(resolve, 500));

        const summary = portfolioExportService.generateSummary(investments);

        switch (format) {
            case 'csv':
                portfolioExportService.exportToCSV(investments);
                break;
            case 'json':
                portfolioExportService.exportToJSON(investments, summary);
                break;
            case 'html':
                portfolioExportService.exportToHTML(investments, summary);
                break;
        }

        setIsExporting(null);
        setLastExported(format);

        // Clear success indicator after 3 seconds
        setTimeout(() => setLastExported(null), 3000);
    };

    const exportOptions = [
        {
            id: 'csv',
            label: 'CSV (Excel)',
            description: 'For spreadsheet analysis',
            icon: FileSpreadsheet,
            color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30'
        },
        {
            id: 'json',
            label: 'JSON Report',
            description: 'For CA/Tax filing',
            icon: FileText,
            color: 'text-indigo-600 bg-indigo-100 dark:bg-indigo-900/30'
        },
        {
            id: 'html',
            label: 'Print Report',
            description: 'Professional PDF',
            icon: Printer,
            color: 'text-purple-600 bg-purple-100 dark:bg-purple-900/30'
        },
    ];

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-xl border border-indigo-100 dark:border-indigo-800/50">
                        <Download className="text-indigo-600 dark:text-indigo-400" size={20} />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-slate-900 dark:text-white uppercase tracking-tight">Export Institutional Data</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">{investments.length} Active Holdings Compiled</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {exportOptions.map(option => {
                    const isLoading = isExporting === option.id;
                    const isSuccess = lastExported === option.id;

                    return (
                        <button
                            key={option.id}
                            onClick={() => handleExport(option.id as any)}
                            disabled={isLoading || investments.length === 0}
                            className={`p-5 rounded-2xl border-2 border-dashed transition-all hover:border-solid hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed group ${isSuccess
                                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 shadow-emerald-500/10'
                                : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 hover:border-indigo-500 dark:hover:border-indigo-500 hover:bg-white dark:hover:bg-slate-900'
                                }`}
                        >
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110 shadow-sm ${option.color}`}>
                                {isLoading ? (
                                    <Loader2 size={24} className="animate-spin" />
                                ) : isSuccess ? (
                                    <Check size={24} className="text-emerald-600 dark:text-emerald-500" />
                                ) : (
                                    <option.icon size={24} />
                                )}
                            </div>
                            <p className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight">{option.label}</p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium mt-1 leading-relaxed">{option.description}</p>
                        </button>
                    );
                })}
            </div>

            {investments.length === 0 && (
                <div className="mt-6 p-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-transparent text-center">
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">
                        Database Empty • Connect Alpha Engine or Add Assets to enable export
                    </p>
                </div>
            )}
        </div>
    );
};

export default PortfolioExportPanel;
