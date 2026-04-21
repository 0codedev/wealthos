import React, { useState } from 'react';
import { CorrelationMatrix } from '../../types';

interface CorrelationHeatmapProps {
  correlation: CorrelationMatrix;
}

export const CorrelationHeatmap: React.FC<CorrelationHeatmapProps> = ({ correlation }) => {
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);

  if (correlation.tickers.length < 2) {
    return (
      <div className="text-sm text-slate-500 text-center py-10 bg-slate-900/20 border border-slate-800 rounded-2xl">
        Need at least 2 equity/ETF holdings with historical data to compute correlation.
      </div>
    );
  }

  // Get cell color based on correlation coefficient value
  const getCellColor = (r: number) => {
    if (r === 1) return 'bg-slate-900/70 border-slate-850 text-slate-500';
    if (r >= 0.85) return 'bg-rose-500/25 border-rose-500/30 text-rose-300 font-bold';
    if (r >= 0.6) return 'bg-orange-500/20 border-orange-500/20 text-orange-300';
    if (r >= 0.3) return 'bg-slate-800 border-slate-700 text-slate-300';
    if (r >= 0.0) return 'bg-slate-800/40 border-slate-800/50 text-slate-400';
    if (r >= -0.3) return 'bg-emerald-500/10 border-emerald-500/15 text-emerald-400';
    return 'bg-emerald-500/25 border-emerald-500/30 text-emerald-300 font-bold';
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950 p-4">
        <table className="text-[10px] font-mono border-separate border-spacing-1.5 w-full max-w-full">
          <thead>
            <tr>
              <th className="w-16"></th>
              {correlation.tickers.map((t, idx) => (
                <th 
                  key={t} 
                  className={`p-1.5 text-center text-slate-500 font-bold tracking-wider uppercase truncate max-w-[80px] transition-colors ${
                    hoveredCell?.col === idx ? 'text-indigo-400' : ''
                  }`}
                  title={t}
                >
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {correlation.tickers.map((row, i) => (
              <tr key={row}>
                <th 
                  className={`p-1.5 text-slate-500 font-bold text-right tracking-wider uppercase truncate max-w-[80px] transition-colors ${
                    hoveredCell?.row === i ? 'text-indigo-400' : ''
                  }`}
                  title={row}
                >
                  {row}
                </th>
                {correlation.tickers.map((col, j) => {
                  const val = correlation.matrix[i][j];
                  const isHovered = hoveredCell && (hoveredCell.row === i || hoveredCell.col === j);
                  const isDirect = hoveredCell && hoveredCell.row === i && hoveredCell.col === j;

                  return (
                    <td
                      key={col}
                      onMouseEnter={() => setHoveredCell({ row: i, col: j })}
                      onMouseLeave={() => setHoveredCell(null)}
                      className={`p-2.5 text-center rounded border transition-all duration-150 cursor-pointer ${getCellColor(val)} ${
                        isDirect 
                          ? 'ring-2 ring-indigo-500 scale-[1.04] z-10' 
                          : isHovered 
                            ? 'opacity-90 border-slate-600' 
                            : ''
                      }`}
                      title={`${row} ↔ ${col}: ${val.toFixed(2)}`}
                    >
                      {val.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Interactive Tooltip Helper */}
      {hoveredCell && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs flex justify-between items-center transition-all animate-in fade-in duration-200">
          <div>
            <span className="text-slate-500">Correlation Pair:</span>{' '}
            <strong className="text-slate-200">{correlation.tickers[hoveredCell.row]}</strong>
            {' ↔ '}
            <strong className="text-slate-200">{correlation.tickers[hoveredCell.col]}</strong>
          </div>
          <div className="font-mono text-sm">
            Coefficient:{' '}
            <span className={`font-black ${
              correlation.matrix[hoveredCell.row][hoveredCell.col] >= 0.85
                ? 'text-rose-400'
                : correlation.matrix[hoveredCell.row][hoveredCell.col] <= -0.3
                  ? 'text-emerald-400'
                  : 'text-indigo-400'
            }`}>
              {correlation.matrix[hoveredCell.row][hoveredCell.col].toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
export default CorrelationHeatmap;
