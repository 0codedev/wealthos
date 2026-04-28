import React, { useState } from 'react';
import { Calculator, Zap, AlertCircle } from 'lucide-react';
import { dhanBrokerService, DhanMarginRequest, DhanMarginResponse, SECURITY_IDS } from '../../../../services/DhanBrokerService';
import { useToast } from '../../../shared/ToastProvider';

const MarginEstimator: React.FC = () => {
    const { toast } = useToast();
    const [ticker, setTicker] = useState('RELIANCE');
    const [quantity, setQuantity] = useState('1');
    const [price, setPrice] = useState('2500');
    const [action, setAction] = useState<'BUY' | 'SELL'>('BUY');
    const [productType, setProductType] = useState<'CNC' | 'INTRADAY' | 'MARGIN'>('CNC');
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<DhanMarginResponse | null>(null);

    const handleCalculate = async () => {
        if (!dhanBrokerService.isConfigured()) {
            toast.error('Dhan API credentials not configured.');
            return;
        }

        const qty = parseInt(quantity, 10);
        const prc = parseFloat(price);

        if (isNaN(qty) || isNaN(prc) || qty <= 0 || prc <= 0) {
            toast.error('Invalid quantity or price');
            return;
        }

        const secInfo = SECURITY_IDS[ticker.toUpperCase()];
        if (!secInfo) {
            toast.error(`Unknown ticker "${ticker}". Try RELIANCE, TCS, INFY, HDFCBANK etc.`);
            return;
        }

        setIsLoading(true);
        try {
            const req: DhanMarginRequest = {
                exchangeSegment: secInfo.segment as any,
                transactionType: action,
                quantity: qty,
                productType,
                securityId: secInfo.id,
                price: prc,
            };
            const data = await dhanBrokerService.calculateMargin(req);
            setResult(data);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            toast.error(message || 'Failed to calculate margin.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="group relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-slate-900 p-6 shadow-xl">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-blue-500/5" />

            <div className="relative z-10 mb-6 flex items-center gap-3">
                <div className="rounded-xl bg-cyan-500/20 p-2.5 text-cyan-400">
                    <Calculator size={20} />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-white">Margin Estimator</h3>
                    <p className="text-xs text-slate-400">Pre-calculate SPAN and exposure margin before trading.</p>
                </div>
            </div>

            <div className="relative z-10 grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="mb-1 block text-xs text-slate-500">Ticker</label>
                            <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-sm text-white" />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs text-slate-500">Action</label>
                            <select value={action} onChange={e => setAction(e.target.value as any)} className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-sm text-white">
                                <option value="BUY">BUY</option>
                                <option value="SELL">SELL</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="mb-1 block text-xs text-slate-500">Qty</label>
                            <input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 font-mono text-sm text-white" />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs text-slate-500">Price (INR)</label>
                            <input type="number" step="0.05" value={price} onChange={e => setPrice(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 font-mono text-sm text-white" />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs text-slate-500">Product</label>
                            <select value={productType} onChange={e => setProductType(e.target.value as any)} className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-sm text-white">
                                <option value="CNC">Delivery (CNC)</option>
                                <option value="INTRADAY">Intraday (MIS)</option>
                                <option value="MARGIN">Margin</option>
                            </select>
                        </div>
                    </div>

                    <button
                        onClick={handleCalculate}
                        disabled={isLoading || !dhanBrokerService.isConfigured()}
                        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 py-2.5 text-sm font-bold text-white shadow-[0_0_15px_-3px_rgba(6,182,212,0.4)] transition-all hover:bg-cyan-500 disabled:opacity-50"
                    >
                        <Zap size={16} />
                        {isLoading ? 'Calculating...' : 'Calculate Margin'}
                    </button>

                    {!dhanBrokerService.isConfigured() && (
                        <p className="mt-2 flex items-center gap-1 text-xs text-rose-400">
                            <AlertCircle size={12} /> DhanHQ not configured
                        </p>
                    )}
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                    <h4 className="mb-4 text-sm font-bold text-slate-300">Margin Breakdown</h4>

                    {result ? (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                                <span className="text-xs font-bold uppercase text-slate-400">Total Margin Required</span>
                                <span className="font-mono text-lg font-black text-cyan-400">INR {result.totalMargin?.toLocaleString('en-IN') || '-'}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="rounded-lg border border-slate-800 bg-slate-900 p-2.5">
                                    <div className="text-[10px] uppercase text-slate-500">SPAN Margin</div>
                                    <div className="font-mono text-sm font-bold text-white">INR {result.spanMargin?.toLocaleString('en-IN') || '0'}</div>
                                </div>
                                <div className="rounded-lg border border-slate-800 bg-slate-900 p-2.5">
                                    <div className="text-[10px] uppercase text-slate-500">Exposure Margin</div>
                                    <div className="font-mono text-sm font-bold text-white">INR {result.exposureMargin?.toLocaleString('en-IN') || '0'}</div>
                                </div>
                                <div className="rounded-lg border border-slate-800 bg-slate-900 p-2.5">
                                    <div className="text-[10px] uppercase text-slate-500">Available Margin</div>
                                    <div className="font-mono text-sm font-bold text-emerald-400">INR {result.availableMargin?.toLocaleString('en-IN') || '0'}</div>
                                </div>
                                <div className="rounded-lg border border-slate-800 bg-slate-900 p-2.5">
                                    <div className="text-[10px] uppercase text-slate-500">Variable Margin</div>
                                    <div className="font-mono text-sm font-bold text-white">INR {result.variableMargin?.toLocaleString('en-IN') || '0'}</div>
                                </div>
                            </div>
                            {(result.insufficientBalance ?? 0) > 0 && (
                                <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-center">
                                    <p className="text-xs font-bold text-rose-400">Insufficient Balance: INR {result.insufficientBalance?.toLocaleString('en-IN')}</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="py-8 text-center text-slate-600">
                            <Calculator size={32} className="mx-auto mb-2 opacity-20" />
                            <p className="text-sm">Enter trade details and click Calculate</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MarginEstimator;
