import React, { useState, useEffect } from 'react';
import { ArrowDownRight, ArrowUpRight, Wallet, RefreshCw } from 'lucide-react';
import { dhanBrokerService, DhanLedgerResponse } from '../../../services/DhanBrokerService';
import { useToast } from '../../shared/ToastProvider';
import { CountUp } from '../../shared/CountUp';
import { ValueFlash } from '../../shared/ValueFlash';
import EmptyState from '../../shared/EmptyState';

const formatCurrency = (val: number | string | undefined | null) => {
    const num = typeof val === 'string' ? parseFloat(val) : Number(val);
    if (isNaN(num)) return '₹0.00';
    return new Intl.NumberFormat('en-IN', { 
        style: 'currency', 
        currency: 'INR', 
        maximumFractionDigits: 2,
        minimumFractionDigits: 2
    }).format(num);
};

const CashflowLedgerWidget: React.FC = () => {
    const { toast } = useToast();
    const [transactions, setTransactions] = useState<DhanLedgerResponse[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [dateRangeText, setDateRangeText] = useState('');

    // Derived stats
    const [totalDeposits, setTotalDeposits] = useState(0);
    const [totalWithdrawals, setTotalWithdrawals] = useState(0);

    const fetchCashflow = async () => {
        if (!dhanBrokerService.isConfigured()) return;
        setIsLoading(true);
        try {
            // Fetch last 30 days
            const toDate = new Date();
            const fromDate = new Date();
            fromDate.setDate(toDate.getDate() - 30);

            const formatDate = (d: Date) => d.toISOString().split('T')[0];
            const formatDisplayDate = (d: Date) => {
                return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
            };

            const data = await dhanBrokerService.fetchLedger(formatDate(fromDate), formatDate(toDate));

            // Broaden filter to show all ledger activities (settlement, trades, fund transfers)
            const ledgerActivities = data || [];
            setTransactions(ledgerActivities);

            setDateRangeText(`${formatDisplayDate(fromDate)} - ${formatDisplayDate(toDate)}`);

            // Calculate totals - CRITICAL: Explicitly coerce to Number to prevent string concatenation
            let deposits = 0;
            let withdrawals = 0;
            ledgerActivities.forEach(tx => {
                deposits += Number(tx.credit || 0);
                withdrawals += Number(tx.debit || 0);
            });

            setTotalDeposits(deposits);
            setTotalWithdrawals(withdrawals);

        } catch (error) {
            console.error('Failed to fetch ledger:', error);
            toast.error('Failed to sync cashflow. Please check Dhan API limits.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchCashflow();
    }, []);

    if (!dhanBrokerService.isConfigured()) {
        return null;
    }

    const netFlow = totalDeposits - totalWithdrawals;

    return (
        <div className="preset-card glass-card p-5 rounded-2xl space-y-4 overflow-hidden">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 overflow-hidden">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 shrink-0">
                        <Wallet className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-white truncate">Cashflow Sync</h3>
                        <p className="text-[10px] text-white/40 truncate">
                            {dateRangeText || 'Last 30 Days'} • Net: <span className={netFlow >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-450 font-bold'}>{formatCurrency(netFlow)}</span>
                        </p>
                    </div>
                </div>
                <button
                    onClick={fetchCashflow}
                    disabled={isLoading}
                    className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors disabled:opacity-50 shrink-0"
                >
                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <div className="grid grid-cols-2 gap-3 pb-1">
                <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-3 min-w-0 overflow-hidden">
                    <div className="flex items-center gap-1.5 mb-1">
                        <ArrowDownRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="text-[10px] text-emerald-400/60 font-medium truncate uppercase">Deposits</span>
                    </div>
                    <div className="text-[15px] font-bold text-emerald-400 truncate tracking-tight">
                        <ValueFlash value={totalDeposits} className="inline-block">
                            <CountUp value={totalDeposits} format={formatCurrency} />
                        </ValueFlash>
                    </div>
                </div>
                <div className="bg-rose-500/5 border border-rose-500/10 rounded-xl p-3 min-w-0 overflow-hidden">
                    <div className="flex items-center gap-1.5 mb-1">
                        <ArrowUpRight className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        <span className="text-[10px] text-rose-400/60 font-medium truncate uppercase">Withdrawals</span>
                    </div>
                    <div className="text-[15px] font-bold text-rose-400 truncate tracking-tight">
                        <ValueFlash value={totalWithdrawals} className="inline-block">
                            <CountUp value={totalWithdrawals} format={formatCurrency} />
                        </ValueFlash>
                    </div>
                </div>
            </div>

            <div className="table-scroll space-y-2 max-h-[160px] overflow-y-auto custom-scrollbar pr-1">
                {transactions.length === 0 ? (
                    <EmptyState
                        type="no-data"
                        variant="minimal"
                        title="No recent transfers"
                        description="Once you sync a broker or add a bank, your transfers will appear here."
                    />
                ) : (
                    transactions.map((tx, idx) => {
                        const isDeposit = Number(tx.credit || 0) > 0;
                        const amount = isDeposit ? Number(tx.credit || 0) : Number(tx.debit || 0);
                        const rawDate = tx.voucherDate || (tx as any).voucherdate || (tx as any).voucherDate || '';
                        const dateStr = rawDate.split('T')[0] || 'N/A';
                        const runBalVal = tx.runBal ?? (tx as any).runbal ?? (tx as any).runBal;
                        return (
                            <div key={idx} className="flex min-w-[260px] items-center justify-between p-2.5 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 transition-colors gap-3">
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <div className={`p-1.5 rounded-md shrink-0 ${isDeposit ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                        {isDeposit ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-xs font-bold text-white truncate">{tx.narration || 'N/A'}</div>
                                        <div className="text-[10px] text-white/40 truncate">
                                            {dateStr} {runBalVal !== undefined && `• Bal: ${formatCurrency(runBalVal)}`}
                                        </div>
                                    </div>
                                </div>
                                <div className={`text-sm font-bold shrink-0 ${isDeposit ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {isDeposit ? '+' : '-'}{formatCurrency(amount)}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default CashflowLedgerWidget;
