import React, { useState } from 'react';
import { RefreshCw, Sparkles, Eye, EyeOff, Atom } from 'lucide-react';
import { motion } from 'framer-motion';

/**
 * QuantumCommandRibbon — collapse / refresh / privacy toggle row.
 * Keeps the rest of the deck focused on math.
 */
export const QuantumCommandRibbon: React.FC<{ onRefresh: () => void }> = ({ onRefresh }) => {
    const [refreshing, setRefreshing] = useState(false);
    const [compact, setCompact] = useState(false);
    return (
        <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-cyan-500/5 via-indigo-500/5 to-fuchsia-500/5 p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
                <Atom size={18} className="text-cyan-400" />
                <div>
                    <div className="text-sm font-black uppercase tracking-widest text-cyan-300">Quantum Terminal</div>
                    <div className="text-[10px] text-slate-400">Cross-asset confluence · live · {new Date().toLocaleString()}</div>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => { setCompact(!compact); }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-[10px] font-bold uppercase tracking-widest text-slate-300 hover:border-cyan-500/50"
                    aria-label={compact ? 'Expand view' : 'Compact view'}
                >
                    {compact ? <Eye size={12} /> : <EyeOff size={12} />}
                    {compact ? 'Expand' : 'Compact'}
                </motion.button>
                <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                        setRefreshing(true);
                        onRefresh();
                        setTimeout(() => setRefreshing(false), 500);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-[10px] font-bold uppercase tracking-widest text-cyan-300 hover:bg-cyan-500/20"
                >
                    <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                    Refresh
                </motion.button>
            </div>
        </div>
    );
};

export default QuantumCommandRibbon;
