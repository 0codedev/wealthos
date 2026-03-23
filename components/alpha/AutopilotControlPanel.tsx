import React, { useState } from 'react';
import { Zap, Play, Square, Activity, AlertTriangle, RefreshCw, Send, ExternalLink, Sliders } from 'lucide-react';
import { AutopilotTrade } from '../../hooks/alpha/useAutopilot';
import { useToast } from '../shared/ToastProvider';
import ConfirmationModal from '../shared/ConfirmationModal';
import { openTradingView } from '../../utils/navigation';
import { AutopilotRuleController } from './AutopilotRuleController';

interface AutopilotControlPanelProps {
  enabled: boolean;
  activeTrade: AutopilotTrade | null;
  hasTelegram: boolean;
  toggleAutopilot: (val: boolean) => void;
  forceClose: () => void;
  fetchStatus: () => void;
  bullishStocks: any[];
  bearishStocks: any[];
  niftyChange: number | null;
  telegramBotToken: string;
  telegramChatId: string;
  syncing?: boolean;
}

export const AutopilotControlPanel: React.FC<AutopilotControlPanelProps> = ({
  enabled,
  activeTrade,
  hasTelegram,
  toggleAutopilot,
  forceClose,
  fetchStatus,
  bullishStocks,
  bearishStocks,
  niftyChange,
  telegramBotToken,
  telegramChatId,
  syncing = false
}) => {
  const [testing, setTesting] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const { toast } = useToast();
  const [showConfirm, setShowConfirm] = useState(false);
  const [testCandidate, setTestCandidate] = useState<any>(null);

  // Trigger a sandbox test trade (bypasses timing/alignment checks)
  const triggerTestOrder = async () => {
    if (testing) return;
    
    // Pick the first available stock, preserving its bullish/bearish direction
    const isBullish = bullishStocks.length > 0 && !!bullishStocks[0]?.Symbol;
    const candidate = isBullish ? bullishStocks[0] : bearishStocks[0];
    if (!candidate || !candidate.Symbol) {
      toast.error('No stocks found in the live Alpha Engine list to test with.', { title: 'Test Trigger Error' });
      return;
    }

    const testItem = {
      ...candidate,
      _direction: isBullish ? 'BUY' : 'SELL'
    };
    setTestCandidate(testItem);
    setShowConfirm(true);
  };

  const executeTestOrder = async (candidate: any) => {
    if (!candidate) return;
    try {
      setTesting(true);
      const rawStrength = candidate['Strength Factor'] !== undefined ? Number(candidate['Strength Factor']) : 75.0;
      const normalizedStrength = rawStrength > 100 ? (rawStrength / 10) : rawStrength;
      const clampedStrength = Math.min(100, Math.max(10, Number.isFinite(normalizedStrength) ? normalizedStrength : 75.0));
      const direction = candidate._direction || (bearishStocks.some((b: any) => b.Symbol === candidate.Symbol) ? 'SELL' : 'BUY');

      const response = await fetch('/api/python-nse/api/autopilot/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: candidate.Symbol,
          sector: candidate.Sector || 'UNKNOWN',
          direction,
          ltp: Number(candidate.LTP) || 100.0,
          strengthFactor: clampedStrength,
          sectorStrength: Number(candidate.sectorStrength) || 1.0,
          niftyChange: Number(niftyChange) || (direction === 'BUY' ? 0.1 : -0.1),
          strategy: 'FNO_SectorRotation',
          bot_token: telegramBotToken || null,
          chat_id: telegramChatId || null,
          bypass_checks: true // Bypass timing/Nifty filters for testing
        })
      });

      const data = await response.json();
      if (response.ok) {
        toast.success(`Order ID: ${data.data?.order_id || 'MOCK'}\nOption: ${data.data?.dhan_symbol || 'MOCK'}`, { title: 'Test Order Placed! 🚀' });
        fetchStatus();
      } else {
        let errorMsg = 'Unknown error occurred.';
        if (data.detail) {
          if (Array.isArray(data.detail)) {
            errorMsg = data.detail.map((err: any) => `${err.loc.join('.')}: ${err.msg}`).join('\n');
          } else {
            errorMsg = data.detail;
          }
        } else if (data.message) {
          errorMsg = data.message;
        }
        toast.error(errorMsg, { title: 'Test Order Failed ❌' });
      }
    } catch (err) {
      console.error(err);
      toast.error('Network error occurred during test order trigger.', { title: 'Network Error' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-wa-card border border-wa-border rounded-xl p-3 sm:p-5 mb-4 sm:mb-6 shadow-xl">
      <div className="flex items-center justify-between gap-2">
        
        {/* Title and Status indicator */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Zap className={`w-4 h-4 sm:w-5 sm:h-5 shrink-0 ${enabled ? 'text-wa-accent animate-pulse' : 'text-wa-text-muted'}`} />
            <h2 className="text-xs sm:text-lg font-bold text-wa-text-primary tracking-wide truncate">Alpha Autopilot</h2>
            <span className={`px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-xs font-semibold shrink-0 ${
              enabled 
                ? 'bg-wa-accent-subtle text-wa-accent border border-wa-accent' 
                : 'bg-wa-surface text-wa-text-muted border border-wa-border'
            }`}>
              {enabled ? 'ACTIVE' : 'PAUSED'}
            </span>
          </div>
          <p className="hidden sm:block text-wa-text-muted text-xs mt-1">
            FNO Sector Rotation: Auto-scans 10:15-11:30 AM. Dual-Polarity Long/Short. 1 Lot Option MIS.
          </p>
        </div>

        {/* Action Controls in a sleek single horizontal row */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {/* Rules / Risk Gates Drawer Toggle */}
          <button
            onClick={() => setShowRules(!showRules)}
            className={`flex items-center justify-center gap-0 sm:gap-1.5 w-8 sm:w-auto p-0 sm:px-3 h-8 sm:h-9 aspect-square sm:aspect-auto rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-wider border transition-all shrink-0 shadow-sm ${
              showRules
                ? 'bg-wa-accent text-wa-text-primary border-wa-accent'
                : 'bg-wa-accent-subtle text-wa-accent border-wa-border hover:bg-wa-surface'
            }`}
            title="Configure Execution Rules & Gates"
          >
            <Sliders className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline truncate">Rules</span>
          </button>

          {/* Test Order Trigger */}
          <button
            onClick={triggerTestOrder}
            disabled={testing}
            className="flex items-center justify-center gap-0 sm:gap-1.5 w-8 sm:w-auto p-0 sm:px-3 h-8 sm:h-9 aspect-square sm:aspect-auto rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-wider bg-wa-bullish-subtle text-wa-bullish border border-wa-bullish hover:opacity-90 transition-all disabled:opacity-50 shrink-0 shadow-sm"
            title="Test ATM Order"
          >
            <Send className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline truncate">{testing ? 'Testing...' : 'Test ATM Order'}</span>
          </button>

          {/* Sync Button */}
          <button
            onClick={fetchStatus}
            disabled={syncing}
            className="h-8 w-8 sm:h-9 sm:w-9 p-0 aspect-square rounded-xl border border-wa-border bg-wa-surface text-wa-text-muted hover:text-wa-text-primary hover:bg-wa-card transition-all disabled:opacity-50 flex items-center justify-center shrink-0 shadow-sm"
            title="Refresh Status"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-wa-accent' : ''}`} />
          </button>

          {/* Toggle Switch */}
          <button
            onClick={() => toggleAutopilot(!enabled)}
            className={`flex items-center justify-center gap-0 sm:gap-1.5 w-8 sm:w-auto p-0 sm:px-3.5 h-8 sm:h-9 aspect-square sm:aspect-auto rounded-xl font-bold text-[10px] sm:text-xs uppercase tracking-wider transition-all shrink-0 shadow-sm ${
              enabled 
                ? 'bg-wa-bearish hover:opacity-90 text-wa-text-primary shadow-wa-bearish-subtle border border-wa-bearish' 
                : 'bg-wa-accent hover:opacity-90 text-wa-text-primary shadow-wa-accent-subtle border border-wa-accent'
            }`}
            title={enabled ? 'Stop Autopilot' : 'Start Autopilot'}
          >
            {enabled ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current shrink-0" />
                <span className="hidden sm:inline truncate">STOP AUTOPILOT</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                <span className="hidden sm:inline truncate">START AUTOPILOT</span>
              </>
            )}
          </button>
        </div>

      </div>

      {/* Rules Controller Drawer */}
      {showRules && (
        <div className="mt-4 pt-4 border-t border-wa-border">
          <AutopilotRuleController />
        </div>
      )}

      {/* Active Position Details */}
      {activeTrade ? (
        <div className="mt-4 pt-4 border-t border-wa-border bg-wa-surface p-4 rounded-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-wa-bullish animate-ping" />
              <p className="text-xs text-wa-text-muted">Active Option Position (Sandbox)</p>
            </div>
            <button
              onClick={() => openTradingView(activeTrade.symbol)}
              className="text-base font-bold text-wa-text-primary hover:text-wa-accent transition-colors flex items-center gap-1.5 text-left"
              title="Open chart in TradingView"
            >
              {activeTrade.dhan_symbol}
              <ExternalLink size={14} className="opacity-60" />
            </button>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-wa-text-muted mt-1">
              <span>Qty: <strong className="text-wa-text-primary">{activeTrade.quantity}</strong></span>
              <span>Entry Premium: <strong className="text-wa-text-primary">₹{activeTrade.entry_price.toFixed(2)}</strong></span>
              <span>Highest Premium: <strong className="text-wa-text-primary">₹{activeTrade.highest_premium.toFixed(2)}</strong></span>
              <span>Stop Loss (Trailing): <strong className="text-wa-bearish">₹{activeTrade.stop_loss.toFixed(2)}</strong></span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={forceClose}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-wa-bearish-subtle text-wa-bearish border border-wa-bearish hover:bg-wa-bearish hover:text-wa-text-primary transition"
            >
              <Square className="w-3.5 h-3.5" />
              FORCE CLOSE POSITION
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 pt-4 border-t border-wa-border flex items-center justify-center py-4 bg-wa-surface/40 rounded-lg">
          <div className="text-center text-wa-text-muted space-y-1">
            <Activity className="w-6 h-6 text-wa-text-muted mx-auto opacity-50" />
            <p className="text-xs">No active positions currently executing.</p>
            {enabled && (
              <p className="text-[10px] text-wa-accent animate-pulse">
                Waiting for the 10:15 AM trading window...
              </p>
            )}
          </div>
        </div>
      )}

      {/* Warnings & Telegram Config Check */}
      {!hasTelegram && (
        <div className="mt-3 flex items-center gap-2 text-wa-warning text-[11px] bg-wa-warning-subtle border border-wa-warning p-2 rounded">
          <AlertTriangle className="w-4 h-4 shrink-0 text-wa-warning" />
          <span>
            Telegram token or chat ID is not configured in settings. Autopilot will run trades, but notifications will be skipped.
          </span>
        </div>
      )}

      {/* Confirmation Modal for Test Order */}
      <ConfirmationModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={() => {
          setShowConfirm(false);
          executeTestOrder(testCandidate);
        }}
        title="Punch Test Order"
        message={
          <span>
            Do you want to punch a test order for ATM Option ({testCandidate?._direction === 'SELL' ? 'PE / Bearish Put' : 'CE / Bullish Call'}) of{' '}
            <button
              onClick={() => testCandidate?.Symbol && openTradingView(testCandidate.Symbol)}
              className="font-bold text-indigo-500 hover:text-indigo-400 hover:underline transition-colors inline-flex items-center gap-0.5"
              title="Click to view chart in TradingView"
            >
              {testCandidate?.Symbol}
              <ExternalLink size={12} className="inline opacity-80" />
            </button>{' '}
            on Sandbox?
          </span>
        }
        confirmText="Punch Order"
        cancelText="Cancel"
        variant="info"
      />
    </div>
  );
};
