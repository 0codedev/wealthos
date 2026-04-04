import React, { useState, useMemo } from 'react';
import { calculateSTCG, calculateLTCG, calculateSlabTax, calculateFnOTurnover, simulateHarvesting } from '../../../lib/quant/tax/indiaTax';
import { Scale, ReceiptText, AlertTriangle, PiggyBank, Briefcase } from 'lucide-react';

export const TaxDashboard: React.FC = () => {

    const formatter = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    });

    // --- CAPITAL GAINS STATE ---
    const [cgtInputs, setCgtInputs] = useState({
        stcgGain: 100000,
        stcgLoss: 0,
        ltcgGain: 200000,
        ltcgLoss: 0
    });

    const cgtResult = useMemo(() => {
        const st = calculateSTCG(cgtInputs.stcgGain, cgtInputs.stcgLoss);
        const lt = calculateLTCG(cgtInputs.ltcgGain, cgtInputs.ltcgLoss);
        return { st, lt, totalTax: st.tax + lt.tax };
    }, [cgtInputs]);

    // --- F&O TRADING STATE ---
    const [fnoInputs, setFnoInputs] = useState({
        tradesStr: '15000, -5000, 22000, -40000, 1000', // comma separated PnLs
        salaryIncome: 800000
    });

    const fnoResult = useMemo(() => {
        const pnlArr = fnoInputs.tradesStr.split(',').map(n => parseFloat(n.trim())).filter(n => !isNaN(n));
        const totalPnl = pnlArr.reduce((acc, curr) => acc + curr, 0);
        
        // Build trade objects (simplifying option premium for UI demo)
        const trades = pnlArr.map(pnl => ({ pnl, isOptionSale: false }));
        const turnoverData = calculateFnOTurnover(trades);
        
        const netBusinessIncome = totalPnl > 0 ? totalPnl : 0; // Losses carried forward, not added to salary
        const totalGrossIncome = fnoInputs.salaryIncome + netBusinessIncome;
        const totalTax = calculateSlabTax(totalGrossIncome);
        // Base tax without F&O
        const salaryOnlyTax = calculateSlabTax(fnoInputs.salaryIncome);

        return {
            totalPnl,
            turnover: turnoverData.turnover,
            auditRequired: turnoverData.auditRequired,
            businessTaxAdded: Math.max(0, totalTax - salaryOnlyTax),
            totalGrossIncome,
            totalTax
        };
    }, [fnoInputs]);

    // --- HARVESTING MATRIX STATE ---
    const [harvHolding, setHarvHolding] = useState({ qty: 100, buyPrice: 500, ltp: 400, type: 'ST' });
    const [harvestOpp, setHarvestOpp] = useState<any[]>([]);

    const addHarvest = () => {
        const h = { ticker: `Asset ${harvestOpp.length + 1}`, qty: harvHolding.qty, buyPrice: harvHolding.buyPrice, ltp: harvHolding.ltp, isShortTerm: harvHolding.type === 'ST' };
        setHarvestOpp([...harvestOpp, ...simulateHarvesting([h])]);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-slate-200">Indian Taxation & Complience Evaluator</h2>
                <div className="text-xs text-rose-400 font-bold bg-rose-500/10 border border-rose-500/20 px-3 py-1 rounded-full flex items-center gap-1">
                    <Scale size={14} /> New Regime 2024
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* CAPITAL GAINS */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                    <h3 className="font-bold text-white flex items-center gap-2 mb-4"><ReceiptText size={18} className="text-indigo-500"/> Capital Gains Desk</h3>
                    
                    <div className="space-y-4 mb-6">
                        <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl">
                            <h4 className="text-xs font-bold text-slate-400 mb-2">Short Term (STCG @ 20%)</h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] text-slate-500 uppercase font-black tracking-wider mb-1">Booked Profit</label>
                                    <input type="number" value={cgtInputs.stcgGain} onChange={e => setCgtInputs({...cgtInputs, stcgGain: parseInt(e.target.value)||0})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-emerald-400 font-mono text-sm outline-none" />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-slate-500 uppercase font-black tracking-wider mb-1">Booked Losses</label>
                                    <input type="number" value={cgtInputs.stcgLoss} onChange={e => setCgtInputs({...cgtInputs, stcgLoss: parseInt(e.target.value)||0})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-rose-400 font-mono text-sm outline-none" />
                                </div>
                            </div>
                            <div className="flex justify-between items-center mt-3 pt-3 border-t border-slate-800/50">
                                <span className="text-xs text-slate-400">STCG Tax Liability</span>
                                <span className="text-sm font-bold text-indigo-400 font-mono">{formatter.format(cgtResult.st.tax)}</span>
                            </div>
                        </div>

                        <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl">
                            <h4 className="text-xs font-bold text-slate-400 mb-2">Long Term (LTCG @ 12.5% &gt; 1.25L)</h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] text-slate-500 uppercase font-black tracking-wider mb-1">Booked Profit</label>
                                    <input type="number" value={cgtInputs.ltcgGain} onChange={e => setCgtInputs({...cgtInputs, ltcgGain: parseInt(e.target.value)||0})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-emerald-400 font-mono text-sm outline-none" />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-slate-500 uppercase font-black tracking-wider mb-1">Booked Losses</label>
                                    <input type="number" value={cgtInputs.ltcgLoss} onChange={e => setCgtInputs({...cgtInputs, ltcgLoss: parseInt(e.target.value)||0})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-rose-400 font-mono text-sm outline-none" />
                                </div>
                            </div>
                            <div className="flex justify-between items-center mt-3 pt-3 border-t border-slate-800/50">
                                <span className="text-xs text-slate-400">LTCG Tax Liability <span className="text-[10px] text-emerald-500 ml-1">(-1.25L Exempt)</span></span>
                                <span className="text-sm font-bold text-indigo-400 font-mono">{formatter.format(cgtResult.lt.tax)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-xl text-center">
                        <span className="text-xs text-indigo-300 font-bold uppercase block mb-1">Cumulative Equity Tax Draft</span>
                        <span className="text-3xl font-black text-indigo-400 font-mono">{formatter.format(cgtResult.totalTax)}</span>
                    </div>
                </div>

                {/* F&O AND BUSINESS TAX */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col">
                    <h3 className="font-bold text-white flex items-center gap-2 mb-4"><Briefcase size={18} className="text-amber-500"/> F&O Turnover & Slab Evaluator</h3>
                    
                    <div className="space-y-4 mb-4 flex-1">
                        <div>
                            <label className="block text-xs text-slate-400 mb-1 font-bold">Standard Salary Income (₹)</label>
                            <input type="number" value={fnoInputs.salaryIncome} onChange={e => setFnoInputs({...fnoInputs, salaryIncome: parseInt(e.target.value)||0})} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm outline-none focus:border-amber-500" />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1 font-bold">Comma Separated Intraday/F&O Trade PnLs</label>
                            <textarea 
                                value={fnoInputs.tradesStr} 
                                onChange={e => setFnoInputs({...fnoInputs, tradesStr: e.target.value})} 
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-300 font-mono text-sm max-h-24 resize-none outline-none focus:border-amber-500" 
                                rows={2} 
                            />
                            <p className="text-[10px] text-slate-500 mt-1">Example: 15000, -5000, 20000</p>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl border-l-4 border-l-blue-500">
                                <span className="text-[10px] text-slate-500 uppercase font-black block mb-1">Sec 44AB Turnover</span>
                                <span className="text-sm font-bold text-white font-mono">{formatter.format(fnoResult.turnover)}</span>
                            </div>
                            <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl border-l-4 border-l-emerald-500">
                                <span className="text-[10px] text-slate-500 uppercase font-black block mb-1">Net F&O PnL</span>
                                <span className={`text-sm font-bold font-mono ${fnoResult.totalPnl < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                                    {formatter.format(fnoResult.totalPnl)}
                                </span>
                            </div>
                        </div>

                        {fnoResult.auditRequired && (
                            <div className="bg-rose-500/10 border border-rose-500/20 p-2 text-[10px] text-rose-300 rounded flex gap-2">
                                <AlertTriangle size={14}/> <span>Warning: Turnover exceeds ₹10 Cr. Formal Tax Audit Required.</span>
                            </div>
                        )}
                        {!fnoResult.auditRequired && fnoResult.totalPnl < 0 && (
                            <div className="bg-blue-500/10 border border-blue-500/20 p-2 text-[10px] text-blue-300 rounded">
                                * PnL is negative. To carry forward this F&O loss to next year, you MUST file your ITR before the deadline.
                            </div>
                        )}
                    </div>
                    
                    <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl flex justify-between items-center text-center">
                        <div>
                            <span className="text-[10px] text-amber-300/70 font-bold uppercase block mb-1">F&O Tax Burden</span>
                            <span className="text-lg font-black text-amber-500 font-mono">+{formatter.format(fnoResult.businessTaxAdded)}</span>
                        </div>
                        <div className="w-[1px] h-8 bg-amber-500/20"></div>
                        <div>
                            <span className="text-[10px] text-amber-300/70 font-bold uppercase block mb-1">Total IT Dept Slab Tax</span>
                            <span className="text-xl font-black text-amber-400 font-mono">{formatter.format(fnoResult.totalTax)}</span>
                        </div>
                    </div>
                </div>

                {/* TAX LOSS HARVESTING */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 lg:col-span-2">
                    <h3 className="font-bold text-white flex items-center gap-2 mb-4"><PiggyBank size={18} className="text-emerald-500"/> Tax Loss Harvesting Matrix</h3>
                    
                    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden mb-4">
                        <table className="w-full text-left text-sm text-slate-300">
                            <thead className="bg-slate-900/50 text-xs text-slate-500 border-b border-slate-800">
                                <tr>
                                    <th className="px-4 py-2 font-bold uppercase">Asset / Ticker</th>
                                    <th className="px-4 py-2 font-bold uppercase">Type</th>
                                    <th className="px-4 py-2 font-bold uppercase text-right">Qty</th>
                                    <th className="px-4 py-2 font-bold uppercase text-right">Loss to Book</th>
                                    <th className="px-4 py-2 font-bold uppercase text-emerald-500 text-right">Tax Savings</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y map-slate-800/30">
                                {harvestOpp.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500 italic">No harvesting simulations queued. Add holdings below.</td>
                                    </tr>
                                )}
                                {harvestOpp.map((opp, idx) => (
                                    <tr key={idx} className="hover:bg-slate-900/30">
                                        <td className="px-4 py-3 font-bold text-white">{opp.ticker}</td>
                                        <td className="px-4 py-3"><span className={`text-[10px] px-2 py-0.5 rounded font-bold ${opp.type === 'ST' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}`}>{opp.type}</span></td>
                                        <td className="px-4 py-3 font-mono text-right">{opp.qty}</td>
                                        <td className="px-4 py-3 font-mono text-rose-400 text-right">-{formatter.format(opp.unrealizedLoss)}</td>
                                        <td className="px-4 py-3 font-mono text-emerald-400 font-bold text-right">+{formatter.format(opp.taxSaved)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex gap-4">
                        <input type="number" placeholder="Qty" value={harvHolding.qty} onChange={e=>setHarvHolding({...harvHolding,qty:parseInt(e.target.value)||0})} className="w-24 bg-slate-950 border border-slate-800 rounded p-2 text-white text-sm outline-none" />
                        <input type="number" placeholder="Buy Price" value={harvHolding.buyPrice} onChange={e=>setHarvHolding({...harvHolding,buyPrice:parseFloat(e.target.value)||0})} className="w-32 bg-slate-950 border border-slate-800 rounded p-2 text-white text-sm outline-none" />
                        <input type="number" placeholder="Current LTP" value={harvHolding.ltp} onChange={e=>setHarvHolding({...harvHolding,ltp:parseFloat(e.target.value)||0})} className="w-32 bg-slate-950 border border-slate-800 rounded p-2 text-rose-400 text-sm outline-none" />
                        <select value={harvHolding.type} onChange={e=>setHarvHolding({...harvHolding, type: e.target.value})} className="bg-slate-950 border border-slate-800 rounded p-2 text-white text-sm outline-none">
                            <option value="ST">Short Term</option>
                            <option value="LT">Long Term</option>
                        </select>
                        <button onClick={addHarvest} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 rounded transition-colors uppercase tracking-wider">Simulate Cut</button>
                    </div>

                </div>

            </div>
        </div>
    );
};
