/**
 * CC39 — PoolSourcesPanel
 *
 * The "Sources" sub-tab. The intake list. Lets the user add Telegram
 * channels, Twitter/Instagram handles, or news feeds. The trust score
 * is auto-learned from win/loss over time (we bootstrap at 50).
 */
import React, { useState } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight, Radio } from 'lucide-react';
import { usePoolStore, PoolSourceInput } from '../../store/poolStore';
import { useShallow } from 'zustand/react/shallow';
import { PoolSource } from '../../database';
import { useToast } from '../shared/ToastProvider';

const KIND_LABELS: Record<PoolSource['kind'], string> = {
  TELEGRAM_CHANNEL: 'Telegram channel',
  TELEGRAM_GROUP: 'Telegram group',
  INSTAGRAM: 'Instagram',
  TWITTER: 'Twitter / X',
  NEWS_FEED: 'News feed',
  MANUAL: 'Manual',
};

export const PoolSourcesPanel: React.FC = () => {
  const { sources, addSource, removeSource, toggleSource } = usePoolStore(
    useShallow(state => ({
        sources: state.sources,
        addSource: state.addSource,
        removeSource: state.removeSource,
        toggleSource: state.toggleSource,
    }))
  );
  const { toast } = useToast();
  const [kind, setKind] = useState<PoolSource['kind']>('TELEGRAM_CHANNEL');
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');

  const onAdd = async () => {
    if (!handle.trim()) {
      toast.warning('Enter a handle (e.g. @premium_signals).');
      return;
    }
    const input: PoolSourceInput = {
      kind,
      handle: handle.trim().replace(/^@/, ''),
      displayName: displayName.trim() || undefined,
    };
    await addSource(input);
    setHandle(''); setDisplayName('');
    toast.success(`Source "${input.handle}" added.`);
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr auto', gap: '0.4rem', alignItems: 'end', marginBottom: '1rem' }}>
        <div>
          <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Kind</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as PoolSource['kind'])} style={{
            width: '100%', background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(148, 163, 184, 0.2)',
            color: '#f1f5f9', borderRadius: '0.5rem', padding: '0.55rem 0.7rem', fontSize: '0.85rem', marginTop: 4,
          }}>
            {Object.entries(KIND_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Handle / URL / keyword</label>
          <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@premium_signals or #NIFTY breakout" style={{
            width: '100%', background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(148, 163, 184, 0.2)',
            color: '#f1f5f9', borderRadius: '0.5rem', padding: '0.55rem 0.7rem', fontSize: '0.85rem', marginTop: 4,
          }} />
        </div>
        <div>
          <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Display name</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="optional" style={{
            width: '100%', background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(148, 163, 184, 0.2)',
            color: '#f1f5f9', borderRadius: '0.5rem', padding: '0.55rem 0.7rem', fontSize: '0.85rem', marginTop: 4,
          }} />
        </div>
        <button onClick={onAdd} className="pool-add-btn" style={{ fontSize: '0.8rem' }}>
          <Plus size={14} /> Add
        </button>
      </div>

      {sources.length === 0 ? (
        <div className="pool-empty">
          <Radio size={28} style={{ color: '#475569', marginBottom: 8 }} />
          <h2>No intake sources yet</h2>
          <p>Add the Telegram channels and feeds you trust. The Pool will learn from your verdicts and adjust each source's trust score automatically.</p>
        </div>
      ) : (
        sources.map((s) => (
          <div key={s.id} className="pool-source-row">
            <div>
              <div className="handle">@{s.handle} {s.displayName && <span style={{ color: '#94a3b8', fontWeight: 500 }}>· {s.displayName}</span>}</div>
              <div className="meta">{KIND_LABELS[s.kind]} • trust {s.trustScore}/100 • added {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleDateString() : '—'}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button onClick={() => s.id && toggleSource(s.id, s.enabled !== 1)} style={{
                background: 'transparent', border: 'none', cursor: 'pointer', color: s.enabled ? '#4ade80' : '#64748b',
              }} title={s.enabled ? 'Disable' : 'Enable'}>
                {s.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
              </button>
              <button onClick={() => s.id && removeSource(s.id)} style={{
                background: 'rgba(248, 113, 113, 0.1)', border: '1px solid rgba(248, 113, 113, 0.2)',
                color: '#f87171', borderRadius: 6, padding: '0.3rem 0.5rem', fontSize: '0.7rem', cursor: 'pointer',
              }} title="Remove">
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default PoolSourcesPanel;
