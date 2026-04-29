import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { FileText, Printer, Copy, Check, X, ShieldAlert, Sparkles, Building2 } from 'lucide-react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { computeIndianTaxDossier, TaxComputationResult, TaxTradeEntry } from '../../utils/taxDossierEngine';
import { formatCurrency } from '../../utils/helpers';
import { showToast } from '../shared/ToastProvider';

interface TaxDossierModalProps {
    isOpen: boolean;
    onClose: () => void;
    trades?: TaxTradeEntry[];
}

export const TaxDossierModal: React.FC<TaxDossierModalProps> = ({ isOpen, onClose, trades = [] }) => {
    const modalRef = useModalKeyboard({ isOpen, onClose });
    const [copied, setCopied] = useState(false);

    // Sample fallback trades if none passed
    const sampleTrades: TaxTradeEntry[] = trades.length > 0 ? trades : [
        { id: 't1', symbol: 'HDFCBANK', assetType: 'EQUITY', buyDate: '2024-04-10', sellDate: '2025-06-15', buyPrice: 1450, sellPrice: 1720, quantity: 100 },
        { id: 't2', symbol: 'TCS', assetType: 'EQUITY', buyDate: '2025-01-10', sellDate: '2025-05-12', buyPrice: 3800, sellPrice: 4200, quantity: 50 },
        { id: 't3', symbol: 'NIFTY24500CE', assetType: 'FNO', buyDate: '2025-06-01', sellDate: '2025-06-01', buyPrice: 120, sellPrice: 185, quantity: 150 },
        { id: 't4', symbol: 'RELIANCE', assetType: 'INTRADAY', buyDate: '2025-06-10', sellDate: '2025-06-10', buyPrice: 2900, sellPrice: 2940, quantity: 200 },
    ];

    const dossier: TaxComputationResult = computeIndianTaxDossier(sampleTrades);

    if (!isOpen || typeof document === 'undefined') return null;

    const handleCopySummary = () => {
        const text = `=== WealthOS Schedule CG Tax Dossier (FY ${dossier.financialYear}) ===
STCG Gains (Sec 111A): ₹${dossier.stcgGains.toLocaleString('en-IN')} (Tax @20%: ₹${dossier.stcgTaxPayable.toLocaleString('en-IN')})
LTCG Gross (Sec 112A): ₹${dossier.ltcgGrossGains.toLocaleString('en-IN')} (Exemption: ₹${dossier.ltcgExemptionApplied.toLocaleString('en-IN')})
LTCG Net Taxable: ₹${dossier.ltcgNetTaxable.toLocaleString('en-IN')} (Tax @12.5%: ₹${dossier.ltcgTaxPayable.toLocaleString('en-IN')})
F&O Business P&L: ₹${dossier.fnoNetProfitLoss.toLocaleString('en-IN')} (Turnover: ₹${dossier.fnoBusinessTurnover.toLocaleString('en-IN')})
Intraday Speculative P&L: ₹${dossier.intradaySpeculativePnL.toLocaleString('en-IN')}
--------------------------------------------------
Total Estimated Direct Capital Gains Tax: ₹${dossier.totalDirectTaxLiability.toLocaleString('en-IN')}`;

        navigator.clipboard.writeText(text);
        setCopied(true);
        showToast('Tax Dossier copied to clipboard', 'success');
        setTimeout(() => setCopied(false), 2000);
    };

    const handlePrint = () => {
        window.print();
    };

    return createPortal(
        <div className="fixed inset-0 z-[99999] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
                ref={modalRef}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden my-8"
            >
                {/* Header */}
                <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                            <FileText size={20} />
                        </div>
                        <div>
                            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
                                Indian Income Tax • Schedule CG Dossier
                            </span>
                            <h2 className="text-xl font-bold text-white font-display">
                                Capital Gains & Business P&L Summary (FY {dossier.financialYear})
                            </h2>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        aria-label="Close modal"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body Content */}
                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    {/* Top KPI Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-800">
                            <div className="text-[10px] font-bold uppercase text-slate-400">STCG Tax (20%)</div>
                            <div className="text-xl font-black text-amber-400 font-mono mt-1">
                                ₹{dossier.stcgTaxPayable.toLocaleString('en-IN')}
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
                                Gains: ₹{dossier.stcgGains.toLocaleString('en-IN')}
                            </div>
                        </div>

                        <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-800">
                            <div className="text-[10px] font-bold uppercase text-slate-400">LTCG Tax (12.5%)</div>
                            <div className="text-xl font-black text-emerald-400 font-mono mt-1">
                                ₹{dossier.ltcgTaxPayable.toLocaleString('en-IN')}
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
                                Net Taxable: ₹{dossier.ltcgNetTaxable.toLocaleString('en-IN')}
                            </div>
                        </div>

                        <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/30">
                            <div className="text-[10px] font-bold uppercase text-indigo-300">Total Tax Liability</div>
                            <div className="text-xl font-black text-white font-mono mt-1">
                                ₹{dossier.totalDirectTaxLiability.toLocaleString('en-IN')}
                            </div>
                            <div className="text-[10px] text-indigo-400 mt-0.5 font-mono">
                                ITR-2 / ITR-3 Direct CG
                            </div>
                        </div>
                    </div>

                    {/* Business Income Section */}
                    <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                            <Building2 size={14} className="text-indigo-400" />
                            Business Income (Slab Rate Taxation)
                        </span>
                        <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                            <div className="flex justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                                <span className="text-slate-400">F&O Net Profit/Loss:</span>
                                <span className={dossier.fnoNetProfitLoss >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                    ₹{dossier.fnoNetProfitLoss.toLocaleString('en-IN')}
                                </span>
                            </div>
                            <div className="flex justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                                <span className="text-slate-400">Intraday Speculative:</span>
                                <span className={dossier.intradaySpeculativePnL >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                    ₹{dossier.intradaySpeculativePnL.toLocaleString('en-IN')}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Itemized Table */}
                    <div className="space-y-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                            Itemized Scrip Breakdown
                        </span>
                        <div className="border border-slate-800 rounded-2xl overflow-hidden">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-slate-800/60 text-slate-400 font-mono text-[10px] uppercase">
                                    <tr>
                                        <th className="p-3">Scrip / Contract</th>
                                        <th className="p-3">Classification</th>
                                        <th className="p-3 text-right">Holding</th>
                                        <th className="p-3 text-right">Gain / Loss</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800 font-mono">
                                    {dossier.entries.map((entry, idx) => (
                                        <tr key={idx} className="hover:bg-slate-800/30">
                                            <td className="p-3 font-bold text-white">{entry.symbol}</td>
                                            <td className="p-3 text-slate-400">{entry.type}</td>
                                            <td className="p-3 text-right text-slate-400">{entry.holdingPeriodDays}d</td>
                                            <td className={`p-3 text-right font-bold ${entry.gainOrLoss >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {entry.gainOrLoss >= 0 ? '+' : ''}₹{entry.gainOrLoss.toLocaleString('en-IN')}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="p-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between">
                    <div className="text-[11px] text-slate-400">
                        Budget 2024 Compliant • ₹1.25L Exemption Included
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleCopySummary}
                            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                        >
                            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                            <span>{copied ? 'Copied' : 'Copy Summary'}</span>
                        </button>
                        <button
                            onClick={handlePrint}
                            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors shadow-lg shadow-indigo-600/20"
                        >
                            <Printer size={14} />
                            <span>Export / Print</span>
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>,
        document.body
    );
};
