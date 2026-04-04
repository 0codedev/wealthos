import React, { useState } from 'react';
import { vcpScannerService, VCPCandidate } from '../../services/scanners/VCPScannerService';
import { ShieldCheck, Flame, Zap, ArrowUpRight, Filter, ChevronRight, Activity, TrendingUp, Sparkles, AlertCircle, Loader2 } from 'lucide-react';
import { openAlgoClientService } from '../../services/OpenAlgoClientService';
import { useToast } from '../shared/ToastProvider';

export const SlowAccumulatorRadar: React.FC = () => {
  const { toast } = useToast();
  const [candidates] = useState<VCPCandidate[]>(() => vcpScannerService.getVCPCandidates());
  const [filterMode, setFilterMode] = useState<'ALL' | 'QUALIFIED_ONLY'>('QUALIFIED_ONLY');
  const [selectedCandidate, setSelectedCandidate] = useState<VCPCandidate | null>(null);
  const [punchingSymbol, setPunchingSymbol] = useState<string | null>(null);

  const displayedList = candidates.filter(c => {
    if (filterMode === 'QUALIFIED_ONLY') return c.isQualified;
    return true;
  });

  const handlePunchVCP = async (e: React.MouseEvent, item: VCPCandidate) => {
    e.stopPropagation();
    setPunchingSymbol(item.symbol);
    try {
      const trail = vcpScannerService.computeCircuitTrailingStop(
        item.currentPrice,
        item.ema20,
        item.upperCircuitBandPct
      );

      const targetAllocation = 50000;
      const quantity = Math.max(1, Math.floor(targetAllocation / item.currentPrice));

      const res = await openAlgoClientService.placeOrder({
        symbol: item.symbol,
        action: 'BUY',
        exchange: 'NSE',
        product: 'CNC',
        pricetype: 'LIMIT',
        quantity,
        price: item.pivotPrice,
        strategy: 'WealthOS_VCP_Cash_SANDBOX',
        reasoning: `Minervini VCP Pivot ₹${item.pivotPrice} with 20 EMA Trailing Stop @ ₹${trail.recommendedTrail}`
      });

      if (res.status === 'success') {
        toast.success(`⚡ VCP ORDER PUNCHED: BUY ${quantity} ${item.symbol} @ ₹${item.pivotPrice.toFixed(1)} [OpenAlgo #${res.orderid}]`);
      } else {
        toast.error(`⚠️ Order Rejected: ${res.message || 'Check OpenAlgo connection'}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`❌ VCP Punch Failed: ${msg}`);
    } finally {
      setPunchingSymbol(null);
    }
  };

  return (
    <div className="w-full bg-slate-900/90 rounded-2xl border border-slate-800 shadow-xl overflow-hidden backdrop-blur-xl">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-slate-950/60">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <TrendingUp size={20} />
          </div>
          <div>
            <h3 className="text-base font-black text-white tracking-wide flex items-center gap-2">
              SLOW ACCUMULATOR: CASH VCP & CATALYST RADAR
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-emerald-950 border border-emerald-700/50 text-emerald-300 font-bold">
                DOMAIN 04
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Minervini 3-5 Day Tight Bases • 50-70% Volume Dry-Up • Upper Circuit Rider Protocol
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl bg-slate-900 border border-slate-800 p-0.5">
            <button
              onClick={() => setFilterMode('QUALIFIED_ONLY')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                filterMode === 'QUALIFIED_ONLY'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Qualified Only ({candidates.filter(c => c.isQualified).length})
            </button>
            <button
              onClick={() => setFilterMode('ALL')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                filterMode === 'ALL'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              All Equities ({candidates.length})
            </button>
          </div>
        </div>
      </div>

      {/* Grid of VCP Cards */}
      <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayedList.map(item => {
          const trailingInfo = vcpScannerService.computeCircuitTrailingStop(
            item.currentPrice,
            item.ema20,
            item.upperCircuitBandPct
          );

          return (
            <div
              key={item.symbol}
              onClick={() => setSelectedCandidate(item)}
              className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                item.isQualified
                  ? 'bg-slate-950/60 border-slate-800 hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-500/10'
                  : 'bg-slate-950/30 border-slate-800/60 opacity-60'
              }`}
            >
              <div>
                {/* Top row: Symbol & Score */}
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-white">{item.symbol}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        RS {item.rsRating}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 block line-clamp-1">{item.name}</span>
                  </div>

                  <span className={`text-[10px] font-mono font-black px-2 py-0.5 rounded-full border ${
                    item.score >= 90
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  }`}>
                    SCORE {item.score}
                  </span>
                </div>

                {/* Price & Pivot */}
                <div className="mt-3 flex items-center justify-between text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-slate-500 block uppercase">Price</span>
                    <span className="font-bold text-white">₹{item.currentPrice.toFixed(1)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block uppercase">Pivot Trigger</span>
                    <span className="font-bold text-emerald-400">₹{item.pivotPrice.toFixed(1)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block uppercase">20 EMA Trail</span>
                    <span className="font-bold text-indigo-300">₹{item.ema20.toFixed(1)}</span>
                  </div>
                </div>

                {/* VCP Metrics */}
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-mono p-2 rounded-lg bg-slate-900 border border-slate-800/80">
                  <div>
                    <span className="text-slate-500 text-[9px] block uppercase">Base Tightness</span>
                    <span className={`font-bold ${item.rangeTightnessPct <= 2.0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {item.rangeTightnessPct.toFixed(2)}% {item.rangeTightnessPct <= 2.0 ? '✓' : '⚠️'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[9px] block uppercase">Vol Dry-Up</span>
                    <span className={`font-bold ${item.volumeDryUpPct >= 50.0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      -{item.volumeDryUpPct.toFixed(1)}% {item.volumeDryUpPct >= 50.0 ? '✓' : '⚠️'}
                    </span>
                  </div>
                </div>

                {/* Catalyst Tag */}
                <div className="mt-3">
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/40 font-bold uppercase inline-block">
                    ⚡ {item.catalystTag.replace('_', ' ')}
                  </span>
                  <p className="mt-1 text-[11px] text-slate-400 line-clamp-2">
                    {item.catalystDescription}
                  </p>
                </div>
              </div>

              {/* Upper Circuit Rider Strip */}
              <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-400">
                <span>Circuit Band: <strong className="text-white">+{item.upperCircuitBandPct}%</strong></span>
                <span className="text-emerald-400 font-bold">Trail: ₹{trailingInfo.recommendedTrail}</span>
              </div>

              {/* One-Click OpenAlgo Punch Button */}
              <button
                type="button"
                onClick={(e) => handlePunchVCP(e, item)}
                disabled={punchingSymbol === item.symbol}
                className="w-full mt-3 py-2 px-3 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold font-mono flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
              >
                {punchingSymbol === item.symbol ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>PUNCHING TO OPENALGO...</span>
                  </>
                ) : (
                  <>
                    <Zap size={13} className="text-emerald-400 fill-current" />
                    <span>PUNCH VCP ORDER (LIMIT @ ₹{item.pivotPrice.toFixed(1)})</span>
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
