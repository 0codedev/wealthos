/**
 * CC39 — PoolVerdictFeed
 *
 * The "Verdicts" sub-tab. A real-time feed of every PoolVerdict the
 * engine produces. Each row: time, ticker, verdict chip, score, summary,
 * and (expandable) reasoning + suggested levels.
 */
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, ExternalLink, Trash2 } from 'lucide-react';
import { usePoolStore } from '../../store/poolStore';
import { useShallow } from 'zustand/react/shallow';
import { db } from '../../database';
import { useToast } from '../shared/ToastProvider';

export const PoolVerdictFeed: React.FC = () => {
  const { verdicts, items } = usePoolStore(
    useShallow(state => ({
        verdicts: state.verdicts,
        items: state.items,
    }))
  );
  const { toast } = useToast();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<'ALL' | 'ACTIONABLE'>('ALL');

  const tickerToItemId = new Map<string, number>();
  for (const i of items) if (i.id) tickerToItemId.set(i.ticker, i.id);

  const visible = verdicts.filter((v) => {
    if (filter === 'ACTIONABLE') return v.score >= 65 && (v.verdict === 'STRONG_BUY' || v.verdict === 'BUY' || v.verdict === 'STRONG_SELL' || v.verdict === 'SELL');
    return true;
  });

  const onClearAll = async () => {
    if (!confirm('Delete all verdict history?')) return;
    await db.pool_verdicts.clear();
    toast.info('Verdict history cleared.');
  };

  if (verdicts.length === 0) {
    return (
      <div className="pool-empty">
        <h2>No verdicts yet</h2>
        <p>The AI runs every 5-minute candle boundary during market hours. Run one manually from the Watchlist tab.</p>
      </div>
    );
  }

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{
        hidden: { opacity: 1 },
        show: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.08 } },
      }}
    >
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.85rem' }}>
        {(['ALL', 'ACTIONABLE'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`pool-subtab ${filter === f ? 'active' : ''}`}
          >
            {f === 'ACTIONABLE' ? 'Actionable (≥65)' : 'All Verdicts'} ({f === 'ACTIONABLE' ? visible.length : verdicts.length})
          </button>
        ))}
        <button onClick={onClearAll} className="pool-import-btn" style={{ marginLeft: 'auto' }}>
          <Trash2 size={11} /> Clear all
        </button>
      </div>
      {visible.map((v) => {
        const isOpen = expanded.has(v.id!);
        const itemId = tickerToItemId.get(v.ticker);
        return (
          <motion.div
            key={v.id}
            variants={{
              hidden: { opacity: 0, y: 6 },
              show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
            }}
            className="pool-feed-row" style={{ gridTemplateColumns: '70px 1fr auto' }}
          >
            <div className="time">
              {new Date(v.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              <div style={{ fontSize: '0.55rem', color: '#64748b', marginTop: 2 }}>{v.triggerType}</div>
            </div>
            <div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span className="ticker" style={{ fontSize: '0.85rem', fontWeight: 800, color: '#f1f5f9' }}>{v.ticker}</span>
                <span className={`verdict-chip ${v.verdict}`} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '0.15rem 0.45rem', fontSize: '0.6rem', fontWeight: 700,
                  borderRadius: 999, letterSpacing: '0.06em', textTransform: 'uppercase',
                }}>{v.verdict} · {v.score}</span>
                <span style={{ fontSize: '0.6rem', color: '#94a3b8' }}>conf {(v.confidence * 100).toFixed(0)}%</span>
              </div>
              <div className="summary" style={{ marginTop: 2 }}>{v.summary}</div>
              {isOpen && (
                <div style={{ marginTop: 6 }}>
                  {v.reasoning.length > 0 && (
                    <ul style={{ paddingLeft: '1.1rem', color: '#cbd5e1', fontSize: '0.72rem' }}>
                      {v.reasoning.map((r, idx) => <li key={idx}>{r}</li>)}
                    </ul>
                  )}
                  {v.suggestedEntry && (
                    <div className="reasoning">
                      Levels — entry {v.suggestedEntry} • stop {v.suggestedStop ?? '—'} • target {v.suggestedTarget ?? '—'}
                      {v.riskRewardRatio ? ` • R:R ${v.riskRewardRatio.toFixed(2)}` : ''}
                    </div>
                  )}
                  <div className="reasoning">Model: {v.sourceModel}</div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {/* SPRINT 2.B2 — promote this verdict's symbol into the Smart Watchlist */}
              <button
                onClick={async () => {
                  try {
                    const { ensureWatchlistEntry } = await import('../../store/poolStore');
                    const added = await ensureWatchlistEntry(v.ticker, v.suggestedEntry ?? undefined);
                    toast[added ? 'success' : 'info'](
                      added ? `${v.ticker} added to Smart Watchlist` : `${v.ticker} is already in your watchlist`
                    );
                  } catch (e) {
                    toast.error(`Failed to add ${v.ticker}`);
                  }
                }}
                style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399', borderRadius: 4, padding: '0.2rem 0.4rem', fontSize: '0.6rem', cursor: 'pointer' }}
                title="Add to Smart Watchlist"
              >
                ＋
              </button>
              {itemId && (
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('navigate-to-tab', { detail: { category: 'pool', subTab: 'watchlist' } }))}
                  style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(148, 163, 184, 0.18)', color: '#94a3b8', borderRadius: 4, padding: '0.2rem 0.4rem', fontSize: '0.6rem', cursor: 'pointer' }}
                  title="Open in Watchlist"
                >
                  <ExternalLink size={10} />
                </button>
              )}
              <button
                onClick={() => {
                  const next = new Set(expanded);
                  if (isOpen) next.delete(v.id!); else next.add(v.id!);
                  setExpanded(next);
                }}
                style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(148, 163, 184, 0.18)', color: '#cbd5e1', borderRadius: 4, padding: '0.2rem 0.4rem', fontSize: '0.6rem', cursor: 'pointer' }}
                title={isOpen ? 'Collapse' : 'Expand'}
              >
              {isOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
};

export default PoolVerdictFeed;
