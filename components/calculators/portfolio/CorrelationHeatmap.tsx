import React, { useState, useMemo } from 'react';
import { buildCorrelationMatrix } from '../../../lib/quant/portfolio/correlation';
import { Network, FileJson } from 'lucide-react';

export const CorrelationHeatmap: React.FC = () => {

    const [inputText, setInputText] = useState('');
    const [numAssets, setNumAssets] = useState(0);

    const loadSampleData = () => {
        // columns: Asset A, Asset B, Asset C, Asset D (A and B are highly correlated, C is inverse to A)
        const sample = `
1.2, 1.1, -0.8, 0.5
-0.5, -0.4, 0.6, 0.1
2.1, 1.9, -1.5, 0.3
-1.2, -1.0, 1.2, -0.2
0.8, 0.7, -0.5, 0.8
-0.2, -0.1, 0.2, 0.9
1.5, 1.4, -1.1, -0.4
1.1, 1.2, -0.9, 0.0
-1.8, -1.6, 1.4, 0.2
0.4, 0.3, -0.2, 2.1
        `.trim();
        setInputText(sample);
    };

    const matrixData = useMemo(() => {
        if (!inputText.trim()) return null;
        const lines = inputText.split('\n');
        
        // rows x cols. We want an array of N arrays, where N = columns (assets).
        const colData: number[][] = [];
        let colsCount = 0;

        for (const line of lines) {
            const parts = line.split(/[,\s]+/).filter(x => x).map(Number);
            if (parts.length > 0 && !parts.includes(NaN)) {
                if (colsCount === 0) {
                    colsCount = parts.length;
                    for (let i = 0; i < colsCount; i++) colData.push([]);
                }
                
                if (parts.length === colsCount) {
                    for (let i = 0; i < colsCount; i++) {
                        colData[i].push(parts[i]);
                    }
                }
            }
        }

        if (colsCount < 2 || colData[0].length < 2) return null;
        
        setNumAssets(colsCount);
        const matrix = buildCorrelationMatrix(colData);
        return matrix;
    }, [inputText]);

    // Color mapper from -1 (red) to 0 (whiteish) to 1 (green)
    const getColorForCorr = (corr: number) => {
        if (corr > 0.8) return 'bg-emerald-500 text-white';
        if (corr > 0.4) return 'bg-emerald-500/50 text-emerald-100';
        if (corr > 0) return 'bg-emerald-500/20 text-emerald-200';
        if (corr > -0.4) return 'bg-rose-500/20 text-rose-200';
        if (corr > -0.8) return 'bg-rose-500/50 text-rose-100';
        return 'bg-rose-500 text-white';
    };

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col mt-6">
            <div className="flex justify-between items-start mb-6">
                <div>
                    <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                        <Network size={20} className="text-purple-500" /> N-Asset Correlation Matrix
                    </h2>
                    <p className="text-xs text-slate-400">Paste an N-column block of daily returns to instantly generate the Pearson covariance heatmap and expose hidden regime dependencies.</p>
                </div>
                <button 
                    onClick={loadSampleData}
                    className="flexItems-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded font-bold text-xs"
                >
                    <FileJson size={14} className="inline mr-1" /> Load 4-Asset Sample
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1">
                <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Raw Return Arrays (Comma/Space separated columns)</label>
                    <textarea 
                        value={inputText}
                        onChange={e => setInputText(e.target.value)}
                        placeholder="Asset 1, Asset 2, Asset 3..."
                        className="w-full h-48 lg:h-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-300 font-mono text-sm resize-none focus:outline-none focus:border-purple-500"
                    />
                </div>
                
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center min-h-[300px]">
                    {matrixData ? (
                        <div className="w-full overflow-x-auto">
                            <h3 className="text-xs font-bold text-center text-slate-500 uppercase tracking-widest mb-4">Correlation Core ({numAssets}x{numAssets})</h3>
                            <table className="mx-auto border-collapse">
                                <thead>
                                    <tr>
                                        <th className="p-2 border border-transparent"></th>
                                        {Array.from({length: numAssets}).map((_, i) => (
                                            <th key={i} className="p-2 text-[10px] font-bold text-slate-500">A {i+1}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {matrixData.map((row, i) => (
                                        <tr key={i}>
                                            <th className="p-2 text-[10px] font-bold text-slate-500 whitespace-nowrap">A {i+1}</th>
                                            {row.map((cell, j) => (
                                                <td key={`${i}-${j}`} className="p-0 select-none">
                                                    <div className={`w-12 h-12 flex items-center justify-center text-xs font-mono font-bold m-1 rounded shadow-sm transition-transform hover:scale-110 cursor-crosshair ${getColorForCorr(cell)}`}>
                                                        {cell.toFixed(2)}
                                                    </div>
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="text-slate-500 text-sm italic py-12 text-center max-w-xs">
                            Awaiting minimum 2-column dataset...
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
