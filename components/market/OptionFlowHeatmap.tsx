import React, { useMemo } from 'react';
import { UnusualFlowAlert } from '../../services/OptionChainService';
import { Zap, Activity, ShieldAlert } from 'lucide-react';

interface OptionFlowHeatmapProps {
    symbol: string;
    underlyingValue: number;
    expiries: string[];
    alerts: UnusualFlowAlert[];
}

export const OptionFlowHeatmap: React.FC<OptionFlowHeatmapProps> = ({
    symbol,
    underlyingValue,
    expiries,
    alerts
}) => {
    // Determine the strikes around ATM
    const strikes = useMemo(() => {
        if (!underlyingValue || underlyingValue <= 0) return [];
        
        // Define strike intervals based on symbol
        const interval = ['BANKNIFTY', 'FINNIFTY', 'SENSEX'].includes(symbol.toUpperCase()) ? 100 : 50;
        const atm = Math.round(underlyingValue / interval) * interval;
        
        const list = [];
        for (let i = -3; i <= 3; i++) {
            list.push(atm + (i * interval));
        }
        return list;
    }, [symbol, underlyingValue]);

    // Expiries to show (limit to nearest 3 for density)
    const displayExpiries = useMemo(() => {
        if (!expiries || expiries.length === 0) {
            // Generate some fallback Thursdays if empty
            const list = [];
            const today = new Date();
            for (let i = 0; i < 3; i++) {
                const d = new Date();
                d.setDate(today.getDate() + (3 + 7 - today.getDay()) % 7 + (i * 7));
                list.push(d.toISOString().split('T')[0]);
            }
            return list;
        }
        return expiries.slice(0, 3);
    }, [expiries]);

    // Map alerts to grid cells for fast lookup
    const cellAlerts = useMemo(() => {
        const map: Record<string, UnusualFlowAlert[]> = {};
        alerts.forEach(alert => {
            if (alert.symbol.toUpperCase() !== symbol.toUpperCase()) return;
            const key = `${alert.strike}_${alert.optionType}`;
            if (!map[key]) map[key] = [];
            map[key].push(alert);
        });
        return map;
    }, [alerts, symbol]);

    return (
        <div className="border border-slate-800 bg-slate-900/90 p-6 rounded-[32px] space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
                        <div className="w-1 h-3 bg-emerald-500 rounded-full" />
                        Unusual Flow Heatmap (Strikes vs Expiries)
                    </h3>
                    <p className="text-[10px] text-slate-500 mt-1">
                        Real-time concentration matrix of unusual option contract activity. Hover on cells to inspect.
                    </p>
                </div>
                
                {/* Legend */}
                <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-wider text-slate-400">
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded bg-emerald-500/25 border border-emerald-500/40" />
                        <span>CE Unusual Activity</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded bg-rose-500/25 border border-rose-500/40" />
                        <span>PE Unusual Activity</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded bg-slate-800 border border-slate-700" />
                        <span>Neutral / Low Volume</span>
                    </div>
                </div>
            </div>

            {/* Grid Scrollable Wrapper */}
            <div className="overflow-x-auto pb-2">
                <div className="min-w-[700px] space-y-4">
                    {/* Header: Strike columns */}
                    <div className="grid grid-cols-8 gap-2.5 pl-24">
                        {strikes.map(strike => {
                            const isATM = Math.abs(strike - underlyingValue) < (strike % 100 === 0 ? 50 : 25);
                            return (
                                <div 
                                    key={strike} 
                                    className={`text-center py-2 px-1 rounded-xl text-[10px] font-black border ${
                                        isATM 
                                            ? 'bg-indigo-600/10 border-indigo-500/35 text-indigo-400' 
                                            : 'bg-slate-950/40 border-slate-850 text-slate-400'
                                    }`}
                                >
                                    <div>{strike}</div>
                                    <div className="text-[8px] font-normal text-slate-500 mt-0.5">
                                        {isATM ? 'ATM' : strike > underlyingValue ? 'OTM CE / ITM PE' : 'ITM CE / OTM PE'}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Rows: Expiries */}
                    {displayExpiries.map(expiry => {
                        // Format date nicely
                        const dateObj = new Date(expiry);
                        const formattedDate = dateObj.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });

                        return (
                            <div key={expiry} className="flex items-stretch gap-3">
                                {/* Row Label: Expiry Date */}
                                <div className="w-20 flex-shrink-0 flex flex-col justify-center bg-slate-950/50 border border-slate-850 rounded-2xl p-2.5 text-center">
                                    <span className="text-[10px] font-black text-slate-300">{formattedDate}</span>
                                    <span className="text-[7px] font-medium text-slate-500 uppercase tracking-wider mt-0.5">{expiry}</span>
                                </div>

                                {/* Heatmap cells for strikes */}
                                <div className="grid grid-cols-7 gap-2.5 flex-1">
                                    {strikes.map(strike => {
                                        const ceKey = `${strike}_CE`;
                                        const peKey = `${strike}_PE`;
                                        
                                        const ceAlertsList = cellAlerts[ceKey] || [];
                                        const peAlertsList = cellAlerts[peKey] || [];
                                        
                                        const hasCeAlert = ceAlertsList.length > 0;
                                        const hasPeAlert = peAlertsList.length > 0;
                                        
                                        // Decide color & border glow
                                        let cellStyle = 'bg-slate-950/20 border-slate-850 hover:border-slate-700 text-slate-600';
                                        let alertBadge = null;

                                        if (hasCeAlert && hasPeAlert) {
                                            cellStyle = 'bg-gradient-to-br from-emerald-500/15 to-rose-500/15 border-indigo-500/40 hover:border-indigo-400 shadow-indigo-950/40 text-indigo-300';
                                            alertBadge = <Zap size={10} className="text-indigo-400 animate-pulse" />;
                                        } else if (hasCeAlert) {
                                            cellStyle = 'bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-400/60 shadow-emerald-950/30 text-emerald-300';
                                            alertBadge = <Activity size={10} className="text-emerald-400" />;
                                        } else if (hasPeAlert) {
                                            cellStyle = 'bg-rose-500/10 border-rose-500/30 hover:border-rose-400/60 shadow-rose-950/30 text-rose-300';
                                            alertBadge = <ShieldAlert size={10} className="text-rose-400" />;
                                        }

                                        return (
                                            <div 
                                                key={strike}
                                                className={`group relative flex flex-col justify-between p-2.5 border rounded-2xl transition-all cursor-help h-[72px] ${cellStyle}`}
                                            >
                                                {/* Cell Header */}
                                                <div className="flex justify-between items-start">
                                                    <span className="text-[8px] font-black text-slate-500 group-hover:text-slate-400">
                                                        {symbol}
                                                    </span>
                                                    {alertBadge}
                                                </div>

                                                {/* Cell Value / Activity preview */}
                                                <div className="text-center my-1">
                                                    {hasCeAlert || hasPeAlert ? (
                                                        <div className="text-[9px] font-black truncate">
                                                            {hasCeAlert ? ceAlertsList[0].description : peAlertsList[0].description}
                                                        </div>
                                                    ) : (
                                                        <div className="text-[9px] font-bold text-slate-600 group-hover:text-slate-500">
                                                            Quiet Strike
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Mini indicators at bottom */}
                                                <div className="flex justify-between items-center text-[7px] font-black text-slate-500">
                                                    <span className={hasCeAlert ? 'text-emerald-400' : ''}>CE</span>
                                                    <span className={hasPeAlert ? 'text-rose-400' : ''}>PE</span>
                                                </div>

                                                {/* Premium hover tooltip */}
                                                <div className="absolute left-1/2 bottom-full mb-2 -translate-x-1/2 hidden group-hover:block z-50 w-64 p-3 bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl text-[9px] text-slate-300 font-mono space-y-2 pointer-events-none">
                                                    <div className="border-b border-slate-800 pb-1 flex justify-between font-bold text-white">
                                                        <span>{symbol} {strike}</span>
                                                        <span className="text-indigo-400">{formattedDate}</span>
                                                    </div>
                                                    
                                                    {hasCeAlert && (
                                                        <div className="space-y-0.5 text-emerald-400">
                                                            <div className="font-bold">CALL ALERT:</div>
                                                            {ceAlertsList.map(a => (
                                                                <div key={a.id}>• {a.description} ({a.details})</div>
                                                            ))}
                                                        </div>
                                                    )}
                                                    
                                                    {hasPeAlert && (
                                                        <div className="space-y-0.5 text-rose-400">
                                                            <div className="font-bold">PUT ALERT:</div>
                                                            {peAlertsList.map(a => (
                                                                <div key={a.id}>• {a.description} ({a.details})</div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {(!hasCeAlert && !hasPeAlert) && (
                                                        <div className="text-slate-500 text-center py-1">
                                                            No unusual shifts. Volume and OI within standard deviations.
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
