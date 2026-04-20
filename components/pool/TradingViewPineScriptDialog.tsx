import React, { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { useToast } from '../shared/ToastProvider';

interface TradingViewPineScriptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  entryPrice?: number;
  target1?: number;
  target2?: number;
  stopLoss?: number;
}

export const TradingViewPineScriptDialog: React.FC<TradingViewPineScriptDialogProps> = ({
  isOpen,
  onClose,
  symbol,
  entryPrice = 0,
  target1 = 0,
  target2 = 0,
  stopLoss = 0,
}) => {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const cleanSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');

  const pineScript = `//@version=5
indicator("Wealth DB Alert: ${cleanSymbol}", overlay=true)

// Level configurations
entryPrice = ${entryPrice}
target1 = ${target1}
target2 = ${target2}
stopLoss = ${stopLoss}

// Plot levels on chart
plot(entryPrice > 0 ? entryPrice : na, color=color.blue, style=plot.style_line, title="Entry Zone", linewidth=2)
plot(target1 > 0 ? target1 : na, color=color.green, style=plot.style_line, title="Target 1", linewidth=2)
plot(target2 > 0 ? target2 : na, color=color.lime, style=plot.style_line, title="Target 2", linewidth=2)
plot(stopLoss > 0 ? stopLoss : na, color=color.red, style=plot.style_line, title="Stop Loss", linewidth=2)

// Alert conditions
var entryAlertFired = false
var target1AlertFired = false
var target2AlertFired = false
var stopLossAlertFired = false

if ta.cross(close, entryPrice) and not entryAlertFired and entryPrice > 0
    entryAlertFired := true
    alert("Wealth DB: " + syminfo.ticker + " entered entry zone at " + str.tostring(close), alert.freq_once_per_bar)

if ta.cross(close, target1) and not target1AlertFired and target1 > 0
    target1AlertFired := true
    alert("Wealth DB: " + syminfo.ticker + " hit Target 1 at " + str.tostring(close), alert.freq_once_per_bar)

if ta.cross(close, target2) and not target2AlertFired and target2 > 0
    target2AlertFired := true
    alert("Wealth DB: " + syminfo.ticker + " hit Target 2 at " + str.tostring(close), alert.freq_once_per_bar)

if ta.cross(close, stopLoss) and not stopLossAlertFired and stopLoss > 0
    stopLossAlertFired := true
    alert("Wealth DB: " + syminfo.ticker + " hit Stop Loss at " + str.tostring(close), alert.freq_once_per_bar)
`;

  const handleCopy = () => {
    navigator.clipboard.writeText(pineScript);
    setCopied(true);
    toast.success('Pine Script copied to clipboard!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="pool-modal-backdrop" onClick={onClose}>
      <div className="pool-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '650px', width: '90%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2>TradingView Pine Script Alert</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>
        
        <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '1rem' }}>
          Copy this script and paste it into the TradingView Pine Editor to plot the AI predicted levels and fire automated alerts.
        </p>

        <textarea
          readOnly
          value={pineScript}
          style={{
            width: '100%',
            height: '280px',
            fontFamily: 'monospace',
            fontSize: '0.75rem',
            background: 'rgba(15, 23, 42, 0.6)',
            border: '1px solid rgba(148, 163, 184, 0.15)',
            borderRadius: '0.375rem',
            padding: '0.75rem',
            color: '#e2e8f0',
            resize: 'none',
            outline: 'none',
            marginBottom: '1rem'
          }}
        />

        <div className="actions-row">
          <button type="button" onClick={onClose} style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(148, 163, 184, 0.2)', color: '#cbd5e1', borderRadius: '0.5rem', padding: '0.55rem 0.9rem', fontSize: '0.8rem', cursor: 'pointer' }}>
            Close
          </button>
          <button
            onClick={handleCopy}
            className="pool-add-btn"
            style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy Script'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TradingViewPineScriptDialog;
