import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Zap, RefreshCw, AlertCircle, CheckCircle2, History, ChevronRight } from 'lucide-react';
import { OrderManagementService } from '../../../services/OrderManagementService';

export const PositionGovernor: React.FC = () => {
    const [isAutonomous, setIsAutonomous] = useState(false);
    const [managedCount, setManagedCount] = useState(0);
    const [logs, setLogs] = useState<{ id: string, text: string, time: string, type: 'INFO' | 'SUCCESS' | 'WARN' }[]>([]);

    useEffect(() => {
        const interval = setInterval(() => {
            setManagedCount(OrderManagementService.getManagedCount());
            setLogs(OrderManagementService.getLogs());
        }, 1000);
        return () => clearInterval(interval);
    }, []);


    return (
        <div className="bg-slate-900/60 border border-indigo-500/30 rounded-2xl p-6 backdrop-blur-xl relative overflow-hidden mb-6">
            <div className="absolute top-0 right-0 p-4 opacity-10">
                <Shield className="w-24 h-24 text-indigo-500" />
            </div>

            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-4">
                    <div className={`p-3 rounded-xl ${isAutonomous ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                        <Shield className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white tracking-tight">Shadow Manager</h2>
                        <p className="text-xs text-slate-400 uppercase tracking-widest font-medium">Autonomous Order Governor</p>
                    </div>
                </div>

                <div className="flex items-center space-x-3 bg-slate-800/50 p-1.5 rounded-lg border border-slate-700">
                    <span className={`text-[10px] font-bold px-2 ${isAutonomous ? 'text-emerald-400' : 'text-slate-500'}`}>
                        {isAutonomous ? 'AUTONOMOUS' : 'MANUAL OVERRIDE'}
                    </span>
                    <button 
                        onClick={() => setIsAutonomous(!isAutonomous)}
                        className={`w-12 h-6 rounded-full relative transition-all ${isAutonomous ? 'bg-emerald-500/30 border border-emerald-500/50' : 'bg-slate-700 border border-slate-600'}`}
                    >
                        <motion.div 
                            animate={{ x: isAutonomous ? 24 : 4 }}
                            className={`w-4 h-4 rounded-full mt-0.5 ${isAutonomous ? 'bg-emerald-400' : 'bg-slate-400'}`}
                        />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Active Management Stats */}
                <div className="space-y-4">
                    <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
                                <Zap className="w-4 h-4" />
                            </div>
                            <span className="text-sm font-medium text-slate-300">Managed Positions</span>
                        </div>
                        <span className="text-xl font-bold text-white">{managedCount}</span>
                    </div>

                    <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center">
                            <History className="w-3 h-3 mr-2" />
                            Live Management Log
                        </h3>
                        <div className="space-y-3">
                            <AnimatePresence>
                                {logs.length > 0 ? logs.map(log => (
                                    <motion.div 
                                        key={log.id}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0 }}
                                        className="flex items-start space-x-2 text-[11px]"
                                    >
                                        <span className="text-slate-600 font-mono">{log.time}</span>
                                        <span className={`
                                            ${log.type === 'SUCCESS' ? 'text-emerald-400' : 
                                              log.type === 'WARN' ? 'text-amber-400' : 'text-slate-400'}
                                        `}>
                                            {log.text}
                                        </span>
                                    </motion.div>
                                )) : (
                                    <p className="text-[11px] text-slate-600 italic">No automated actions taken in this session.</p>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </div>

                {/* Automation Logic Info */}
                <div className="bg-indigo-500/5 border border-indigo-500/10 rounded-xl p-5 relative overflow-hidden">
                    <div className="relative z-10">
                        <h3 className="text-sm font-bold text-indigo-300 mb-3 flex items-center">
                            <AlertCircle className="w-4 h-4 mr-2" />
                            Governor Logic
                        </h3>
                        <ul className="space-y-2">
                            <li className="flex items-center text-xs text-slate-400">
                                <CheckCircle2 className="w-3 h-3 mr-2 text-emerald-500" />
                                Auto-Trailing Stop Loss on analyst updates
                            </li>
                            <li className="flex items-center text-xs text-slate-400">
                                <CheckCircle2 className="w-3 h-3 mr-2 text-emerald-500" />
                                Instant Square-off on "Exit Now" signals
                            </li>
                            <li className="flex items-center text-xs text-slate-400">
                                <CheckCircle2 className="w-3 h-3 mr-2 text-emerald-500" />
                                Multi-channel cross-validation enabled
                            </li>
                            <li className="flex items-center text-xs text-slate-400">
                                <RefreshCw className="w-3 h-3 mr-2 text-indigo-400 animate-spin-slow" />
                                Polling active Dhan orders for segment drift
                            </li>
                        </ul>
                        
                        <div className="mt-6 p-3 bg-slate-900/50 rounded-lg border border-slate-700/50">
                            <p className="text-[10px] text-slate-500 leading-relaxed italic">
                                "The Shadow Manager synchronizes analyst lifecycle instructions with your live Dhan brokerage account for 100% hands-free risk management."
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
