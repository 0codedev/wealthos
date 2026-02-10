/**
 * deleteWithUndo — single contract for every recoverable destructive
 * action in the app. Wires Dexie soft-delete + the in-memory undoStack
 * together so the caller only thinks about "what to delete" and
 * "what to show the user."
 *
 * Owned by: Top-10 #2 (Soft-delete + undo).
 *
 * Behaviour:
 *  1. Soft-deletes the row (sets `isDeleted: true, deletedAt: now`).
 *  2. Soft-deletes every cascaded row (e.g. an investment's realized
 *     transactions) by foreign-key lookup.
 *  3. Pushes an undo entry onto `undoStack`. The entry's `undo` callback
 *     restores the row + the cascade and re-fires the caller's
 *     `onRestored` hook (used to refresh in-memory state).
 *  4. Returns the entry id so the caller can wire it into the toast's
 *     Undo button via `consumeUndo(id)?.undo()`.
 *
 * If the soft-delete itself throws, returns `null` and does NOT push
 * the undo entry. The caller handles the failure (rolls back the
 * optimistic hide + shows a toast).
 *
 * The Recently Deleted panel uses `restoreSoftDeleted` directly
 * (bypassing the undoStack) for recovery past the 30s toast window.
 */
import type { Table } from 'dexie';
import { pushUndo, type UndoKind } from './undoStack';
import { db } from '../database';
import { logger } from '../utils/logger';

export type UndoableTable = 'investments' | 'trades' | 'mistakes';

export interface DeleteWithUndoArgs {
  table: UndoableTable;
  /** Primary key. Investments use string ids; trades/mistakes use numbers. */
  id: string | number;
  kind: UndoKind;
  label: string;
  message: string;
  /** Cascaded soft-deletes. Each target must already have `withSoftDelete`
   * applied. Only `investments` cascades today (to realized_transactions). */
  cascade?: Array<{ table: Table<any, any>; foreignKey: string }>;
  /** Called after undo restores the row. Used to refresh local state. */
  onRestored?: () => void | Promise<void>;
}

interface TableWithSoftDelete {
  softDelete?: (id: any) => Promise<void>;
  restore?: (id: any) => Promise<void>;
  delete?: (id: any) => Promise<void>;
  get?: (id: any) => Promise<any>;
  where?: (key: string) => any;
}

function resolveTable(name: UndoableTable): TableWithSoftDelete {
  // Resolved at call-time (not module-load) so tests can swap the
  // underlying `db.<table>` between cases. Fall back to scanning the db
  // object for an entry whose own property name matches (handles cases
  // where the test mock replaced the table via `(db as any)[name] = ...`
  // but TypeScript's nominal-type lookup misses the cast).
  const direct = (db as any)[name];
  if (direct) return direct as TableWithSoftDelete;
  return db[name] as unknown as TableWithSoftDelete;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function deleteWithUndo(args: DeleteWithUndoArgs): Promise<string | null> {
  const t = resolveTable(args.table);
  if (!t.softDelete) {
    logger.error(
      'deleteWithUndo',
      `table ${args.table} is missing softDelete(). Call withSoftDelete(db.${args.table}) at boot.`
    );
    return null;
  }

  try {
    await t.softDelete(args.id);
  } catch (err) {
    logger.error('deleteWithUndo', `softDelete failed for ${args.table}/${String(args.id)}: ${errMsg(err)}`);
    return null;
  }

  if (args.cascade) {
    for (const c of args.cascade) {
      const cT = c.table as unknown as TableWithSoftDelete;
      const matches = await (c.table as any).where(c.foreignKey).equals(args.id).toArray();
      for (const m of matches) {
        if (cT.softDelete) {
          try {
            await cT.softDelete(m.id);
          } catch (err) {
            logger.error(
              'deleteWithUndo',
              `cascade softDelete failed for ${args.table}→${String(m.id)}: ${errMsg(err)}`
            );
            // Continue: partial cascade is better than no-op; the user can
            // retry from Recently Deleted.
          }
        }
      }
    }
  }

  const entry = pushUndo({
    kind: args.kind,
    label: args.label,
    message: args.message,
    undo: async () => {
      const ok = await restoreSoftDeleted(resolveTable(args.table), args.id);
      if (ok && args.cascade) {
        for (const c of args.cascade) {
          const cT = c.table as unknown as TableWithSoftDelete;
          const matches = await (c.table as any).where(c.foreignKey).equals(args.id).toArray();
          for (const m of matches) {
            if (cT.restore) await cT.restore(m.id);
          }
        }
      }
      if (ok && args.onRestored) {
        try {
          await args.onRestored();
        } catch (err) {
          logger.error('deleteWithUndo', `onRestored callback threw: ${errMsg(err)}`);
        }
      }
    },
  });

  return entry.id;
}

export async function restoreSoftDeleted(
  table: TableWithSoftDelete,
  id: string | number
): Promise<boolean> {
  if (!table.restore) {
    logger.error('restoreSoftDeleted', 'table missing restore()');
    return false;
  }
  try {
    let existing: any = null;
    if (table.get) {
      existing = await table.get(id);
    } else {
      // Fallback for mock tables (tests) that don't expose get(): scan the
      // table's own `rows` array.
      const rows = (table as any).rows;
      if (Array.isArray(rows)) existing = rows.find((r: any) => r.id === id) ?? null;
    }
    if (!existing) return false;
    if (!existing.isDeleted) return true; // already restored — idempotent
    if (table.restore) await table.restore(id);
    return true;
  } catch (err) {
    logger.error('restoreSoftDeleted', errMsg(err));
    return false;
  }
}

export async function permanentlyDelete(
  table: TableWithSoftDelete,
  id: string | number
): Promise<boolean> {
  try {
    if (!table.delete) return false;
    await table.delete!(id);
    return true;
  } catch (err) {
    logger.error('permanentlyDelete', errMsg(err));
    return false;
  }
}
