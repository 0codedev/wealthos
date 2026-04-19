/**
 * CC39 — Pool Category Page
 *
 * The top-level page for the Momentum Pool. Mirrors the Quantum Deck
 * shell pattern: 3 sub-tabs (Watchlist / Verdicts / Sources) with the
 * PoolHeroPanel only on Watchlist.
 *
 * This page is the single mount point for:
 *  - PoolToastBridge (subscribes to engine events)
 *  - usePoolStore.hydrate() (wires up Dexie liveQuery subscriptions)
 *  - poolPollEngine.start() (kicks off the 3s tick loop, idempotent)
 */
import React, { useEffect, useState } from 'react';
import { Eye, Zap, Radio } from 'lucide-react';
import { usePoolStore } from '../../store/poolStore';
import { poolPollEngine } from '../../services/PoolPollEngine';
import { useSettingsStore } from '../../store/settingsStore';
import { isMarketHours } from '../../services/PoolMarketHours';

import PoolHeroPanel from './PoolHeroPanel';
import PoolWatchGrid from './PoolWatchGrid';
import PoolVerdictFeed from './PoolVerdictFeed';
import PoolSourcesPanel from './PoolSourcesPanel';
import PoolAddSymbolDialog from './PoolAddSymbolDialog';
import PoolToastBridge from './PoolToastBridge';

import './Pool.css';

type SubTab = 'watchlist' | 'verdicts' | 'sources';

interface PoolCategoryPageProps {
  activeSubTab?: string;
  onTabChange?: (tab: string) => void;
}

export const PoolCategoryPage: React.FC<PoolCategoryPageProps> = ({ activeSubTab, onTabChange }) => {
  const hydrate = usePoolStore((s) => s.hydrate);
  const items = usePoolStore((s) => s.items);
  const [localSubTab, setLocalSubTab] = useState<SubTab>('watchlist');
  const [showAdd, setShowAdd] = useState(false);
  const [prefill, setPrefill] = useState<{
    ticker?: string;
    targetBuy?: string;
    targetSell?: string;
    stopLoss?: string;
    notes?: string;
  } | undefined>(undefined);

  const subTab = (activeSubTab === 'watchlist' || activeSubTab === 'verdicts' || activeSubTab === 'sources')
    ? (activeSubTab as SubTab)
    : localSubTab;

  const setSubTab = (tab: SubTab) => {
    setLocalSubTab(tab);
    if (onTabChange) {
      onTabChange(tab);
    }
  };

  useEffect(() => {
    const handleAddFromSignal = (e: any) => {
      const data = e.detail;
      setPrefill({
        ticker: data.ticker || '',
        targetBuy: data.targetBuy ? String(data.targetBuy) : '',
        targetSell: data.targetSell ? String(data.targetSell) : '',
        stopLoss: data.stopLoss ? String(data.stopLoss) : '',
        notes: data.notes || ''
      });
      setShowAdd(true);
      setSubTab('watchlist');
    };

    window.addEventListener('pool-add-from-signal', handleAddFromSignal);
    return () => window.removeEventListener('pool-add-from-signal', handleAddFromSignal);
  }, []);

  useEffect(() => {
    hydrate();
    poolPollEngine.start();

    // If user lands here with no items, gently prompt them.
    if (items.length === 0) {
      // no auto-modal — the hero panel makes the CTA visible
    }
  }, [hydrate, items.length === 0]);

  // If user changes `poolMarketHoursOnly`, react by re-checking the loop
  const marketHoursOnly = useSettingsStore((s) => s.poolMarketHoursOnly);
  useEffect(() => {
    if (!marketHoursOnly && !isMarketHours()) {
      // user disabled the gate, but it's still closed — the engine
      // already short-circuits; this is just for clarity in dev tools
    }
  }, [marketHoursOnly]);

  return (
    <div className="pool-page">
      <PoolToastBridge />
      <div className="pool-grid">
        {subTab === 'watchlist' && (
          <PoolHeroPanel onAdd={() => setShowAdd(true)} />
        )}

        {subTab === 'watchlist' && <PoolWatchGrid onEdit={() => setShowAdd(true)} />}
        {subTab === 'verdicts' && <PoolVerdictFeed />}
        {subTab === 'sources' && <PoolSourcesPanel />}
      </div>

      <PoolAddSymbolDialog
        isOpen={showAdd}
        onClose={() => {
          setShowAdd(false);
          setPrefill(undefined);
        }}
        prefillTicker={prefill?.ticker}
        prefillTargetBuy={prefill?.targetBuy}
        prefillTargetSell={prefill?.targetSell}
        prefillStopLoss={prefill?.stopLoss}
        prefillNotes={prefill?.notes}
      />
    </div>
  );
};

export default PoolCategoryPage;
