import React, { useState, useEffect } from 'react';
import { X, CheckCircle } from 'lucide-react';
import { useToast } from '../shared/ToastProvider';
import { upstoxGTTService } from '../../services/UpstoxGTTService';
import { resolveInstrumentKey } from '../../services/IntradayCandleService';

interface UpstoxGTTDialogProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  instrumentKey?: string;
  defaultPrice?: number;
  stopLoss?: number;
  target1?: number;
}

export const UpstoxGTTDialog: React.FC<UpstoxGTTDialogProps> = ({
  isOpen,
  onClose,
  symbol,
  instrumentKey: initialKey,
  defaultPrice = 0,
  stopLoss = 0,
  target1 = 0,
}) => {
  const { toast } = useToast();
  const [resolvedKey, setResolvedKey] = useState(initialKey || '');
  const [loadingKey, setLoadingKey] = useState(false);

  const [quantity, setQuantity] = useState(1);
  const [transactionType, setTransactionType] = useState<'BUY' | 'SELL'>('BUY');
  const [product, setProduct] = useState<'D' | 'I'>('D'); // D = Delivery, I = Intraday
  const [triggerPrice, setTriggerPrice] = useState(defaultPrice);
  const [triggerType, setTriggerType] = useState<'ABOVE' | 'BELOW'>('ABOVE');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTriggerPrice(defaultPrice);
      if (initialKey) {
        setResolvedKey(initialKey);
      } else {
        setLoadingKey(true);
        resolveInstrumentKey(symbol)
          .then((key) => {
            if (key) setResolvedKey(key);
          })
          .finally(() => setLoadingKey(false));
      }
    }
  }, [isOpen, symbol, initialKey, defaultPrice]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvedKey) {
      toast.error('Cannot place GTT: Instrument key not resolved.');
      return;
    }
    setSubmitting(true);

    const payload = {
      type: 'SINGLE',
      quantity: Number(quantity),
      product: product,
      instrument_token: resolvedKey,
      transaction_type: transactionType,
      rules: [
        {
          strategy: 'ENTRY',
          trigger_type: triggerType,
          trigger_price: Number(triggerPrice),
        },
      ],
    };

    try {
      const res = await upstoxGTTService.placeGTT(payload);
      if (res && res.status === 'success') {
        toast.success(`GTT order placed successfully! ID: ${res.data?.gtt_order_id || 'N/A'}`);
        onClose();
      } else if (res && res.error) {
        toast.error(`Failed to place GTT: ${res.error}`);
      } else {
        toast.error('Failed to place GTT order.');
      }
    } catch (err: any) {
      toast.error(`Error placing GTT: ${err?.message || 'unknown'}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pool-modal-backdrop" onClick={onClose}>
      <div className="pool-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '450px', width: '90%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.2rem' }}>
          <h2>Place Upstox GTT Trigger</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem', background: 'rgba(15, 23, 42, 0.4)', padding: '0.75rem', borderRadius: '0.375rem', border: '1px solid rgba(148, 163, 184, 0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
              <span style={{ color: '#94a3b8' }}>Symbol:</span>
              <span style={{ fontWeight: 'bold', color: '#e2e8f0' }}>{symbol}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginTop: '0.25rem' }}>
              <span style={{ color: '#94a3b8' }}>Instrument Key:</span>
              <span style={{ color: '#64748b' }}>{loadingKey ? 'Resolving...' : resolvedKey || 'Unresolved'}</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label>Side</label>
              <select value={transactionType} onChange={(e) => setTransactionType(e.target.value as 'BUY' | 'SELL')}>
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
            </div>
            <div>
              <label>Product</label>
              <select value={product} onChange={(e) => setProduct(e.target.value as 'D' | 'I')}>
                <option value="D">Delivery (CNC)</option>
                <option value="I">Intraday (MIS)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label>Quantity</label>
              <input
                type="number"
                min="1"
                required
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              />
            </div>
            <div>
              <label>Trigger Price (₹)</label>
              <input
                type="number"
                step="0.05"
                required
                value={triggerPrice}
                onChange={(e) => setTriggerPrice(parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label>Trigger Condition</label>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.35rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.8rem', color: '#cbd5e1' }}>
                <input
                  type="radio"
                  name="triggerType"
                  value="ABOVE"
                  checked={triggerType === 'ABOVE'}
                  onChange={() => setTriggerType('ABOVE')}
                />
                <span>Trigger if Price Goes ABOVE</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.8rem', color: '#cbd5e1' }}>
                <input
                  type="radio"
                  name="triggerType"
                  value="BELOW"
                  checked={triggerType === 'BELOW'}
                  onChange={() => setTriggerType('BELOW')}
                />
                <span>Trigger if Price Goes BELOW</span>
              </label>
            </div>
          </div>

          {stopLoss > 0 || target1 > 0 ? (
            <div style={{ marginBottom: '1.25rem', fontSize: '0.7rem', color: '#94a3b8' }}>
              <span style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>AI Levels Reference:</span>
              <div style={{ display: 'flex', gap: '1rem' }}>
                {stopLoss > 0 && (
                  <button
                    type="button"
                    onClick={() => { setTriggerPrice(stopLoss); setTriggerType('BELOW'); }}
                    style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '0.25rem', padding: '0.2rem 0.4rem', color: '#f87171', cursor: 'pointer' }}
                  >
                    SL: ₹{stopLoss}
                  </button>
                )}
                {target1 > 0 && (
                  <button
                    type="button"
                    onClick={() => { setTriggerPrice(target1); setTriggerType('ABOVE'); }}
                    style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '0.25rem', padding: '0.2rem 0.4rem', color: '#34d399', cursor: 'pointer' }}
                  >
                    T1: ₹{target1}
                  </button>
                )}
              </div>
            </div>
          ) : null}

          <div className="actions-row">
            <button type="button" onClick={onClose} style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(148, 163, 184, 0.2)', color: '#cbd5e1', borderRadius: '0.5rem', padding: '0.55rem 0.9rem', fontSize: '0.8rem', cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={submitting || !resolvedKey} className="pool-add-btn" style={{ fontSize: '0.8rem' }}>
              {submitting ? 'Placing GTT...' : 'Place GTT'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UpstoxGTTDialog;
