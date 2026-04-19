/**
 * CC39 — PoolHeroPanel
 *
 * The big hero at the top of the Watchlist sub-tab.
 * Shows 4 KPIs:
 *  - Tracked   — total items in the pool
 *  - With Alert — items with alertEnabled = 1
 *  - Verdict Ready — items with a verdict in the last 5 minutes
 *  - Last Run — ms since the most recent verdict
 *
 * Also shows:
 *  - Search bar + Add button (delegated via onAdd callback)
 *  - Import from legacy watchlist (one click)
 *  - Market closed banner with countdown (when applicable)
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Upload, Eye, Zap, Bell, Clock } from 'lucide-react';
import { usePoolStore } from '../../store/poolStore';
import { useShallow } from 'zustand/react/shallow';
import { isMarketHours, formatNextOpen } from '../../services/PoolMarketHours';
import { useToast } from '../shared/ToastProvider';
import { COPY } from '../../utils/appCopy';

interface PoolHeroPanelProps {
  onAdd: () => void;
}

export const PoolHeroPanel: React.FC<PoolHeroPanelProps> = ({ onAdd }) => {
  const { items, verdicts, importLegacyWatchlist } = usePoolStore(
    useShallow(state => ({
        items: state.items,
        verdicts: state.verdicts,
        importLegacyWatchlist: state.importLegacyWatchlist,
    }))
  );
  const { toast } = useToast();
  const [, setTick] = useState(0);
  const [marketOpen, setMarketOpen] = useState(isMarketHours());

  useEffect(() => {
    const id = setInterval(() => setMarketOpen(isMarketHours()), 30_000);
    return () => clearInterval(id);
  }, []);

  const stats = useMemo(() => {
    const tracked = items.length;
    const withAlert = items.filter((i) => i.alertEnabled === 1).length;
    const fiveMinAgo = Date.now() - 5 * 60_000;
    const freshVerdicts = verdicts.filter((v) => v.generatedAt > fiveMinAgo);
    const verdictReady = items.filter((i) => i.lastVerdictAt && i.lastVerdictAt > fiveMinAgo).length;
    const lastRun = verdicts[0]?.generatedAt;
    const lastRunAgo = lastRun ? Math.max(0, Math.floor((Date.now() - lastRun) / 1000)) : null;
    // SPRINT 2.C2: replaces the old hardcoded "72% Calls" fake stat with REAL
    // verdict telemetry from the last 24 hours.
    const dayAgo = Date.now() - 24 * 60 * 60_000;
    const verdicts24h = verdicts.filter((v) => v.generatedAt > dayAgo).length;
    return { tracked, withAlert, verdictReady, freshVerdictCount: freshVerdicts.length, lastRunAgo, verdicts24h };
  }, [items, verdicts]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  const onImport = async () => {
    const n = await importLegacyWatchlist();
    if (n > 0) toast.success(COPY.toasts.importedLegacy(n));
    else toast.info(COPY.toasts.noLegacyWatchlist);
  };

  return (
    <div className="pool-hero">
      <div>
        <h1><Zap size={20} className="inline text-indigo-400" /> Momentum Pool</h1>
        <p className="lead">
          Track symbols you noticed from Telegram, Instagram, or anywhere — the Pool polls the APIs,
          runs an AI verdict on every candle boundary, and fires alerts only when the conviction is real.
        </p>
        <div className="pool-search-row">
          <button className="pool-add-btn" onClick={onAdd}>
            <Plus size={16} /> Add symbol
          </button>
          <button className="pool-import-btn" onClick={onImport} title="Pull from the legacy smart_watchlist_v2 bucket">
            <Upload size={12} /> Import from legacy watchlist
          </button>
        </div>
        {!marketOpen && (
          <div className="pool-market-closed" style={{ marginTop: '0.85rem' }}>
            <Clock size={14} />
            <span>Market closed. Polling resumes in {formatNextOpen()}.</span>
          </div>
        )}
      </div>
      <div className="pool-hero-stats">
        <div className="pool-stat cyan">
          <div className="label"><Eye size={9} style={{ verticalAlign: '-1px' }} /> Tracked</div>
          <div className="value">{stats.tracked}</div>
        </div>
        <div className="pool-stat violet">
          <div className="label"><Bell size={9} style={{ verticalAlign: '-1px' }} /> Alerts on</div>
          <div className="value">{stats.withAlert}</div>
        </div>
        <div className="pool-stat green">
          <div className="label"><Zap size={9} style={{ verticalAlign: '-1px' }} /> Verdict ready</div>
          <div className="value">{stats.verdictReady}</div>
        </div>
        <div className="pool-stat amber">
          <div className="label"><Clock size={9} style={{ verticalAlign: '-1px' }} /> Last run</div>
          <div className="value" style={{ fontSize: '0.95rem' }}>
            {stats.lastRunAgo === null ? '—' : stats.lastRunAgo < 60 ? `${stats.lastRunAgo}s` : `${Math.floor(stats.lastRunAgo / 60)}m`}
          </div>
        </div>
        <div className="pool-stat indigo">
          <div className="label"><Zap size={9} style={{ verticalAlign: '-1px' }} /> Verdicts 24h</div>
          <div className="value" style={{ fontSize: '0.95rem', color: '#818cf8' }}>
            {stats.verdicts24h}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PoolHeroPanel;
