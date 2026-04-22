/**
 * RecentlyDeletedPanel — Settings → Data surface listing soft-deleted
 * investments, trades, and mistakes with Restore + Delete-forever actions.
 *
 * Owned by: Top-10 #2 (Soft-delete + undo). Backs the durable recovery
 * path: a row stays here for 30 days after a delete (the prune job from
 * `utils/storeHelpers.ts` then hard-deletes it).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, Trade, Mistake } from '../../database';
import { Investment } from '../../types';
import { restoreSoftDeleted, permanentlyDelete } from '../../lib/deleteWithUndo';
import { useToast } from '../shared/ToastProvider';
import { COPY } from '../../utils/appCopy';
import { Trash2, RotateCcw, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type Row =
  | { kind: 'investment'; row: Investment }
  | { kind: 'trade'; row: Trade }
  | { kind: 'mistake'; row: Mistake };

function ago(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}

const R = COPY.recentlyDeleted;

export const RecentlyDeletedPanel: React.FC = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [confirming, setConfirming] = useState<{ label: string; onConfirm: () => void } | null>(null);

  const reload = useCallback(() => {
    const subscription = liveQuery(async () => {
      const [inv, trd, mst] = await Promise.all([
        (db.investments as any).deleted().toArray(),
        (db.trades as any).deleted().toArray(),
        (db.mistakes as any).deleted().toArray(),
      ]);
      return [
        ...inv.map((row: Investment) => ({ kind: 'investment' as const, row })),
        ...trd.map((row: Trade) => ({ kind: 'trade' as const, row })),
        ...mst.map((row: Mistake) => ({ kind: 'mistake' as const, row })),
      ];
    }).subscribe((data) => {
      setRows(
        data.sort((a, b) => ((b.row as any).deletedAt ?? 0) - ((a.row as any).deletedAt ?? 0))
      );
    });
    return subscription;
  }, []);

  useEffect(() => {
    const s = reload();
    return () => s.unsubscribe();
  }, [reload]);

  const labelOf = (r: Row): string =>
    (r.row as any).name ?? (r.row as any).ticker ?? (r.row as any).title ?? 'Item';

  const handleRestore = async (r: Row) => {
    const t = db[r.kind as 'investments' | 'trades' | 'mistakes'] as any;
    const id = r.row.id as string | number;
    const ok = await restoreSoftDeleted(t, id);
    if (ok) {
      toast.success(COPY.undo.restored(labelOf(r)));
    } else {
      toast.error(COPY.undo.failed);
    }
  };

  const handlePermanent = (r: Row) => {
    const t = db[r.kind as 'investments' | 'trades' | 'mistakes'] as any;
    const id = r.row.id as string | number;
    const label = labelOf(r);
    setConfirming({
      label,
      onConfirm: async () => {
        const ok = await permanentlyDelete(t, id);
        if (ok) {
          toast.success(R.permanentDeleted(label));
        } else {
          toast.error(COPY.undo.failed);
        }
        setConfirming(null);
      },
    });
  };

  return (
    <section className="space-y-3">
      <header className="flex items-center gap-2">
        <Trash2 size={18} className="text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{R.title}</h2>
        <span className="text-xs text-slate-500">
          {rows.length === 0 ? R.empty : `${rows.length}`}
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{R.empty}</p>
      ) : (
        <ul className="space-y-2">
          <AnimatePresence>
            {rows.map((r) => {
              const label = labelOf(r);
              const when = ago((r.row as any).deletedAt ?? 0);
              return (
                <motion.li
                  key={`${r.kind}-${r.row.id}`}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2"
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] font-bold uppercase">
                    {r.kind[0]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{label}</p>
                    <p className="text-[11px] text-slate-500">{R.ago(when)}</p>
                  </div>
                  <button
                    onClick={() => handleRestore(r)}
                    className="px-2.5 py-1 rounded-lg text-xs font-bold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10 flex items-center gap-1"
                  >
                    <RotateCcw size={12} /> {R.restore}
                  </button>
                  <button
                    onClick={() => handlePermanent(r)}
                    className="px-2.5 py-1 rounded-lg text-xs font-bold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10 flex items-center gap-1"
                  >
                    <X size={12} /> {R.permanentDelete}
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 w-full max-w-sm shadow-2xl"
          >
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">
              {R.permanentDelete}
            </h3>
            <p className="text-sm text-slate-500 mb-4">{R.confirmPermanent(confirming.label)}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(null)}
                className="flex-1 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={confirming.onConfirm}
                className="flex-1 px-3 py-2 rounded-lg text-sm font-bold text-white bg-rose-600 hover:bg-rose-700"
              >
                {R.permanentDelete}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </section>
  );
};

export default RecentlyDeletedPanel;
