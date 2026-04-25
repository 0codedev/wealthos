import React, { useState, useEffect } from 'react';
import { 
    X, FileText, Download, Send, ArrowUpRight, ArrowDownRight, 
    Award, TrendingUp, Calendar, RefreshCw
} from 'lucide-react';
import { PerformanceReportService, WeeklyReportData } from '../../services/PerformanceReportService';
import { notificationService } from '../../services/NotificationService';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { jsPDF } from 'jspdf';
import { useToast } from '../shared/ToastProvider';

interface WeeklyReportModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const WeeklyReportModal: React.FC<WeeklyReportModalProps> = ({ isOpen, onClose }) => {
    const { toast } = useToast();
    
    // Default: Previous week Monday to Sunday
    const [startDate, setStartDate] = useState<string>(() => {
        const d = new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1) - 7; // Previous Monday
        const prevMon = new Date(d.setDate(diff));
        return prevMon.toISOString().split('T')[0];
    });

    const [endDate, setEndDate] = useState<string>(() => {
        const d = new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1) - 7 + 6; // Previous Sunday
        const prevSun = new Date(d.setDate(diff));
        return prevSun.toISOString().split('T')[0];
    });

    const [reportData, setReportData] = useState<WeeklyReportData | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isSharing, setIsSharing] = useState<boolean>(false);

    const loadReport = async () => {
        setIsLoading(true);
        try {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);

            const data = await PerformanceReportService.generateReportData(start, end);
            setReportData(data);
        } catch (e) {
            console.error('Error generating report:', e);
            toast.error('Failed to generate performance report');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            loadReport();
        }
    }, [isOpen, startDate, endDate]);

    if (!isOpen) return null;

    // Download PDF Report using jsPDF
    const downloadPDF = () => {
        if (!reportData) return;
        try {
            const doc = new jsPDF();
            
            // Header Theme
            doc.setFillColor(15, 15, 20);
            doc.rect(0, 0, 210, 45, 'F');
            
            doc.setTextColor(168, 85, 247); // Purple Title
            doc.setFontSize(22);
            doc.setFont('helvetica', 'bold');
            doc.text('WEALTH AGGREGATOR', 15, 20);
            
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(14);
            doc.text('WEEKLY PERFORMANCE REPORT', 15, 30);
            
            doc.setFontSize(10);
            doc.setTextColor(150, 150, 150);
            doc.text(`Period: ${startDate} to ${endDate}`, 15, 38);
            doc.text(`Generated: ${new Date().toLocaleDateString()}`, 150, 38);

            // Metrics Summary Section
            doc.setTextColor(30, 30, 30);
            doc.setFontSize(13);
            doc.text('1. Metrics Summary', 15, 58);
            doc.line(15, 60, 195, 60);

            doc.setFontSize(11);
            doc.setFont('helvetica', 'normal');
            doc.text(`Total Trade Signals: ${reportData.totalSignals}`, 15, 70);
            doc.text(`Wins: ${reportData.wins}   |   Losses: ${reportData.losses}`, 15, 78);
            doc.text(`Swarm Win Rate: ${Math.round(reportData.winRate * 100)}%`, 15, 86);
            
            const pnlString = reportData.totalPnL >= 0 
                ? `+${reportData.totalPnL.toLocaleString()} points` 
                : `${reportData.totalPnL.toLocaleString()} points`;
            doc.setFont('helvetica', 'bold');
            doc.text(`Net Points Earned: ${pnlString}`, 15, 94);

            // Providers Leaderboard Section
            doc.setFont('helvetica', 'bold');
            doc.text('2. Signal Provider Leaderboard', 15, 110);
            doc.line(15, 112, 195, 112);

            doc.setFontSize(10);
            doc.text('Provider', 15, 120);
            doc.text('Signals', 70, 120);
            doc.text('Win Rate', 110, 120);
            doc.text('Net P&L (pts)', 150, 120);
            doc.line(15, 122, 195, 122);

            doc.setFont('helvetica', 'normal');
            let y = 128;
            reportData.providers.forEach((prov) => {
                doc.text(prov.provider, 15, y);
                doc.text(String(prov.totalSignals), 70, y);
                doc.text(`${Math.round(prov.winRate * 100)}%`, 110, y);
                doc.text(`${prov.totalPnL >= 0 ? '+' : ''}${prov.totalPnL}`, 150, y);
                y += 8;
            });

            // Best and Worst Calls Section
            doc.setFont('helvetica', 'bold');
            doc.text('3. Key Trades Spotlight', 15, y + 10);
            doc.line(15, y + 12, 195, y + 12);
            
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            
            if (reportData.bestCall) {
                doc.text(`★ Best Trade Call: ${reportData.bestCall.instrument} (${reportData.bestCall.provider})`, 15, y + 22);
                doc.text(`   Entry: ₹${reportData.bestCall.entryPrice} | Exit: ₹${reportData.bestCall.target1 || 'Target'} | Return: +${reportData.bestCall.outcomePnL} pts`, 15, y + 28);
            }
            
            if (reportData.worstCall) {
                doc.text(`★ Worst Trade Call: ${reportData.worstCall.instrument} (${reportData.worstCall.provider})`, 15, y + 38);
                doc.text(`   Entry: ₹${reportData.worstCall.entryPrice} | Exit: ₹${reportData.worstCall.stopLoss || 'SL'} | Return: ${reportData.worstCall.outcomePnL} pts`, 15, y + 44);
            }

            // Save PDF
            doc.save(`Weekly-Performance-Report-${startDate}-to-${endDate}.pdf`);
            toast.success('PDF report downloaded successfully');
        } catch (err) {
            console.error('PDF generation error', err);
            toast.error('Failed to export PDF');
        }
    };

    // Share report data to n8n Nervous System
    const shareReport = async () => {
        if (!reportData) return;
        setIsSharing(true);
        try {
            const success = await notificationService.sendToNervousSystem('WEEKLY_REPORT', {
                startDate,
                endDate,
                ...reportData
            });

            if (success) {
                toast.success('Performance Report shared successfully with n8n Nervous System.');
            } else {
                toast.error('Nervous System shared failure. Check webhook configurations.');
            }
        } catch (err) {
            toast.error('Sharing failed.');
        } finally {
            setIsSharing(false);
        }
    };

    return (
        <div className="settings-modal-overlay">
            <div
                className="settings-modal weekly-report-modal"
                style={{ width: 'min(600px, calc(100vw - 2rem))', maxHeight: '90vh', overflowY: 'auto' }}
            >
                <div className="modal-header">
                    <div className="flex items-center gap-2">
                        <FileText size={18} className="text-purple-400" />
                        <h3>📊 Performance Report Generator</h3>
                    </div>
                    <button className="close-btn" onClick={onClose}>
                        <X size={16} />
                    </button>
                </div>
                
                <div className="modal-body">
                    {/* Date Pickers */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="form-group">
                            <label>Start Date:</label>
                            <input 
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                            />
                        </div>
                        <div className="form-group">
                            <label>End Date:</label>
                            <input 
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                            />
                        </div>
                    </div>

                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-400">
                            <RefreshCw size={24} className="animate-spin text-purple-400" />
                            <p className="text-xs">Compiling signal history & logs...</p>
                        </div>
                    ) : reportData && reportData.totalSignals > 0 ? (
                        <div className="report-preview-container space-y-6">
                            {/* Summary Metrics */}
                            <div className="grid grid-cols-3 gap-3">
                                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-center">
                                    <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Total Signals</div>
                                    <div className="text-xl font-bold mt-1 text-white">{reportData.totalSignals}</div>
                                </div>
                                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-center">
                                    <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Swarm Win Rate</div>
                                    <div className="text-xl font-bold mt-1 text-emerald-400">{Math.round(reportData.winRate * 100)}%</div>
                                </div>
                                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-center">
                                    <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Net Return</div>
                                    <div className={`text-xl font-bold mt-1 ${reportData.totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {reportData.totalPnL >= 0 ? '+' : ''}{reportData.totalPnL} pts
                                    </div>
                                </div>
                            </div>

                            {/* Chart */}
                            {reportData.pnlCurve.length > 0 && (
                                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                                    <h4 className="text-xs text-slate-300 font-bold uppercase tracking-wider mb-3">Weekly Cumulative P&L Curve (pts)</h4>
                                    <div className="w-full h-[160px]">
                                        <SafeChartContainer height="100%" minHeight={150}>
                                            <LineChart data={reportData.pnlCurve} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                                <XAxis dataKey="date" stroke="#64748b" fontSize={10} />
                                                <YAxis stroke="#64748b" fontSize={10} />
                                                <Tooltip 
                                                    contentStyle={{ backgroundColor: '#090a0f', borderColor: 'rgba(255,255,255,0.1)' }} 
                                                    labelStyle={{ color: '#cbd5e1', fontSize: '11px' }}
                                                    itemStyle={{ color: '#a78bfa', fontSize: '12px' }}
                                                />
                                                <Line 
                                                    type="monotone" 
                                                    dataKey="cumulativePnL" 
                                                    stroke="#8b5cf6" 
                                                    strokeWidth={2}
                                                    dot={{ fill: '#8b5cf6', strokeWidth: 1 }} 
                                                    activeDot={{ r: 5 }} 
                                                />
                                            </LineChart>
                                        </SafeChartContainer>
                                    </div>
                                </div>
                            )}

                            {/* Spotlight */}
                            <div className="grid grid-cols-2 gap-3">
                                {reportData.bestCall && (
                                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 flex gap-2">
                                        <ArrowUpRight size={18} className="text-emerald-400 shrink-0 mt-0.5" />
                                        <div>
                                            <span className="text-[10px] text-emerald-300 font-bold uppercase tracking-wider">Top Winner</span>
                                            <h5 className="text-xs font-bold text-white mt-0.5">{reportData.bestCall.instrument}</h5>
                                            <p className="text-xs text-slate-300 mt-1 font-medium">
                                                +{reportData.bestCall.outcomePnL} pts by {reportData.bestCall.provider}
                                            </p>
                                        </div>
                                    </div>
                                )}
                                {reportData.worstCall && (
                                    <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 flex gap-2">
                                        <ArrowDownRight size={18} className="text-rose-400 shrink-0 mt-0.5" />
                                        <div>
                                            <span className="text-[10px] text-rose-300 font-bold uppercase tracking-wider">Max Drawdown</span>
                                            <h5 className="text-xs font-bold text-white mt-0.5">{reportData.worstCall.instrument}</h5>
                                            <p className="text-xs text-slate-300 mt-1 font-medium">
                                                {reportData.worstCall.outcomePnL} pts by {reportData.worstCall.provider}
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Leaderboard Table */}
                            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                                <h4 className="text-xs text-slate-300 font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                    <Award size={14} className="text-purple-400" /> Leaderboard Breakdown
                                </h4>
                                <div className="overflow-x-auto max-h-40 overflow-y-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead>
                                            <tr className="border-b border-slate-800 text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                                                <th className="pb-2">Provider</th>
                                                <th className="pb-2 text-center">Signals</th>
                                                <th className="pb-2 text-center">Win Rate</th>
                                                <th className="pb-2 text-right">P&L (pts)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {reportData.providers.map((p, idx) => (
                                                <tr key={idx} className="border-b border-slate-800/60 last:border-none">
                                                    <td className="py-2 font-bold text-white">{p.provider}</td>
                                                    <td className="py-2 text-center font-mono font-bold text-slate-300">{p.totalSignals}</td>
                                                    <td className="py-2 text-center font-mono font-bold text-emerald-400">{Math.round(p.winRate * 100)}%</td>
                                                    <td className={`py-2 text-right font-mono font-bold ${p.totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                        {p.totalPnL >= 0 ? '+' : ''}{p.totalPnL}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-500">
                            <TrendingUp size={24} />
                            <p className="text-xs">No trade results found in selected date range.</p>
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button className="cancel-btn" onClick={onClose}>Close</button>
                    {reportData && reportData.totalSignals > 0 && (
                        <>
                            <button className="ops-btn flex items-center gap-1.5" onClick={downloadPDF} style={{ background: 'rgba(255,255,255,0.03)' }}>
                                <Download size={12} />
                                Download PDF
                            </button>
                            <button className="save-btn flex items-center gap-1.5" onClick={shareReport} disabled={isSharing}>
                                <Send size={12} />
                                {isSharing ? 'Sharing...' : 'Share to n8n'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
export default WeeklyReportModal;
