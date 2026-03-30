import React, { useState, useEffect } from 'react';
import { db } from '../../../database';
import { HelpCircle, Layers, TrendingUp } from 'lucide-react';

interface IVSurfaceChartProps {
  underlying: string;
}

export const IVSurfaceChart: React.FC<IVSurfaceChartProps> = ({ underlying }) => {
  const [expiries, setExpiries] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [surfaceData, setSurfaceData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [hoveredCell, setHoveredCell] = useState<{ strike: number; dte: string; iv: number } | null>(null);

  // 1. Fetch available expiries from Local IndexedDB Vault
  useEffect(() => {
    const fetchExpiries = async () => {
      try {
        const symbolUpper = underlying.toUpperCase().trim();
        const records = await db.historical_data
          .where('date')
          .aboveOrEqual('1970-01-01')
          .and(p => p.assetClass === 'Options' && p.symbol.toUpperCase().startsWith(symbolUpper))
          .toArray();

        const uniqueExpiries = Array.from(new Set(records.map(r => r.expiry).filter(Boolean))) as string[];
        uniqueExpiries.sort();
        setExpiries(uniqueExpiries);

        if (uniqueExpiries.length > 0) {
          setSelectedExpiry(uniqueExpiries[0]);
        } else {
          setError('No synced options contracts found in vault. Please sync options data first.');
        }
      } catch (err: unknown) {
        console.error('Error fetching expiries:', err);
        setError('Failed to load expiries from vault.');
      }
    };
    fetchExpiries();
  }, [underlying]);

  // 2. Fetch IV Surface from backend when selected expiry changes
  useEffect(() => {
    if (!selectedExpiry) return;

    const fetchSurface = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(
          `/api/python-nse/api/backtest/iv-surface?underlying=${encodeURIComponent(
            underlying
          )}&expiry=${encodeURIComponent(selectedExpiry)}`
        );
        if (!response.ok) {
          throw new Error('Failed to load IV surface from server.');
        }
        const data = await response.json();
        setSurfaceData(data);
      } catch (err: unknown) {
        console.error(err);
        const message = err instanceof Error ? err.message : String(err);
        setError(message || 'Failed to fetch IV surface data.');
      } finally {
        setLoading(false);
      }
    };

    fetchSurface();
  }, [underlying, selectedExpiry]);

  // Calculate HSL color for a given IV value
  // Low IV (slate/blue) -> High IV (red/orange)
  const getIVColorStyle = (iv: number) => {
    // Standard IV range: 10% (0.10) to 40% (0.40)
    const minIV = 0.10;
    const maxIV = 0.40;
    const ratio = Math.min(1, Math.max(0, (iv - minIV) / (maxIV - minIV)));

    // Interpolate hue from 240 (blue) to 0 (red)
    const hue = 240 - ratio * 240;
    const opacity = 0.15 + ratio * 0.5; // brighter for higher IV
    
    return {
      backgroundColor: `hsla(${hue}, 80%, 50%, ${opacity})`,
      border: `1px solid hsla(${hue}, 85%, 55%, ${opacity + 0.1})`,
      boxShadow: ratio > 0.7 ? `0 0 10px hsla(${hue}, 80%, 50%, 0.3)` : 'none'
    };
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-slate-900/40 rounded-3xl border border-slate-800/60 min-h-[400px]">
        <HelpCircle size={48} className="text-slate-600 mb-4 animate-bounce" />
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest text-center">{error}</p>
      </div>
    );
  }

  if (loading || !surfaceData) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-slate-900/40 rounded-3xl border border-slate-800/60 min-h-[400px]">
        <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-4" />
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] animate-pulse">
          Generating Volatility Surface Matrix...
        </p>
      </div>
    );
  }

  const { strikes, dtes, surface } = surfaceData;

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-950/40 p-6 rounded-2xl border border-slate-800/50">
        <div>
          <h4 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2">
            <Layers size={14} className="text-indigo-400" />
            Implied Volatility (IV) Surface Grid
          </h4>
          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">
            Replays 2D volatility smile across strikes and days to expiry (DTE)
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Expiry Cycle</label>
          <select
            value={selectedExpiry}
            onChange={(e) => setSelectedExpiry(e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 transition-colors"
          >
            {expiries.map(exp => (
              <option key={exp} value={exp}>
                {new Date(exp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Surface Matrix Card */}
      <div className="relative bg-slate-900/40 border border-slate-800/60 rounded-3xl p-6 md:p-8 overflow-hidden">
        {/* Color spectrum indicator */}
        <div className="flex items-center justify-end gap-3 mb-6">
          <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Low IV (10%)</span>
          <div className="w-32 h-1.5 rounded-full bg-gradient-to-r from-blue-500 via-purple-500 to-red-500 opacity-60" />
          <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">High IV (40%+)</span>
        </div>

        {/* Matrix Container */}
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {/* Upper left corner label */}
                <th className="p-3 text-[9px] font-black text-slate-500 uppercase tracking-widest text-left min-w-[100px] border-b border-slate-800/60">
                  Strike \ DTE
                </th>
                {dtes.map((dte: string) => (
                  <th
                    key={dte}
                    className="p-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center min-w-[70px] border-b border-slate-800/60"
                  >
                    {dte}d
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {surface.map((row: any) => (
                <tr key={row.strike} className="border-b border-slate-800/20 hover:bg-slate-800/5 transition-colors">
                  <td className="p-3 text-[10px] font-black text-white italic tracking-tighter">
                    {row.strike}
                  </td>
                  {dtes.map((dte: string) => {
                    const iv = row.ivs[dte] || 0.18;
                    const ivPercent = (iv * 100).toFixed(1);
                    return (
                      <td key={dte} className="p-1 text-center">
                        <div
                          style={getIVColorStyle(iv)}
                          onMouseEnter={() => setHoveredCell({ strike: row.strike, dte, iv })}
                          onMouseLeave={() => setHoveredCell(null)}
                          className="h-10 rounded-xl flex items-center justify-center text-[10px] font-black text-white tracking-tighter cursor-pointer hover:scale-105 transition-all"
                        >
                          {ivPercent}%
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Cell Detail Tooltip overlay */}
        {hoveredCell && (
          <div className="absolute bottom-6 left-6 p-4 bg-slate-950/90 border border-indigo-500/20 backdrop-blur-md rounded-2xl shadow-xl flex items-center gap-4 animate-fade-in z-20">
            <div className="p-2 bg-indigo-500/10 rounded-xl">
              <TrendingUp size={16} className="text-indigo-400" />
            </div>
            <div>
              <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">
                Strike {hoveredCell.strike} • {hoveredCell.dte} DTE
              </span>
              <span className="text-sm font-black text-white italic tracking-tighter mt-0.5 block">
                {(hoveredCell.iv * 100).toFixed(2)}% Implied Volatility
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
