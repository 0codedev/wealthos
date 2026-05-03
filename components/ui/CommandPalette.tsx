
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Command,
  Navigation,
  Zap,
  Terminal,
  Clock,
  ArrowRight,
  Shield,
  EyeOff,
  PlusCircle,
  Brain,
  LayoutDashboard,
  Wallet,
  BookOpen,
  HelpCircle,
  FileText,
  Calculator,
  Copy,
  Sparkles
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ShortcutDefinition } from '../../hooks/useKeyboardShortcuts';
import { EmptyState } from '../shared/EmptyState';
import { getRecentlyViewedTabs, subscribeRecentlyViewed } from '../../utils/useLastViewedTab';
import { safeGet, safeSet } from '../../utils/safeDefaults';
import { evaluateCommandExpression } from '../../utils/calculator';
import { showToast } from '../shared/ToastProvider';

const RECENT_KEY = 'wa_cmd_palette_recent';
const RECENT_MAX = 4;

interface RecentAction {
    description: string;
    category: string;
    action: () => void;
    ts: number;
}

function loadRecent(): RecentAction[] {
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw) as RecentAction[];
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function saveRecent(list: RecentAction[]) {
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
    } catch {
        // localStorage may be disabled; non-fatal
    }
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  shortcuts: ShortcutDefinition[];
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, shortcuts }) => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recent, setRecent] = useState<RecentAction[]>(() => loadRecent());
  // CC112: per-scope recently-viewed tabs from useLastViewedTab. Powers a
  // "Jump back to" section in the palette when the user has been navigating.
  const [tabRecents, setTabRecents] = useState(() => getRecentlyViewedTabs(5));
  useEffect(() => {
    if (!isOpen) return;
    const off = subscribeRecentlyViewed(() => setTabRecents(getRecentlyViewedTabs(5)));
    return off;
  }, [isOpen]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter shortcuts based on search
  const filtered = useMemo(() => {
    if (!search) return shortcuts.filter(s => !s.disabled);
    const lowSearch = search.toLowerCase();
    return shortcuts.filter(s =>
      !s.disabled &&
      (s.description.toLowerCase().includes(lowSearch) || s.category.toLowerCase().includes(lowSearch))
    );
  }, [search, shortcuts]);

  // Stable wrappers for shortcuts so we can attach recent-tracking
  const trackedActions = useMemo(() => {
    const map = new Map<string, () => void>();
    shortcuts.forEach(s => {
      map.set(s.description, () => {
        try { s.action(); } catch { /* swallow */ }
        const next: RecentAction[] = [
          { description: s.description, category: s.category, action: s.action, ts: Date.now() },
          ...recent.filter(r => r.description !== s.description),
        ].slice(0, RECENT_MAX);
        setRecent(next);
        saveRecent(next);
      });
    });
    return map;
  }, [shortcuts, recent]);

  // Real-time calculation evaluator
  const calcResult = useMemo(() => evaluateCommandExpression(search), [search]);

  const copyCalcResult = (resultStr: string) => {
    navigator.clipboard.writeText(resultStr);
    showToast(`Copied ${resultStr} to clipboard`, 'success');
    onClose();
  };

  // Group by category
  const categories = useMemo(() => {
    const groups: Record<string, ShortcutDefinition[]> = {};
    filtered.forEach(s => {
      if (!groups[s.category]) groups[s.category] = [];
      groups[s.category].push(s);
    });
    return groups;
  }, [filtered]);

  const totalItemsCount = (calcResult ? 1 : 0) + filtered.length;

  // Reset index when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setSearch('');
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (totalItemsCount === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % totalItemsCount);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + totalItemsCount) % totalItemsCount);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (calcResult && selectedIndex === 0) {
        copyCalcResult(calcResult.formattedResult);
        return;
      }
      const targetIndex = calcResult ? selectedIndex - 1 : selectedIndex;
      if (filtered[targetIndex]) {
        const wrapper = trackedActions.get(filtered[targetIndex].description);
        if (wrapper) wrapper();
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category.toUpperCase()) {
      case 'NAVIGATION': return <Navigation size={14} className="text-indigo-400" />;
      case 'ACTIONS': return <PlusCircle size={14} className="text-emerald-400" />;
      case 'AI': return <Brain size={14} className="text-purple-400" />;
      default: return <Terminal size={14} className="text-slate-400" />;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-sm z-[9998]"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            className="fixed top-[15%] left-1/2 -ml-[300px] w-full max-w-[600px] bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-[2rem] shadow-2xl z-[9999] overflow-hidden backdrop-blur-xl"
          >
            <div className="flex items-center gap-4 px-6 py-5 border-b border-slate-200 dark:border-slate-800">
              <Search className="w-5 h-5 text-slate-400 dark:text-slate-500" />
              <input 
                ref={inputRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search commands or navigate..."
                className="bg-transparent border-none outline-none text-lg font-medium text-slate-900 dark:text-white w-full placeholder:text-slate-400 dark:placeholder:text-slate-600"
              />
              <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase">ESC</span>
              </div>
            </div>

            <div className="max-h-[400px] overflow-y-auto p-4 custom-scrollbar">
              {!search && recent.length > 0 && (
                <div className="mb-5 pb-4 border-b border-slate-200/60 dark:border-slate-800/60">
                  <div className="flex items-center gap-2 px-4 mb-2">
                    <Clock size={12} className="text-slate-400" />
                    <span className="text-[10px] font-black text-slate-500 dark:text-slate-500 uppercase tracking-widest">Recent</span>
                  </div>
                  <div className="space-y-1">
                    {recent.map((r) => {
                      const shortcut = shortcuts.find(s => s.description === r.description);
                      if (!shortcut || shortcut.disabled) return null;
                      return (
                        <motion.button
                          key={`recent-${r.description}`}
                          onClick={() => {
                            const wrapper = trackedActions.get(r.description);
                            if (wrapper) wrapper();
                            onClose();
                          }}
                          className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-transparent hover:border-slate-200 dark:hover:border-slate-700 transition-all text-left"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Clock size={12} className="text-slate-500 shrink-0" />
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{r.description}</span>
                          </div>
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest shrink-0">{r.category}</span>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Real-time Math & FX Live Calculation Card */}
              {calcResult && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`mb-4 p-4 rounded-2xl border transition-all cursor-pointer ${
                    selectedIndex === 0 
                      ? 'bg-gradient-to-r from-emerald-500/15 via-indigo-500/15 to-purple-500/15 border-emerald-500/50 shadow-lg shadow-emerald-500/10' 
                      : 'bg-slate-800/40 border-slate-700/60 hover:border-slate-600'
                  }`}
                  onClick={() => copyCalcResult(calcResult.formattedResult)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        <Calculator size={18} />
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 flex items-center gap-1.5">
                          <Sparkles size={11} className="text-emerald-400" />
                          {calcResult.explanation || 'Calculation Result'}
                        </div>
                        <div className="text-xl font-black text-white font-mono tracking-tight mt-0.5">
                          {calcResult.formattedResult}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-slate-400 px-2 py-1 rounded-md bg-slate-900/60 border border-slate-700">
                        = {calcResult.expression}
                      </span>
                      <span className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-bold flex items-center gap-1 shadow-sm">
                        <Copy size={11} /> ⏎ COPY
                      </span>
                    </div>
                  </div>
                </motion.div>
              )}

              {Object.keys(categories).length === 0 && !calcResult ? (
                <EmptyState
                  variant="minimal"
                  type="no-results"
                  message="No matching commands found"
                />
              ) : (
                Object.entries(categories).map(([category, items]) => (
                  <div key={category} className="mb-6 last:mb-2">
                    <div className="flex items-center gap-2 px-4 mb-3">
                      {getCategoryIcon(category)}
                      <span className="text-[10px] font-black text-slate-500 dark:text-slate-500 uppercase tracking-widest">{category}</span>
                    </div>
                    <div className="space-y-1">
                      {items.map((item) => {
                        const index = (calcResult ? 1 : 0) + filtered.indexOf(item);
                        const isSelected = index === selectedIndex;
                        return (
                          <motion.button
                            key={item.description}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => {
                              const wrapper = trackedActions.get(item.description);
                              if (wrapper) wrapper();
                              onClose();
                            }}
                            className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl transition-all ${
                              isSelected ? 'bg-indigo-500/10 border border-indigo-500/30' : 'border border-transparent'
                            }`}
                          >
                            <div className="flex items-center gap-4">
                              <div className={`p-2 rounded-xl ${isSelected ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400' : 'bg-slate-100 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500'}`}>
                                <ArrowRight size={14} />
                              </div>
                              <span className={`text-sm font-bold ${isSelected ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>{item.description}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {isSelected && (
                                <span className="px-2 py-0.5 bg-indigo-600 text-white rounded-md text-[9px] font-bold font-mono shadow-sm animate-in fade-in mr-1">
                                  ⏎ RUN
                                </span>
                              )}
                              {item.ctrlKey && (
                                <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-md text-[9px] font-black text-slate-500 border border-slate-200 dark:border-slate-700">CTRL</span>
                              )}
                              {item.shiftKey && (
                                <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-md text-[9px] font-black text-slate-500 border border-slate-200 dark:border-slate-700">SHIFT</span>
                              )}
                              {item.altKey && (
                                <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-md text-[9px] font-black text-slate-500 border border-slate-200 dark:border-slate-700">ALT</span>
                              )}
                              <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-md text-[9px] font-black text-slate-500 border border-slate-200 dark:border-slate-700 uppercase">{item.key}</span>
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-950/50 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-[10px] font-black text-slate-500 dark:text-slate-600 uppercase tracking-widest">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5"><ArrowRight size={10} className="rotate-90" /> Navigate</span>
                <span className="flex items-center gap-1.5"><ArrowRight size={10} className="-rotate-90" /> Select</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Command size={10} /> Fast Command Mode Active
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default CommandPalette;
