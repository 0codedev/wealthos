import React from 'react';
import { dhanBrokerService } from '../../../services/DhanBrokerService';
import { Wallet, RefreshCw, Zap, Shield, TrendingUp, AlertTriangle, Circle } from 'lucide-react';
import { useDhanStore } from '../../../store/dhanStore';
import { useShallow } from 'zustand/react/shallow';
import { motion } from 'framer-motion';

interface LiveTradingVaultProps {
    formatCurrency: (val: number) => string;
    isPrivacyMode: boolean;
}

export const LiveTradingVaultWidget: React.FC<LiveTradingVaultProps> = ({ formatCurrency, isPrivacyMode }) => {
    const isConfigured = dhanBrokerService.isConfigured();
    const { fundLimit: fundData, isLoadingFundLimit: loading, error, fetchFundLimit } = useDhanStore(
        useShallow(state => ({
            fundLimit: state.fundLimit,
            isLoadingFundLimit: state.isLoadingFundLimit,
            error: state.error,
            fetchFundLimit: state.fetchFundLimit
        }))
    );

    React.useEffect(() => {
        if (isConfigured) {
            fetchFundLimit();
        }
    }, [isConfigured, fetchFundLimit]);

    if (!isConfigured) {
        return (
            <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-6 h-full flex flex-col justify-center items-center text-center">
                <div className="p-3 bg-slate-800 rounded-full mb-3 border border-slate-700">
                    <Wallet className="text-slate-400" size={24} />
                </div>
                <h3 className="text-white font-bold mb-1">Live Trading Vault</h3>
                <p className="text-xs text-slate-400">Connect DhanHQ to view real-time trading funds & margin.</p>
            </div>
        );
    }

    const available = fundData?.availabelBalance || 0;
    const utilized = fundData?.utilizedAmount || 0;
    const collateral = fundData?.collateralAmount || 0;
    const totalExposure = available + collateral + utilized;

    // Utilization logic for UI
    const utilizationPct = totalExposure > 0 ? (utilized / totalExposure) * 100 : 0;
    const isHighUtilization = utilizationPct > 80;

    return (
        <div className="bg-gradient-to-br from-indigo-950 via-slate-900 to-black border border-indigo-900/50 rounded-2xl p-5 h-full relative overflow-hidden group">
            {/* Background Effects */}
            <div className="absolute top-0 right-0 p-8 opacity-5">
                <Zap size={120} className="text-indigo-400" />
            </div>

            <div className="flex justify-between items-start mb-6 relative z-10">
                <div className="flex items-center gap-2">
                    <div className="bg-indigo-600/20 text-indigo-400 p-2 rounded-lg border border-indigo-500/20">
                        <Wallet size={16} />
                    </div>
                    <div>
                        <h3 className="text-white font-bold text-sm tracking-wide">Live Trading Vault</h3>
                        <p 
                            title={error || undefined}
                            className={`text-[10px] text-slate-400 flex items-center gap-1 font-mono uppercase tracking-wider ${error ? "cursor-help text-rose-400/90" : ""}`}
                        >
                            <Circle 
                                size={8} 
                                className={`${
                                    loading 
                                        ? "text-amber-400 animate-ping" 
                                        : error 
                                            ? "text-rose-400" 
                                            : "text-emerald-400"
                                } fill-current`} 
                            />
                            {loading 
                                ? 'Syncing...' 
                                : error 
                                    ? 'Sync Failed' 
                                    : 'DhanHQ Linked'
                            }
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => fetchFundLimit(true)}
                    disabled={loading}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-md transition-colors border border-slate-700 disabled:opacity-50"
                >
                    <RefreshCw size={14} className={loading ? "animate-spin text-indigo-400" : ""} />
                </button>
            </div>

            {error && !fundData ? (
                <div className="flex-1 flex items-center justify-center relative z-10">
                    <div className="text-center text-rose-400 text-sm flex flex-col items-center">
                        <AlertTriangle size={24} className="mb-2" />
                        <p>{error}</p>
                    </div>
                </div>
            ) : (
                <div className="relative z-10 flex flex-col justify-between h-[calc(100%-60px)]">
                    <div className="mb-4">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Available to Trade</p>
                        <h2 className="text-3xl font-black text-white font-mono tracking-tighter">
                            {isPrivacyMode ? '••••••' : formatCurrency(available)}
                        </h2>
                    </div>

                    <div className="space-y-3 mb-4">
                        {/* Utilized Margin */}
                        <div className="flex justify-between items-center group/item">
                            <div className="flex items-center gap-2 text-slate-300">
                                <TrendingUp size={14} className="text-rose-400" />
                                <span className="text-xs font-medium">Margin Utilized</span>
                            </div>
                            <span className="text-xs font-mono font-bold text-white">
                                {isPrivacyMode ? '•••' : formatCurrency(utilized)}
                            </span>
                        </div>

                        {/* Collateral */}
                        <div className="flex justify-between items-center group/item">
                            <div className="flex items-center gap-2 text-slate-300">
                                <Shield size={14} className="text-indigo-400" />
                                <span className="text-xs font-medium">Collateral Margin</span>
                            </div>
                            <span className="text-xs font-mono font-bold text-indigo-200">
                                {isPrivacyMode ? '•••' : formatCurrency(collateral)}
                            </span>
                        </div>
                    </div>

                    {/* Progress Bar for Utilization */}
                    <div className="mt-auto">
                        <div className="flex justify-between text-[10px] font-bold uppercase mb-1.5">
                            <span className="text-slate-400">Account Utilization</span>
                            <span className={isHighUtilization ? 'text-rose-400' : 'text-slate-400'}>
                                {utilizationPct.toFixed(1)}%
                            </span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden relative">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(utilizationPct, 100)}%` }}
                                transition={{ type: 'spring', stiffness: 50, damping: 15 }}
                                className={`absolute left-0 top-0 h-full rounded-full ${isHighUtilization ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]' : 'bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]'}`}
                            />
                            {utilizationPct > 0 && (
                                <motion.div
                                    initial={{ x: '-100%' }}
                                    animate={{ x: '100%' }}
                                    transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
                                    className="absolute top-0 bottom-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                                />
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
