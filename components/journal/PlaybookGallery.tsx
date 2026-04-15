
import React, { useState, useMemo, useEffect } from 'react';
import { Trade, SetupGrade, TradeSetup } from '../../database';
import { formatCurrency } from '../../utils/helpers';
import { Filter, Image as ImageIcon, Maximize2, X, Edit2 } from 'lucide-react';

interface PlaybookGalleryProps {
    trades: Trade[];
    onEditTrade?: (trade: Trade) => void;
}

interface TradeCardProps {
    trade: Trade;
    onClick: (trade: Trade) => void;
}

const TradeCard = React.memo(({ trade, onClick }: TradeCardProps) => {
    const [imgUrl, setImgUrl] = useState<string | null>(null);
    const isWin = (trade.pnl || 0) >= 0;

    useEffect(() => {
        if (trade.screenshot instanceof Blob) {
            const url = URL.createObjectURL(trade.screenshot);
            setImgUrl(url);
            return () => URL.revokeObjectURL(url);
        } else if (typeof trade.screenshot === 'string') {
            setImgUrl(trade.screenshot);
        }
    }, [trade.screenshot]);

    return (
        <div
            onClick={() => onClick(trade)}
            className="group relative aspect-square bg-slate-900 rounded-xl overflow-hidden border border-slate-800 hover:border-indigo-500 transition-all cursor-pointer shadow-lg hover:shadow-indigo-500/20"
        >
            {imgUrl ? (
                <img src={imgUrl} alt={trade.ticker} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110 opacity-80 group-hover:opacity-100" />
            ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-slate-700">
                    <ImageIcon size={32} className="mb-2 opacity-50" />
                    <span className="text-xs font-bold uppercase tracking-wider">No Image</span>
                </div>
            )}

            {/* Overlay Gradient */}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-90"></div>

            {/* Top Badge (Grade) */}
            {trade.grade && (
                <div className={`absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-lg text-sm font-black border backdrop-blur-sm shadow-sm
                    ${trade.grade.startsWith('A') ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' :
                        trade.grade === 'B' ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400' :
                            'bg-rose-500/20 border-rose-500/50 text-rose-400'}
                `}>
                    {trade.grade}
                </div>
            )}

            {/* Bottom Info */}
            <div className="absolute bottom-0 left-0 w-full p-4 transform translate-y-2 group-hover:translate-y-0 transition-transform">
                <div className="flex justify-between items-end">
                    <div>
                        <h4 className="text-white font-bold text-lg leading-none mb-1">{trade.ticker}</h4>
                        <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">{trade.setup === 'Dhan Auto-Sync' ? 'DAS' : (trade.setup || 'Unknown')}</p>
                    </div>
                    <div className={`text-right font-mono font-bold ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isWin ? '+' : ''}{formatCurrency(trade.pnl || 0)}
                    </div>
                </div>
            </div>
        </div>
    );
});

interface ModalDetailProps {
    trade: Trade;
    onClose: () => void;
    onEditTrade?: (trade: Trade) => void;
}

const ModalDetail: React.FC<ModalDetailProps> = ({ trade, onClose, onEditTrade }) => {
    const [imgUrl, setImgUrl] = useState<string | null>(null);
    const isWin = (trade.pnl || 0) >= 0;

    useEffect(() => {
        if (trade.screenshot instanceof Blob) {
            const url = URL.createObjectURL(trade.screenshot);
            setImgUrl(url);
            return () => URL.revokeObjectURL(url);
        } else if (typeof trade.screenshot === 'string') {
            setImgUrl(trade.screenshot);
        }
    }, [trade.screenshot]);

    return (
        <div role="dialog" aria-modal="true" aria-labelledby="playbook-gallery-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-150">
            <div className="w-full max-w-5xl h-[85vh] bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col md:flex-row relative">
                <div className="absolute top-4 right-4 z-10 flex gap-2">
                    {onEditTrade && (
                        <button
                            onClick={() => onEditTrade(trade)}
                            className="p-2 bg-black/50 text-white rounded-full hover:bg-indigo-600 transition-colors"
                            title="Edit Trade"
                        >
                            <Edit2 size={20} />
                        </button>
                    )}
                    <button onClick={onClose} className="p-2 bg-black/50 text-white rounded-full hover:bg-rose-600 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Image Side */}
                <div className="flex-1 bg-black flex items-center justify-center overflow-hidden relative group">
                    {imgUrl ? (
                        <img src={imgUrl} alt="Full Chart" className="max-w-full max-h-full object-contain" />
                    ) : (
                        <span className="text-slate-500">No chart image available</span>
                    )}
                </div>

                {/* Details Sidebar */}
                <div className="w-full md:w-80 bg-slate-950 border-l border-slate-800 p-6 flex flex-col gap-6 overflow-y-auto">
                    <div>
                        <h2 className="text-3xl font-black text-white mb-1">{trade.ticker}</h2>
                        <div className="flex items-center gap-2 mb-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${trade.direction === 'Long' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-rose-900/30 text-rose-400'}`}>{trade.direction}</span>
                            <span className="text-slate-500 text-xs">{trade.date}</span>
                        </div>
                        <div className={`p-4 rounded-xl border ${isWin ? 'bg-emerald-900/10 border-emerald-900/30' : 'bg-rose-900/10 border-rose-900/30'}`}>
                            <p className="text-xs text-slate-400 uppercase font-bold mb-1">Net PnL</p>
                            <p className={`text-2xl font-mono font-bold ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {isWin ? '+' : ''}{formatCurrency(trade.pnl || 0)}
                            </p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <p className="text-xs text-slate-500 uppercase font-bold mb-1">Strategy</p>
                            <div className="flex items-center justify-between">
                                <span className="text-white font-medium">{trade.setup === 'Dhan Auto-Sync' ? 'DAS' : trade.setup}</span>
                                {trade.grade && (
                                    <span className={`text-sm font-black px-2 py-1 rounded bg-slate-800 ${trade.grade.startsWith('A') ? 'text-emerald-400' : 'text-indigo-400'}`}>
                                        Grade {trade.grade}
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <p className="text-xs text-slate-500 uppercase font-bold mb-1">Entry</p>
                                <p className="text-white font-mono">{trade.entryPrice}</p>
                            </div>
                            <div>
                                <p className="text-xs text-slate-500 uppercase font-bold mb-1">Exit</p>
                                <p className="text-white font-mono">{trade.exitPrice}</p>
                            </div>
                        </div>

                        {trade.mistakes && trade.mistakes.length > 0 && (
                            <div>
                                <p className="text-xs text-slate-500 uppercase font-bold mb-2">Mistakes</p>
                                <div className="flex flex-wrap gap-2">
                                    {trade.mistakes.map(m => (
                                        <span key={m} className="px-2 py-1 bg-rose-900/20 text-rose-400 border border-rose-900/30 rounded text-[10px] font-bold uppercase">
                                            {m}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {trade.notes && (
                            <div>
                                <p className="text-xs text-slate-500 uppercase font-bold mb-1">Journal Notes</p>
                                <p className="text-sm text-slate-300 leading-relaxed italic">"{trade.notes}"</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

const PlaybookGallery = React.memo(({ trades, onEditTrade }: PlaybookGalleryProps) => {
    const [filterSetup, setFilterSetup] = useState<TradeSetup | 'ALL'>('ALL');
    const [filterGrade, setFilterGrade] = useState<SetupGrade | 'ALL'>('ALL');
    const [filterOutcome, setFilterOutcome] = useState<'ALL' | 'WIN' | 'LOSS'>('ALL');
    const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);

    // Derive unique setups from actual data or use constant
    const availableSetups = useMemo(() => {
        const setups = new Set<string>(['ALL']);
        trades.forEach(t => {
            if (t.setup) {
                setups.add(t.setup === 'Dhan Auto-Sync' ? 'DAS' : t.setup);
            }
        });
        return Array.from(setups) as (TradeSetup | 'ALL')[];
    }, [trades]);

    const filteredTrades = useMemo(() => {
        return trades.filter(t => {
            if (filterSetup !== 'ALL') {
                const setup = t.setup === 'Dhan Auto-Sync' ? 'DAS' : t.setup;
                if (setup !== filterSetup) return false;
            }
            if (filterGrade !== 'ALL' && t.grade !== filterGrade) return false;
            if (filterOutcome === 'WIN' && (t.pnl || 0) <= 0) return false;
            if (filterOutcome === 'LOSS' && (t.pnl || 0) >= 0) return false;
            // Filter out trades without screenshots/visuals if we strictly want a gallery
            // But maybe we want to show all and placeholders for now.
            return true;
        }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [trades, filterSetup, filterGrade, filterOutcome]);

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">

            {/* Filters Toolbar */}
            <div className="flex flex-wrap gap-3 mb-6 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 items-center">
                <div className="flex items-center gap-2 text-slate-500 text-sm font-bold uppercase tracking-wider mr-2">
                    <Filter size={16} /> Filters:
                </div>

                <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                    {availableSetups.map(s => (
                        <button
                            key={s}
                            onClick={() => setFilterSetup(s)}
                            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${filterSetup === s ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                            {s}
                        </button>
                    ))}
                </div>

                <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                    <button onClick={() => setFilterOutcome('ALL')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${filterOutcome === 'ALL' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}>All</button>
                    <button onClick={() => setFilterOutcome('WIN')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${filterOutcome === 'WIN' ? 'bg-emerald-500/20 text-emerald-500 shadow-sm' : 'text-slate-500 hover:text-emerald-500'}`}>Wins</button>
                    <button onClick={() => setFilterOutcome('LOSS')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${filterOutcome === 'LOSS' ? 'bg-rose-500/20 text-rose-500 shadow-sm' : 'text-slate-500 hover:text-rose-500'}`}>Losses</button>
                </div>

                <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-slate-500 font-bold uppercase">Grade:</span>
                    <select
                        value={filterGrade}
                        onChange={(e) => setFilterGrade(e.target.value as any)}
                        className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold py-1.5 px-3 rounded-lg border-none outline-none cursor-pointer"
                    >
                        <option value="ALL">All Grades</option>
                        <option value="A+">A+ Only</option>
                        <option value="A">A Grade</option>
                        <option value="B">B Grade</option>
                        <option value="C">C Grade</option>
                        <option value="D">D Grade</option>
                    </select>
                </div>
            </div>

            {/* Gallery Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {filteredTrades.map((trade, index) => (
                    <TradeCard key={trade.id || index} trade={trade} onClick={setSelectedTrade} />
                ))}
            </div>

            {filteredTrades.length === 0 && (
                <div className="py-20 text-center border-2 border-dashed border-slate-800 rounded-3xl">
                    <ImageIcon size={48} className="mx-auto text-slate-600 mb-4" />
                    <h3 className="text-slate-400 font-bold text-lg">No Playbook Entries</h3>
                    <p className="text-slate-600 text-sm">Adjust filters or log more trades with screenshots.</p>
                </div>
            )}

            {/* Detail Modal */}
            {selectedTrade && (
                <ModalDetail trade={selectedTrade} onClose={() => setSelectedTrade(null)} onEditTrade={onEditTrade} />
            )}
        </div>
    );
});

export default PlaybookGallery;
