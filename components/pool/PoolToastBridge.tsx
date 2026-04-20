/**
 * CC39 — PoolToastBridge
 *
 * Invisible component. Mounts once and subscribes to PoolPollEngine
 * events to surface a toast for the user. Sits at the top of
 * PoolCategoryPage — no UI, just a side-effect.
 */
import { useEffect } from 'react';
import { poolPollEngine } from '../../services/PoolPollEngine';
import { useToast } from '../shared/ToastProvider';

export const PoolToastBridge: React.FC = () => {
  const { toast } = useToast();
  useEffect(() => {
    return poolPollEngine.onEvent((event) => {
      if (event.type === 'pool:alert-fired') {
        toast.success(`🚨 ${event.item.ticker} ${event.verdict.verdict} (${event.verdict.score})`, {
          duration: 6000,
        });
      } else if (event.type === 'pool:status' && event.reason === 'market-closed') {
        // intentionally silent — the hero panel already shows a countdown
      }
    });
  }, [toast]);
  return null;
};

export default PoolToastBridge;
