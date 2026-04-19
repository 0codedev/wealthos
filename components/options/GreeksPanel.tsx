import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Info } from 'lucide-react';
import { formatCurrencyCompact as formatCurrency } from '../../utils/helpers';
import {
    BlackScholesInput,
    BlackScholesResult,
    blackScholes,
    impliedVolatility,
    IVSolverResult
} from '../../utils/optionsMath';

interface GreeksPanelProps {
    spot: number;
    strike: number;
    daysToExpiry: number;
    riskFreeRate: number;
    marketPrice?: number; // observed premium; if present, IV is solved from it
    type: 'CE' | 'PE';
}

const GreeksPanel: React.FC<GreeksPanelProps> = ({
    spot,
    strike,
    daysToExpiry,
    riskFreeRate,
    marketPrice,
    type
}) => {
    // Sliders allow the user to drive IV/DTE/r in real time
    const [ivOverride, setIvOverride] = useState<number>(0.16);
    const [dte, setDte] = useState<number>(daysToExpiry);
    const [rate, setRate] = useState<number>(riskFreeRate);

    const T = Math.max(0.001, dte / 365);

    // If marketPrice is provided, solve IV from it. Otherwise use slider override.
    const ivResolved: IVSolverResult = useMemo(() => {
        if (marketPrice && marketPrice > 0) {
            return impliedVolatility({
                marketPrice,
                spot, strike,
                timeToExpiry: T,
                riskFreeRate: rate,
                isCall: type === 'CE'
            });
        }
        return { iv: ivOverride, converged: true, iterations: 0, finalError: 0 };
    }, [marketPrice, spot, strike, T, rate, type, ivOverride]);

    const sigma = ivResolved.iv;

    const bs: BlackScholesResult = useMemo(() => {
        return blackScholes({
            spot, strike,
            timeToExpiry: T,
            riskFreeRate: rate,
            volatility: Math.max(0.001, isNaN(sigma) ? 0.16 : sigma)
        } as BlackScholesInput);
    }, [spot, strike, T, rate, sigma]);

    // Normalize Vega and Rho to "per 1 percentage point" for readability
    const vegaPct = (bs.vega || 0) / 100;
    const rhoPct = ((type === 'CE' ? bs.callRho : bs.putRho) || 0) / 100;
    const thetaPerDay = (type === 'CE' ? bs.callTheta : bs.putTheta) || 0;
    const delta = (type === 'CE' ? bs.callDelta : bs.putDelta) || 0;

    const rows: Array<{ label: string; value: string; description: string; color: string }> = [
        {
            label: 'Price',
            value: formatCurrency(type === 'CE' ? (bs.callPrice || 0) : (bs.putPrice || 0)),
            description: type === 'CE' ? 'Call premium' : 'Put premium',
            color: 'text-indigo-600 dark:text-indigo-300'
        },
        {
            label: 'Delta',
            value: (Number(delta) || 0).toFixed(3),
            description: 'dPrice / dSpot',
            color: 'text-slate-700 dark:text-slate-200'
        },
        {
            label: 'Gamma',
            value: (Number(bs.gamma) || 0).toFixed(4),
            description: 'dDelta / dSpot',
            color: 'text-slate-700 dark:text-slate-200'
        },
        {
            label: 'Vega',
            value: (Number(vegaPct) || 0).toFixed(2),
            description: 'dPrice per +1% IV',
            color: 'text-slate-700 dark:text-slate-200'
        },
        {
            label: 'Theta',
            value: (Number(thetaPerDay) || 0).toFixed(2),
            description: 'dPrice per day',
            color: thetaPerDay < 0 ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-600 dark:text-emerald-300'
        },
        {
            label: 'Rho',
            value: (Number(rhoPct) || 0).toFixed(2),
            description: 'dPrice per +1% rate',
            color: 'text-slate-700 dark:text-slate-200'
        }
    ];

    return (
        <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800/70 bg-white/80 dark:bg-slate-900/60 backdrop-blur-xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Info className="w-4 h-4 text-indigo-500" />
                    Greeks · {type}
                </h3>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${type === 'CE' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' : 'bg-rose-500/15 text-rose-600 dark:text-rose-300'}`}>
                    {type === 'CE' ? 'Call' : 'Put'}
                </span>
            </div>

            {/* Sliders for IV / DTE / Rate */}
            <div className="space-y-3 mb-4">
                <Slider
                    label="Implied Volatility"
                    suffix="%"
                    value={marketPrice ? sigma * 100 : ivOverride * 100}
                    min={5}
                    max={80}
                    step={0.5}
                    onChange={v => setIvOverride(v / 100)}
                    disabled={!!marketPrice}
                    hint={marketPrice ? (ivResolved.converged ? 'Solved from market price' : 'IV did not converge') : 'Override only'}
                />
                <Slider
                    label="Days to Expiry"
                    suffix=" d"
                    value={dte}
                    min={0}
                    max={60}
                    step={1}
                    onChange={setDte}
                />
                <Slider
                    label="Risk-Free Rate"
                    suffix="%"
                    value={rate * 100}
                    min={3}
                    max={9}
                    step={0.05}
                    onChange={v => setRate(v / 100)}
                />
            </div>

            {/* Greeks table */}
            <motion.div
                key={`${sigma.toFixed(3)}-${T.toFixed(3)}-${rate.toFixed(3)}`}
                initial={{ opacity: 0.4, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className="grid grid-cols-2 gap-2"
            >
                {rows.map(r => (
                    <div
                        key={r.label}
                        className="p-2.5 rounded-lg bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/50 dark:border-slate-700/50"
                    >
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{r.label}</div>
                        <div className={`text-base font-bold ${r.color}`}>{r.value}</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{r.description}</div>
                    </div>
                ))}
            </motion.div>

            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">
                Black-Scholes pricing with continuous dividend yield q=0 (Indian index options are European cash-settled).
                All Greeks computed analytically — Gamma and Vega are dimensionless ∂/∂σ; we present Vega per +1% IV for legibility.
            </p>
        </div>
    );
};

interface SliderProps {
    label: string;
    suffix: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (v: number) => void;
    hint?: string;
    disabled?: boolean;
}

const Slider: React.FC<SliderProps> = ({ label, suffix, value, min, max, step, onChange, hint, disabled }) => {
    return (
        <div className={disabled ? 'opacity-70' : ''}>
            <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide">{label}</span>
                <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-300">
                    {value.toFixed(step < 1 ? 2 : 0)}{suffix}
                </span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={e => onChange(Number(e.target.value))}
                disabled={disabled}
                className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 disabled:cursor-not-allowed"
                aria-label={label}
            />
            {hint && <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{hint}</p>}
        </div>
    );
};

export default GreeksPanel;
