import React from 'react';
import { Gavel, CheckCircle2 } from 'lucide-react';

interface WashSaleDetectorProps {
    warnings: { ticker: string, lossDate: string, lossAmount: number }[];
}

export const WashSaleDetector: React.FC<WashSaleDetectorProps> = React.memo(({ warnings }) => {
    return (
        <div className={`rounded-2xl p-6 border shadow-sm relative overflow-hidden flex flex-col ${warnings.length > 0 ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'}`}>
            <div className="absolute top-0 right-0 p-4 opacity-10">
                <Gavel size={100} className={warnings.length > 0 ? "text-amber-500" : "text-slate-400"} />
            </div>

            <div>
                <h3 className={`font-bold flex items-center gap-2 ${warnings.length > 0 ? 'text-amber-700 dark:text-amber-500' : 'text-slate-800 dark:text-white'}`}>
                    <Gavel size={18} /> Wash Sale Detector
                </h3>
                <p className={`text-xs mb-4 ${warnings.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'}`}>
                    Monitoring disallowed loss claims.
                </p>
            </div>

            <div className="flex-1 overflow-y-auto max-h-[120px] md:max-h-[200px] pr-2">
                {warnings.length > 0 ? (
                    <div className="space-y-2">
                        {warnings.map((w, idx) => (
                            <div key={idx} className="bg-white dark:bg-slate-950 p-3 rounded-xl border border-amber-200 dark:border-amber-800/50 flex justify-between items-center animate-in slide-in-from-bottom-2">
                                <div>
                                    <p className="font-bold text-sm text-slate-800 dark:text-slate-200">{w.ticker}</p>
                                    <p className="text-[10px] text-slate-500">Sold loss on {w.lossDate}</p>
                                </div>
                                <div className="text-right">
                                    <span className="text-xs font-bold text-rose-500 bg-rose-50 dark:bg-rose-900/20 px-2 py-1 rounded">
                                        Re-Entry Risk
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-60">
                        <CheckCircle2 size={32} className="text-emerald-500 mb-2" />
                        <p className="text-sm text-slate-500">No wash sale risks detected.</p>
                    </div>
                )}
            </div>
        </div>
    );
});

WashSaleDetector.displayName = 'WashSaleDetector';
