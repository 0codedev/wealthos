import React from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { Treemap, Tooltip } from 'recharts';
import { Activity, RefreshCw, BarChart3, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
import { openTradingView } from '../../utils/navigation';
import { SECTOR_CONSTITUENTS } from '../../data/sectorConstituents';
import { Tabs } from '../ui/AnimatedTabs';

// Custom content renderer for Recharts Treemap to render premium, responsive tiles
const CustomTreemapContent = (props: any) => {
  const { x, y, width, height, name, depth, index } = props;
  if (depth === 0 || !name) return null;

  const payload = props.payload || props;
  const change = payload?.change || 0;

  // Dynamic intensity scaling
  const maxExpected = payload?.timeframe === 'day' ? 5 : (payload?.timeframe?.includes('y') ? 100 : 30);
  const intensity = Math.min(100, (Math.abs(change) / maxExpected) * 100);

  // High-end color palette (refined for 0% neutral)
  let bgColor = 'rgba(71, 85, 105, 0.2)';
  if (Math.abs(change) > 0.01) {
    bgColor = change >= 0
      ? `rgba(16, 185, 129, ${0.2 + (intensity / 100) * 0.7})`
      : `rgba(244, 63, 94, ${0.2 + (intensity / 100) * 0.7})`;
  }

  const strokeColor = Math.abs(change) < 0.01
    ? 'rgba(255,255,255,0.1)'
    : (change >= 0 ? 'rgba(52, 211, 153, 0.3)' : 'rgba(251, 113, 133, 0.3)');

  // Truncation helper (approximate char width)
  const truncate = (str: string, w: number) => {
    const limit = Math.floor(w / 7); // Estimate 7px per char
    return str.length > limit ? str.substring(0, limit - 1) + '..' : str;
  };

  const clipId = `clip-${index}-${name.replace(/\s+/g, '-')}`;

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={x + 4} y={y + 4} width={Math.max(0, width - 8)} height={Math.max(0, height - 8)} rx={8} />
        </clipPath>
      </defs>
      <rect
        x={x + 1}
        y={y + 1}
        width={Math.max(0, width - 2)}
        height={Math.max(0, height - 2)}
        style={{
          fill: bgColor,
          stroke: strokeColor,
          strokeWidth: 1,
          rx: 12,
          ry: 12,
          cursor: 'pointer',
        }}
        className="transition-all duration-500 hover:brightness-110"
      />
      {width > 35 && height > 25 && (
        <text
          x={x + width / 2}
          y={y + height / 2 - (height > 60 ? 10 : 7)}
          textAnchor="middle"
          fill="#ffffff"
          fontSize={width > 120 ? 10 : (width > 80 ? 9 : 8)}
          fontWeight="400"
          fontFamily="Inter, system-ui, sans-serif"
          clipPath={`url(#${clipId})`}
          style={{ pointerEvents: 'none', letterSpacing: '0.06em', opacity: 0.7 }}
        >
          {truncate(name, width - 10)}
        </text>
      )}
      {width > 35 && height > 45 && (
        <text
          x={x + width / 2}
          y={y + height / 2 + (height > 60 ? 14 : 11)}
          textAnchor="middle"
          fill="#ffffff"
          fontSize={width > 120 ? 14 : (width > 80 ? 12 : 10)}
          fontWeight="400"
          fontFamily="Inter, system-ui, sans-serif"
          clipPath={`url(#${clipId})`}
          style={{ pointerEvents: 'none', letterSpacing: '0.04em' }}
        >
          {change > 0 ? '+' : ''}{change.toFixed(2)}%
        </text>
      )}
    </g>
  );
};

interface HeatmapMatrixPanelProps {
  activeDrillSector: string | null;
  setActiveDrillSector: (sector: string | null) => void;
  boosterStocks: any[];
  sectors: any[];
  isFetchingSectors: boolean;
  isFetchingBooster: boolean;
  sectorTimeframe: 'day' | '1m' | '3m' | '6m' | '1y' | '3y' | '5y' | '7y' | '10y';
  setSectorTimeframe: (tf: any) => void;
  fetchSectorAnalysis: () => void;
  isVisible: boolean;
}

export const HeatmapMatrixPanel: React.FC<HeatmapMatrixPanelProps> = ({
  activeDrillSector,
  setActiveDrillSector,
  boosterStocks,
  sectors,
  isFetchingSectors,
  isFetchingBooster,
  sectorTimeframe,
  setSectorTimeframe,
  fetchSectorAnalysis,
  isVisible,
}) => {
  const timeframes = [
    { id: 'day', label: 'Day' },
    { id: '1m', label: '1M' },
    { id: '3m', label: '3M' },
    { id: '6m', label: '6M' },
    { id: '1y', label: '1Y' },
    { id: '3y', label: '3Y' },
    { id: '5y', label: '5Y' },
    { id: '7y', label: '7Y' },
    { id: '10y', label: '10Y' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-6 relative overflow-hidden backdrop-blur-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            {activeDrillSector ? (
              <button
                onClick={() => setActiveDrillSector(null)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-bold text-slate-200 transition-colors"
              >
                <span className="text-lg leading-none">←</span> Back
              </button>
            ) : (
              <Activity className="w-4 h-4 text-emerald-400" />
            )}
            <h3 className="text-sm font-bold text-white tracking-tight">
              {activeDrillSector ? `${activeDrillSector} Booster` : 'Institutional Sector Matrix'}
            </h3>
            {(isFetchingSectors || isFetchingBooster) && <RefreshCw className="w-3 h-3 text-indigo-400 animate-spin ml-2" />}
          </div>

          {!activeDrillSector && (
            <Tabs.Root
              value={sectorTimeframe}
              onChange={(val) => setSectorTimeframe(val as any)}
              variant="solid-indigo"
              layoutId="heatmap-timeframe-selector"
              motionPreset="spring"
              className="self-start"
            >
              <Tabs.List className="bg-slate-950/60 p-1 rounded-xl border border-slate-800/50">
                {timeframes.map((tf) => (
                  <Tabs.Trigger
                    key={tf.id}
                    value={tf.id}
                    className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest"
                  >
                    {tf.label}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </Tabs.Root>
          )}
        </div>

        {sectors.length === 0 && !isFetchingSectors ? (
          <div className="min-h-[200px] flex flex-col items-center justify-center text-center">
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-4">No Sector Data Available</p>
            <button
              onClick={() => fetchSectorAnalysis()}
              className="px-4 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-[10px] font-bold text-indigo-400 hover:bg-indigo-500/20 transition-all"
            >
              Sync Sector Analysis
            </button>
          </div>
        ) : (
          <div className="w-full h-[400px]">
            <SafeChartContainer>
              <Treemap
                data={activeDrillSector 
                  ? boosterStocks 
                  : sectors.map(s => ({
                      ...s,
                      marketCap: s.marketCap && s.marketCap > 100 
                        ? s.marketCap 
                        : ((SECTOR_CONSTITUENTS[s.name.toUpperCase()]?.length || 5) * 10000)
                    }))
                }
                dataKey="marketCap"
                stroke="#fff"
                fill="#8884d8"
                content={<CustomTreemapContent />}
                animationDuration={800}
                animationEasing="ease-out"
                isAnimationActive={isVisible}
                onClick={(node: any) => {
                  if (activeDrillSector && node && node.name) {
                    openTradingView(node.name);
                  } else if (!activeDrillSector && node && node.name) {
                    setActiveDrillSector(node.name);
                  }
                }}
              >
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-slate-900/90 border border-slate-700 p-3 rounded-xl shadow-xl backdrop-blur-sm z-50">
                          <p className="text-white font-bold text-xs">{data.name}</p>
                          <p className="text-slate-400 text-[10px]">
                            {activeDrillSector ? `Volume: ${(data.marketCap / 100000).toFixed(2)}L` : `Market Cap: ₹${(data.marketCap / 100000).toFixed(2)}L Cr`}
                          </p>
                          <p className={`text-sm font-mono font-bold mt-1 ${data.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {data.change >= 0 ? '+' : ''}{data.change.toFixed(2)}%
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </Treemap>
            </SafeChartContainer>
          </div>
        )}
      </div>

      <div className="bg-slate-900/10 border border-slate-800/50 rounded-2xl p-6 relative overflow-hidden">
        <div className="flex items-center gap-3 mb-6">
          <BarChart3 className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-bold text-white tracking-tight">
            {activeDrillSector ? 'Stock Relative Strength' : 'Sector Relative Strength'}
          </h3>
        </div>
        <div className="space-y-3 max-h-[500px] overflow-y-auto no-scrollbar">
          {(activeDrillSector ? boosterStocks : sectors).map((item) => (
            <div
              key={item.name}
              className={`flex items-center group/sector ${activeDrillSector ? 'cursor-pointer hover:bg-indigo-500/5 rounded-lg' : ''} transition-all duration-300 px-2 -mx-2 py-1`}
              onClick={() => activeDrillSector && openTradingView(item.name)}
            >
              <div className="w-32 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right pr-6 truncate flex items-center justify-end gap-1.5" title={item.name}>
                {item.name}
                {activeDrillSector && (
                  <ExternalLink size={10} className="text-indigo-400 opacity-0 group-hover/sector:opacity-100 transition-all duration-300 transform group-hover/sector:translate-x-0.5" />
                )}
              </div>
              <div className="flex-1 h-3 bg-slate-950/80 rounded-full overflow-hidden flex relative border border-slate-800/30">
                <div className={`absolute ${item.change > 0 ? 'left-1/2' : 'right-1/2'} h-full ${item.change > 0 ? 'bg-indigo-500' : 'bg-rose-500'} rounded-full`} style={{ width: `${Math.min(100, Math.abs(item.change) * 20)}%` }} />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-800/50 z-10" />
              </div>
              <div className="w-20 text-[10px] font-bold text-slate-500 pl-6 group-hover/sector:text-indigo-400 transition-colors">{(item.change > 0 ? '+' : '') + item.change.toFixed(2)}%</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default HeatmapMatrixPanel;
