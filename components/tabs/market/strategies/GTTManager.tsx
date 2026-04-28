import React, { useState, useEffect } from 'react';
import { Target, Activity, Plus, RefreshCw, AlertCircle } from 'lucide-react';
import { dhanBrokerService, DhanGTTOrderRequest, SECURITY_IDS } from '../../../../services/DhanBrokerService';
import { useToast } from '../../../shared/ToastProvider';

const GTTManager: React.FC = () => {
    const { toast } = useToast();
    const [orders, setOrders] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const [ticker, setTicker] = useState('RELIANCE');
    const [action, setAction] = useState<'BUY' | 'SELL'>('BUY');
    const [triggerPrice, setTriggerPrice] = useState('');
    const [price, setPrice] = useState('');
    const [quantity, setQuantity] = useState('1');

    const fetchOrders = async () => {
        if (!dhanBrokerService.isConfigured()) return;
        setIsLoading(true);
        try {
            const data = await dhanBrokerService.fetchForeverOrders();
            setOrders(data || []);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchOrders();
    }, []);

    const handleCreate = async () => {
        if (!dhanBrokerService.isConfigured()) {
            toast.error('Dhan credentials not configured');
            return;
        }

        const tPrice = parseFloat(triggerPrice);
        const lPrice = parseFloat(price);
        const qty = parseInt(quantity, 10);

        if (isNaN(tPrice) || isNaN(lPrice) || isNaN(qty)) {
            toast.error('Invalid input values');
            return;
        }

        const secInfo = SECURITY_IDS[ticker.toUpperCase()];
        if (!secInfo) {
            toast.error(`Unknown ticker "${ticker}". Try RELIANCE, TCS, INFY, HDFCBANK etc.`);
            return;
        }

        setIsLoading(true);
        try {
            const req: DhanGTTOrderRequest = {
                orderFlag: 'SINGLE',
                transactionType: action,
                exchangeSegment: secInfo.segment as any,
                productType: 'CNC',
                orderType: 'LIMIT',
                validity: 'DAY',
                tradingSymbol: ticker,
                securityId: secInfo.id,
                quantity: qty,
                price: lPrice,
                triggerPrice: tPrice
            };
            await dhanBrokerService.placeForeverOrder(req);
            toast.success('Forever Order (GTT) Placed!');
            setTriggerPrice('');
            setPrice('');
            fetchOrders();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(`GTT Failed: ${message}`);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="group relative overflow-hidden rounded-2xl border border-indigo-500/20 bg-slate-900 p-6 shadow-xl">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-purple-500/5" />

            <div className="relative z-10 mb-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-indigo-500/20 p-2.5 text-indigo-400">
                        <Target size={20} />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white">Forever Orders (GTT)</h3>
                        <p className="text-xs text-slate-400">Trigger trades automatically when price hits target.</p>
                    </div>
                </div>
                <button onClick={fetchOrders} className="rounded-lg bg-slate-800 p-2 text-slate-400 hover:text-white" title="Refresh GTTs">
                    <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                </button>
            </div>

            <div className="relative z-10 grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                    <h4 className="flex items-center gap-2 text-sm font-bold text-slate-300">
                        <Plus size={16} className="text-indigo-400" /> New Forever Order
                    </h4>

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
                            <label className="mb-1 block text-xs text-slate-500">Trigger Price</label>
                            <input type="number" step="0.05" value={triggerPrice} onChange={e => setTriggerPrice(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 font-mono text-sm text-white" />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs text-slate-500">Limit Price</label>
                            <input type="number" step="0.05" value={price} onChange={e => setPrice(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 font-mono text-sm text-white" />
                        </div>
                    </div>

                    <button
                        onClick={handleCreate}
                        disabled={isLoading || !triggerPrice || !price || !dhanBrokerService.isConfigured()}
                        className="mt-2 w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white shadow-[0_0_15px_-3px_rgba(79,70,229,0.4)] transition-all hover:bg-indigo-500 disabled:opacity-50"
                    >
                        Place Forever Order
                    </button>

                    {!dhanBrokerService.isConfigured() && (
                        <p className="mt-2 flex items-center gap-1 text-xs text-rose-400">
                            <AlertCircle size={12} /> DhanHQ not configured
                        </p>
                    )}
                </div>

                <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                    <h4 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-300">
                        <Activity size={16} className="text-emerald-400" /> Active GTTs ({orders.length})
                    </h4>

                    <div className="custom-scrollbar max-h-[220px] flex-1 space-y-2 overflow-y-auto pr-2">
                        {orders.length === 0 ? (
                            <div className="py-6 text-center text-sm text-slate-500">
                                <Target size={24} className="mx-auto mb-2 opacity-20" />
                                No active forever orders
                            </div>
                        ) : (
                            orders.map((o: any, idx) => (
                                <div key={idx} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 p-3">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${o.transactionType === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                                {o.transactionType}
                                            </span>
                                            <span className="text-sm font-bold text-white">{o.tradingSymbol}</span>
                                        </div>
                                        <div className="mt-1 text-xs text-slate-400">
                                            Qty: <span className="text-slate-300">{o.quantity}</span> | Limit: <span className="text-slate-300">INR {o.price}</span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">Trigger</div>
                                        <div className="font-mono text-sm font-bold text-indigo-400">INR {o.triggerPrice}</div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GTTManager;
