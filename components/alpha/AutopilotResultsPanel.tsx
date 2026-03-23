import React, { useEffect, useState } from 'react';
import { BarChart3, TrendingUp, TrendingDown, RefreshCw, HelpCircle, ExternalLink, Edit, Trash2, X } from 'lucide-react';
import { AutopilotResult } from '../../hooks/alpha/useAutopilot';
import { openTradingView } from '../../utils/navigation';

interface AutopilotResultsPanelProps {
  results: AutopilotResult[];
  loading: boolean;
  fetchResults: () => void;
}

export const AutopilotResultsPanel: React.FC<AutopilotResultsPanelProps> = ({
  results,
  loading,
  fetchResults
}) => {
  const [editingTrade, setEditingTrade] = useState<AutopilotResult | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editStrategy, setEditStrategy] = useState('');
  const [editSymbol, setEditSymbol] = useState('');
  const [editDirection, setEditDirection] = useState('BUY');
  const [editEntryTime, setEditEntryTime] = useState('');
  const [editEntryPrice, setEditEntryPrice] = useState(0);
  const [editExitTime, setEditExitTime] = useState('');
  const [editExitPrice, setEditExitPrice] = useState(0);
  const [editQuantity, setEditQuantity] = useState(0);
  const [editPnl, setEditPnl] = useState(0);
  const [editPnlPct, setEditPnlPct] = useState(0);
  const [editStatus, setEditStatus] = useState('CLOSED');

  useEffect(() => {
    fetchResults();
  }, []);

  const startEditing = (t: AutopilotResult) => {
    setEditingTrade(t);
    setEditDate(t.date || '');
    setEditStrategy(t.strategy || '');
    setEditSymbol(t.symbol || '');
    setEditDirection(t.direction || 'BUY');
    setEditEntryTime(t.entry_time || '');
    setEditEntryPrice(t.entry_price || 0);
    setEditExitTime(t.exit_time || '');
    setEditExitPrice(t.exit_price || 0);
    setEditQuantity(t.quantity || 0);
    setEditPnl(t.pnl || 0);
    setEditPnlPct(t.pnl_pct || 0);
    setEditStatus(t.status || 'CLOSED');
  };

  const handleSaveEdit = async () => {
    if (!editingTrade) return;
    try {
      const resp = await fetch(`/api/python-nse/api/autopilot/results/${editingTrade.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: editDate,
          strategy: editStrategy,
          symbol: editSymbol,
          direction: editDirection,
          entry_time: editEntryTime,
          entry_price: Number(editEntryPrice),
          exit_time: editExitTime,
          exit_price: Number(editExitPrice),
          quantity: Number(editQuantity),
          pnl: Number(editPnl),
          pnl_pct: Number(editPnlPct),
          status: editStatus
        })
      });
      if (resp.ok) {
        setEditingTrade(null);
        fetchResults();
      } else {
        alert('Failed to save changes');
      }
    } catch (err) {
      console.error(err);
      alert('Error saving changes');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this sandbox trade log?')) return;
    try {
      const resp = await fetch(`/api/python-nse/api/autopilot/results/${id}`, {
        method: 'DELETE'
      });
      if (resp.ok) {
        fetchResults();
      } else {
        alert('Failed to delete trade log');
      }
    } catch (err) {
      console.error(err);
      alert('Error deleting trade log');
    }
  };

  // Compute stats from results
  const totalTrades = results.length;
  const closedTrades = results.filter(r => r.status === 'CLOSED');
  const totalClosed = closedTrades.length;
  const winningTrades = closedTrades.filter(r => (r.pnl || 0) > 0);
  const totalWins = winningTrades.length;
  const winRate = totalClosed > 0 ? (totalWins / totalClosed) * 100 : 0;
  
  const netPnl = closedTrades.reduce((acc, curr) => acc + (curr.pnl || 0), 0);
  
  const grossWins = closedTrades.reduce((acc, curr) => curr.pnl && curr.pnl > 0 ? acc + curr.pnl : acc, 0);
  const grossLosses = Math.abs(closedTrades.reduce((acc, curr) => curr.pnl && curr.pnl < 0 ? acc + curr.pnl : acc, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 99.9 : 0;

  // Maximum Drawdown estimation
  let maxDrawdown = 0;
  let runningPeak = 0;
  let runningEquity = 0;
  
  // Walk through trades chronologically (oldest first)
  [...closedTrades].reverse().forEach(t => {
    runningEquity += t.pnl || 0;
    if (runningEquity > runningPeak) {
      runningPeak = runningEquity;
    }
    const dd = runningPeak - runningEquity;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
    }
  });

  return (
    <div className="space-y-6">
      
      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        
        {/* Total Trades Card */}
        <div className="bg-[#13151a] border border-[#232733] rounded-xl p-4 flex flex-col justify-between">
          <span className="text-gray-400 text-xs font-semibold">Total Trades</span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-black text-white">{totalTrades}</span>
            <span className="text-gray-500 text-xs">({totalClosed} closed)</span>
          </div>
        </div>

        {/* Win Rate Card */}
        <div className="bg-[#13151a] border border-[#232733] rounded-xl p-4 flex flex-col justify-between">
          <span className="text-gray-400 text-xs font-semibold">Win Rate</span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-black text-white">{winRate.toFixed(1)}%</span>
            <span className="text-emerald-500 text-xs">({totalWins} Wins)</span>
          </div>
        </div>

        {/* Net Profit Card */}
        <div className="bg-[#13151a] border border-[#232733] rounded-xl p-4 flex flex-col justify-between">
          <span className="text-gray-400 text-xs font-semibold">Net P&L (Sandbox)</span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className={`text-2xl font-black ${netPnl >= 0 ? 'text-emerald-400' : 'text-red-500'}`}>
              {netPnl >= 0 ? '+' : ''}₹{netPnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Profit Factor Card */}
        <div className="bg-[#13151a] border border-[#232733] rounded-xl p-4 flex flex-col justify-between">
          <span className="text-gray-400 text-xs font-semibold">Profit Factor</span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-black text-white">{profitFactor.toFixed(2)}</span>
            <span className="text-gray-500 text-xs">(Target &gt; 1.5)</span>
          </div>
        </div>

      </div>

      {/* Trade Log Table */}
      <div className="bg-[#13151a] border border-[#232733] rounded-xl overflow-hidden shadow-xl">
        
        {/* Table Header Controls */}
        <div className="px-5 py-4 border-b border-[#232733]/60 flex justify-between items-center bg-[#151821]">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-gray-400" />
            <h3 className="text-sm font-bold text-white tracking-wider">Autopilot Sandbox Logs</h3>
          </div>
          <button
            onClick={fetchResults}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#1d212d] border border-[#2d3345] text-gray-300 hover:bg-[#252b3a] transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Logs
          </button>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          {results.length > 0 ? (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#161a24] text-gray-400 border-b border-[#232733]/60 font-semibold">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Symbol</th>
                  <th className="px-4 py-3">Direction</th>
                  <th className="px-4 py-3">Strategy</th>
                  <th className="px-4 py-3 text-right">Entry Premium</th>
                  <th className="px-4 py-3 text-right">Exit Premium</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">PnL</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Times</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#232733]/30 text-gray-300">
                {results.map((t) => {
                  const pnlVal = t.pnl || 0;
                  const pnlPctVal = t.pnl_pct || 0;
                  return (
                    <tr key={t.id} className="hover:bg-[#181d29]/40 transition group">
                      <td className="px-4 py-3 font-medium text-white">{t.date}</td>
                      <td className="px-4 py-3 font-bold text-white">
                        <button
                          onClick={() => openTradingView(t.symbol)}
                          className="hover:text-indigo-400 transition-colors flex items-center gap-1 text-left font-bold"
                          title="Open chart in TradingView"
                        >
                          {t.symbol}
                          <ExternalLink size={12} className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-500" />
                        </button>
                        <span className="text-[10px] text-gray-500 font-normal block mt-0.5">{t.order_id}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          t.direction === 'BUY' 
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                          {t.direction === 'BUY' ? 'LONG' : 'SHORT'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {t.strategy}
                        <div className="text-[10px] text-gray-500">Score: {t.signal_score}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">₹{t.entry_price.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-medium">
                        {t.exit_price ? `₹${t.exit_price.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-white">{t.quantity}</td>
                      <td className="px-4 py-3 text-right font-bold">
                        {t.status === 'CLOSED' ? (
                          <span className={pnlVal >= 0 ? 'text-emerald-400' : 'text-red-500'}>
                            {pnlVal >= 0 ? '+' : ''}₹{pnlVal.toFixed(2)} ({pnlPctVal >= 0 ? '+' : ''}{pnlPctVal.toFixed(2)}%)
                          </span>
                        ) : (
                          <span className="text-gray-500">OPEN</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          t.status === 'CLOSED' 
                            ? 'bg-gray-800 text-gray-400' 
                            : t.status === 'OPEN'
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                              : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[10px] text-gray-500">
                        <div>In: {t.entry_time.split(' ')[1]}</div>
                        {t.exit_time && <div>Out: {t.exit_time.split(' ')[1]}</div>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex justify-center items-center gap-2">
                          <button
                            onClick={() => startEditing(t)}
                            className="p-1 text-gray-400 hover:text-indigo-400 transition"
                            title="Edit trade log"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(t.id)}
                            className="p-1 text-gray-400 hover:text-red-500 transition"
                            title="Delete trade log"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-8 text-gray-500 flex flex-col items-center justify-center space-y-2">
              <HelpCircle className="w-8 h-8 text-[#2d3345]" />
              <p className="text-xs">No autopilot trades executed yet.</p>
            </div>
          )}
        </div>

      </div>

      {editingTrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#12141c] border border-[#232733] rounded-xl w-full max-w-lg overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#232733]/60 bg-[#161922] flex justify-between items-center">
              <h3 className="text-sm font-bold text-white tracking-wider text-xs">EDIT SANDBOX TRADE LOG</h3>
              <button onClick={() => setEditingTrade(null)} className="text-gray-400 hover:text-white transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Symbol</label>
                  <input
                    type="text"
                    value={editSymbol}
                    onChange={(e) => setEditSymbol(e.target.value)}
                    className="w-full bg-[#1b1f2e] border border-[#2d3345] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Strategy</label>
                  <input
                    type="text"
                    value={editStrategy}
                    onChange={(e) => setEditStrategy(e.target.value)}
                    className="w-full bg-[#1b1f2e] border border-[#2d3345] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Direction</label>
                  <select
                    value={editDirection}
                    onChange={(e) => setEditDirection(e.target.value)}
                    className="w-full bg-[#1b1f2e] border border-[#2d3345] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Quantity</label>
                  <input
                    type="number"
                    value={editQuantity}
                    onChange={(e) => setEditQuantity(Number(e.target.value))}
                    className="w-full bg-[#1b1f2e] border border-[#2d3345] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    className="w-full bg-[#1b1f2e] border border-[#2d3345] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="OPEN">OPEN</option>
                    <option value="CLOSED">CLOSED</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Entry Price</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editEntryPrice}
                    onChange={(e) => setEditEntryPrice(Number(e.target.value))}
                    className="w-full bg-[#1b1f2e] border border-[#2d3345] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Exit Price</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editExitPrice}
                    onChange={(e) => setEditExitPrice(Number(e.target.value))}
                    className="w-full bg-[#1b1f2e] border border-[#2d3345] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">PnL (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editPnl}
                    onChange={(e) => setEditPnl(Number(e.target.value))}
                    className="w-full bg-[#1b1f2e] border border-[#2d3345] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">PnL %</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editPnlPct}
                    onChange={(e) => setEditPnlPct(Number(e.target.value))}
                    className="w-full bg-[#1b1f2e] border border-[#2d3345] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Date</label>
                  <input
                    type="text"
                    placeholder="YYYY-MM-DD"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full bg-[#1b1f2e] border border-[#2d3345] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Entry Time</label>
                  <input
                    type="text"
                    value={editEntryTime}
                    onChange={(e) => setEditEntryTime(e.target.value)}
                    className="w-full bg-[#1b1f2e] border border-[#2d3345] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Exit Time</label>
                  <input
                    type="text"
                    value={editExitTime}
                    onChange={(e) => setEditExitTime(e.target.value)}
                    className="w-full bg-[#1b1f2e] border border-[#2d3345] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-[#232733]/60 bg-[#161922] flex justify-end gap-3">
              <button
                onClick={() => setEditingTrade(null)}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-[#1d212d] border border-[#2d3345] text-gray-300 hover:bg-[#252b3a] transition"
              >
                CANCEL
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 transition"
              >
                SAVE
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
