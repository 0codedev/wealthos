import React from 'react';
import { Sliders, AlertTriangle } from 'lucide-react';
import { useQuantumStore } from '../../store/quantumStore';
import { useShallow } from 'zustand/react/shallow';
import type { ScenarioAxis, ScenarioImpact } from '../../types/quantum';
import { formatCurrency } from '../../utils/helpers';

/**
 * QuantumScenariosRibbon — macro shock slider + total impact.
 */
const AXES: Array<{ id: ScenarioAxis; label: string; min: number; max: number; step: number; unit: string }> = [
    { id: 'NIFTY',  label: 'NIFTY shock',  min: -5,  max: 5,  step: 0.1, unit: '%' },
    { id: 'VIX',    label: 'VIX shock',    min: -20, max: 20, step: 1,   unit: '%' },
    { id: 'RATES',  label: 'Rates shock',  min: -1,  max: 1,  step: 0.05, unit: '%' },
    { id: 'USDINR', label: 'USD/INR shock',min: -3,  max: 3,  step: 0.1, unit: '%' },
    { id: 'CRUDE',  label: 'Crude shock',  min: -15, max: 15, step: 1,   unit: '%' },
];

export const QuantumScenariosRibbon: React.FC<{ impact: ScenarioImpact }> = ({ impact }) => {
    const activeAxis = useQuantumStore(useShallow(s => s.activeAxis));
    const setActiveAxis = useQuantumStore(useShallow(s => s.setActiveAxis));
    const activeShock = useQuantumStore(useShallow(s => s.activeShock));
    const setActiveShock = useQuantumStore(useShallow(s => s.setActiveShock));

    const axis = AXES.find(a => a.id === activeAxis) || AXES[0]!;
    const totalExposure = useQuantumStore(useShallow(s => s.risk?.assets.reduce((sum, a) => sum + a.exposure, 0) ?? 0));
    const impactPct = totalExposure > 0 ? (impact.pnlImpact / totalExposure) * 100 : 0;
    const isCatastrophic = Math.abs(impactPct) > 10;

    return (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-4">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Sliders size={16} className="text-cyan-400" />
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-300">Live Scenario Simulator</h3>
                </div>
                {isCatastrophic && (
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-rose-500/10 border border-rose-500/30">
                        <AlertTriangle size={12} className="text-rose-400" />
                        <span className="text-[10px] font-bold text-rose-300">Tail-risk band</span>
                    </div>
                )}
            </div>

            {/* Axis tabs */}
            <div className="flex flex-wrap gap-1.5 mb-4">
                {AXES.map(a => (
                    <button
                        key={a.id}
                        onClick={() => { setActiveAxis(a.id); setActiveShock(0); }}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                            a.id === activeAxis
                                ? 'bg-cyan-500/20 border border-cyan-400/40 text-cyan-300'
                                : 'bg-slate-900/40 border border-slate-800 text-slate-400 hover:border-slate-600'
                        }`}
                    >
                        {a.label}
                    </button>
                ))}
            </div>

            {/* Slider */}
            <div className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="text-slate-400">Shock: <span className="font-mono font-bold text-slate-200">{activeShock > 0 ? '+' : ''}{activeShock}{axis.unit}</span></span>
                        <span className="text-slate-500">range {axis.min}{axis.unit} … {axis.max}{axis.unit}</span>
                    </div>
                    <input
                        type="range"
                        min={axis.min}
                        max={axis.max}
                        step={axis.step}
                        value={activeShock}
                        onChange={(e) => setActiveShock(parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                    />
                </div>
                <div className="md:w-72">
                    <div className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-0.5">Estimated Book P&L</div>
                    <div className={`text-2xl font-bold ${impact.pnlImpact >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {impact.pnlImpact >= 0 ? '+' : ''}{formatCurrency(impact.pnlImpact)}
                    </div>
                    <div className="text-[10px] text-slate-500">
                        {impactPct >= 0 ? '+' : ''}{impactPct.toFixed(2)}% of book · parametric
                    </div>
                </div>
            </div>
        </div>
    );
};

export default QuantumScenariosRibbon;
