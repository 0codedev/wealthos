/**
 * Tiny in-memory undo stack for destructive actions.
 *
 * Strategy:
 * - 5-slot ring buffer (single-slot would be simpler, but bulk deletes
 *   and rapid multi-row deletes happen in practice).
 * - Each entry carries a label and an `undo` callback that restores the
 *   deleted item. The toast UI fires the callback when the user clicks
 *   "Undo" before the toast expires.
 * - Lives in module scope so all components share the same stack
 *   (e.g. GoalGPS and HeroSection can both push to it).
 * - No persistence — session-only, as required.
 */

export type UndoKind =
    | 'investment'
    | 'lifeEvent'
    | 'goal'
    | 'alert'
    | 'trade'
    | 'mistake'
    | 'generic';

export interface UndoEntry {
    id: string;
    kind: UndoKind;
    label: string;            // Human-friendly: e.g. "TCS"
    message: string;          // Toast body: e.g. "Investment deleted"
    undo: () => void | Promise<void>;
    pushedAt: number;
}

const MAX_SLOTS = 5;
const stack: UndoEntry[] = [];

const subscribers = new Set<() => void>();

function notify() {
    subscribers.forEach(fn => {
        try { fn(); } catch { /* noop */ }
    });
}

export function pushUndo(entry: Omit<UndoEntry, 'id' | 'pushedAt'>): UndoEntry {
    const fullEntry: UndoEntry = {
        ...entry,
        id: `undo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        pushedAt: Date.now(),
    };

    stack.push(fullEntry);
    if (stack.length > MAX_SLOTS) {
        stack.shift();
    }
    notify();
    return fullEntry;
}

export function consumeUndo(id: string): UndoEntry | null {
    const idx = stack.findIndex(e => e.id === id);
    if (idx === -1) return null;
    const [entry] = stack.splice(idx, 1);
    notify();
    return entry;
}

export function dropUndo(id: string): void {
    const idx = stack.findIndex(e => e.id === id);
    if (idx === -1) return;
    stack.splice(idx, 1);
    notify();
}

export function peekStack(): UndoEntry[] {
    return [...stack];
}

export function subscribeUndoStack(fn: () => void): () => void {
    subscribers.add(fn);
    return () => {
        subscribers.delete(fn);
    };
}
