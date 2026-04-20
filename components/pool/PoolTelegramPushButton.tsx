/**
 * CC39 — PoolTelegramPushButton
 *
 * Small reusable button used inside the Telegram Intel Hub. Click it
 * on a parsed-signal row to push the underlying ticker into the Pool
 * with Telegram provenance (channel + message id + thread id).
 */
import React, { useState } from 'react';
import { Pin } from 'lucide-react';
import { usePoolStore } from '../../store/poolStore';
import { useShallow } from 'zustand/react/shallow';
import { useToast } from '../shared/ToastProvider';

interface PoolTelegramPushButtonProps {
  ticker: string;
  exchange?: 'NSE_EQ' | 'NSE_FNO' | 'BSE_EQ' | 'MCX_COMM';
  channelName?: string;
  messageId?: number;
  threadId?: number;
  caption?: string;
  compact?: boolean;
}

export const PoolTelegramPushButton: React.FC<PoolTelegramPushButtonProps> = ({
  ticker,
  exchange,
  channelName,
  messageId,
  threadId,
  caption,
  compact = false,
}) => {
  const { addFromTelegram } = usePoolStore(
    useShallow(state => ({
        addFromTelegram: state.addFromTelegram,
    }))
  );
  const { toast } = useToast();
  const [pushed, setPushed] = useState(false);

  const onPush = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await addFromTelegram({ ticker, exchange, channelName, messageId, threadId, caption });
      setPushed(true);
      toast.success(`${ticker} tracked for tomorrow. Verdict will run at 9:15 IST.`);
      setTimeout(() => setPushed(false), 3000);
    } catch (err: any) {
      toast.error(`Push failed: ${err?.message || 'unknown'}`);
    }
  };

  return (
    <button onClick={onPush} className="pool-push-btn" title={`Track ${ticker} for tomorrow's open`}>
      <Pin size={11} style={{ color: pushed ? 'var(--tlh-emerald, #10b981)' : 'currentColor', fill: pushed ? 'currentColor' : 'none' }} />
      {!compact && (pushed ? ' Tracked' : ' 📌 Track for tomorrow')}
    </button>
  );
};

export default PoolTelegramPushButton;
