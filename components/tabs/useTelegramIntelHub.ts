/**
 * CC40 — useTelegramIntelHub
 *
 * Encapsulates ALL cross-component state + side-effects for the Telegram
 * Intel Hub. The shell (`TelegramIntelHub.tsx`) just spreads the return
 * value into the JSX.
 *
 * What lives here:
 *   - ears / activeEarId / messages / searchQuery / filterType
 *   - AI summary state
 *   - thread expansion
 *   - settings modal data + open/close + save/refresh
 *   - OCR pending state + save/cancel handlers
 *   - ledger records + export
 *   - detail drawer + channel trust (persisted in localStorage)
 *   - WebSocket subscribe
 *   - all derived view-models (filteredMessages, viewMessages)
 *   - all callbacks (toggleStar, autofillOrder, handleSummarize, etc.)
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { telegramEarManager, EarStats, EarSummary } from '../../services/TelegramEarManager';
import { TelegramMessage, db, ParsedSignalRecord } from '../../database';
import { ParsedSignal as TelegramParsedSignal } from '../../services/TelegramSignalParser';
import { useToast } from '../shared/ToastProvider';
import type { OcrPending, DteDetails, JoinedChannel, DiscoveredChannel } from '../telegram';
import type { LedgerFilter, FilterType, ViewMessage } from './telegramHubTypes';

import { DhanScripResolver } from '../../services/DhanScripResolver';

const TRUSTED_CHANNELS_KEY = 'telegram_trusted_channels_v1';

export function useTelegramIntelHub() {
  const { toast } = useToast();

  // Initialize Dhan Scrip Master on mount
  useEffect(() => {
    DhanScripResolver.initialize();
  }, []);

  // Ears and statistics state
  const [ears, setEars] = useState<EarStats[]>([]);
  const [activeEarId, setActiveEarId] = useState<string>('premium_signals');
  const [messages, setMessages] = useState<TelegramMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [filterType, setFilterType] = useState<FilterType>('all');

  // AI Summary state
  const [summary, setSummary] = useState<EarSummary | null>(null);
  const [isSummarizing, setIsSummarizing] = useState<boolean>(false);

  // Thread tracking
  const [expandedThreads, setExpandedThreads] = useState<Record<number, boolean>>({});
  const [threadMessages, setThreadMessages] = useState<Record<number, TelegramMessage[]>>({});

  // Settings Modal data
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [earConfigs, setEarConfigs] = useState<any[]>([]);
  const [discoveredChannels, setDiscoveredChannels] = useState<DiscoveredChannel[]>([]);
  const [joinedChannels, setJoinedChannels] = useState<JoinedChannel[]>([]);
  const [isRefreshingChannels, setIsRefreshingChannels] = useState<boolean>(false);

  // Position Sizer state
  const [selectedSignalForSizing, setSelectedSignalForSizing] = useState<TelegramParsedSignal | null>(null);

  // OCR / Parsed signal state
  const [ledgerRecords, setLedgerRecords] = useState<ParsedSignalRecord[]>([]);
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>('ALL');
  const [pendingSignal, setPendingSignal] = useState<OcrPending | null>(null);
  const [showLedgerModal, setShowLedgerModal] = useState<boolean>(false);
  const [isSummaryCollapsed, setIsSummaryCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('telegram_ai_summary_collapsed') === 'true';
    } catch { return false; }
  });

  const toggleSummaryCollapse = useCallback(() => {
    setIsSummaryCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('telegram_ai_summary_collapsed', String(next));
      } catch (e) {
        console.warn(e);
      }
      return next;
    });
  }, []);

  // Detail drawer + channel trust
  const [detailMsg, setDetailMsg] = useState<TelegramMessage | null>(null);
  const [trustedChannels, setTrustedChannels] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(TRUSTED_CHANNELS_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  });

  // Cross-component refs (avoid WebSocket reconnect spam)
  const activeEarIdRef = useRef(activeEarId);
  const expandedThreadsRef = useRef(expandedThreads);

  useEffect(() => { activeEarIdRef.current = activeEarId; }, [activeEarId]);
  useEffect(() => { expandedThreadsRef.current = expandedThreads; }, [expandedThreads]);

  // Ledger
  const refreshLedger = useCallback(async () => {
    try {
      const all = await db.parsed_signal_records.orderBy('timestamp').reverse().limit(200).toArray();
      setLedgerRecords(all);
    } catch (e) { console.warn('Failed to load ledger', e); }
  }, []);
  useEffect(() => {
    refreshLedger();
    const handleRefresh = () => { refreshLedger(); };
    window.addEventListener('signal-ledger-refresh', handleRefresh);
    const t = setInterval(refreshLedger, 15000);
    return () => {
      window.removeEventListener('signal-ledger-refresh', handleRefresh);
      clearInterval(t);
    };
  }, [refreshLedger]);

  // Search debounce
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Ears
  const fetchEars = useCallback(async () => {
    try { setEars(await telegramEarManager.getEarStats()); } catch (e) { console.error(e); }
  }, []);
  useEffect(() => { fetchEars(); const i = setInterval(fetchEars, 10000); return () => clearInterval(i); }, [fetchEars]);

  // Messages
  const fetchMessages = useCallback(async () => {
    try {
      const fetched = await telegramEarManager.getMessages(activeEarId, { limit: 50, search: debouncedSearch });
      setMessages(fetched);
    } catch (err) { console.error('Error fetching messages', err); }
  }, [activeEarId, debouncedSearch]);
  useEffect(() => { 
    fetchMessages(); 
    const interval = setInterval(fetchMessages, 8000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  // WebSocket subscribe — the manager is an HMR-proof singleton, so we
  // connect exactly once (per page load) and NEVER disconnect on unmount.
  // React StrictMode double-mounts the effect, but `connect()` is
  // idempotent in the state machine, so the WS is opened exactly once.
  const loadThreadRef = useRef<(threadId: number) => Promise<void>>(async () => {});
  useEffect(() => {
    telegramEarManager.connect();

    const handleWakeup = () => {
      telegramEarManager.connect();
    };
    window.addEventListener('focus', handleWakeup);
    document.addEventListener('visibilitychange', handleWakeup);

    const unsubscribe = telegramEarManager.subscribe((msgEvent) => {
      fetchEars();
      if (msgEvent.earId === activeEarIdRef.current) {
        setMessages(prev => {
          if (prev.some(m => m.id === msgEvent.id)) return prev;
          const newMsg: TelegramMessage = {
            id: msgEvent.id, earId: msgEvent.earId,
            threadId: msgEvent.threadId, channelName: msgEvent.channelName,
            text: msgEvent.text,
            messageType: msgEvent.parsed ? 'PARSED_SIGNAL' : (msgEvent.earId === 'news_data' ? 'NEWS' : 'RAW'),
            parsedJson: msgEvent.parsed ? JSON.stringify(msgEvent.parsed) : undefined,
            confidence: msgEvent.parsed ? 0.9 : 0.0,
            receivedAt: msgEvent.timestamp || Date.now(),
            isStarred: 0,
            isLifecycle: msgEvent.type === 'LIFECYCLE_UPDATE' ? 1 : 0,
          };
          return [newMsg, ...prev];
        });
      }
      if (msgEvent.type === 'LIFECYCLE_UPDATE' && msgEvent.threadId && expandedThreadsRef.current[msgEvent.threadId]) {
        loadThreadRef.current(msgEvent.threadId);
      }
    });
    // NO `disconnect()` in cleanup. The WS lives for the app lifetime.
    return () => {
      window.removeEventListener('focus', handleWakeup);
      document.removeEventListener('visibilitychange', handleWakeup);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadThread = useCallback(async (threadId: number) => {
    try {
      const threadMsgs = await telegramEarManager.getThread(threadId);
      setThreadMessages(prev => ({ ...prev, [threadId]: threadMsgs }));
    } catch (e) { console.error('Error loading thread', e); }
  }, []);
  useEffect(() => { loadThreadRef.current = loadThread; }, [loadThread]);

  const toggleThread = useCallback(async (threadId: number) => {
    const isCurrentlyExpanded = !!expandedThreads[threadId];
    setExpandedThreads(prev => ({ ...prev, [threadId]: !isCurrentlyExpanded }));
    if (!isCurrentlyExpanded) await loadThread(threadId);
  }, [expandedThreads, loadThread]);

  const toggleStar = useCallback(async (msg: TelegramMessage) => {
    if (!msg.id) return;
    const newStarred = msg.isStarred === 1 ? 0 : 1;
    try {
      const success = await telegramEarManager.starMessage(msg.id, !!newStarred);
      if (success) {
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, isStarred: newStarred } : m));
        toast.success(newStarred ? 'Message starred' : 'Message unstarred');
      }
    } catch (e) { console.error('Failed to star', e); }
  }, [toast]);

  const autofillOrder = useCallback((msg: TelegramMessage) => {
    if (!msg.parsedJson) return;
    try {
      const parsed = typeof msg.parsedJson === 'object' ? msg.parsedJson : JSON.parse(msg.parsedJson);
      window.dispatchEvent(new CustomEvent('signal-autofill', { detail: { parsedSignal: parsed, provider: msg.channelName } }));
      toast.success(`Autofilled order for ${parsed.tradingSymbol}`);
    } catch (e) { console.error(e); }
  }, [toast]);

  // AI summary
  const handleSummarize = useCallback(async (q?: string) => {
    setIsSummarizing(true);
    setSummary(null);
    try {
      const result = await telegramEarManager.summarize(activeEarId, q);
      setSummary(result);
      toast.success('Summary generated');
    } catch { toast.error('AI summary failed. Check GROQ key.'); }
    finally { setIsSummarizing(false); }
  }, [activeEarId, toast]);

  // OCR / parsed signal save / cancel
  const handleSavePendingSignal = useCallback(async (markExecuted: boolean) => {
    if (!pendingSignal) return;
    try {
      const now = Date.now();
      const record: ParsedSignalRecord = {
        ...pendingSignal.record,
        timestamp: now,
        status: markExecuted ? 'EXECUTED' : 'PARSED',
        executedAt: markExecuted ? now : undefined,
      };
      await db.parsed_signal_records.add(record);
      toast.success(markExecuted ? 'Signal saved & marked EXECUTED' : 'Signal saved to ledger');
      setPendingSignal(null);
      await refreshLedger();
      if (markExecuted && record.parsed.tradingSymbol) {
        window.dispatchEvent(new CustomEvent('signal-autofill', { detail: { parsedSignal: record.parsed, provider: 'CC33-OCR' } }));
      }
    } catch (e) { console.error('Save failed', e); toast.error('Failed to save signal'); }
  }, [pendingSignal, refreshLedger, toast]);

  const handleCancelPendingSignal = useCallback(async () => {
    if (!pendingSignal) return;
    try { await db.parsed_signal_records.add({ ...pendingSignal.record, timestamp: Date.now(), status: 'CANCELLED' }); } catch (e) { console.warn(e); }
    setPendingSignal(null);
  }, [pendingSignal]);

  // Settings / refresh channels
  const openConfigSettings = useCallback(async () => {
    setShowSettings(true);
    try {
      const [stats, discovered, channels] = await Promise.all([
        telegramEarManager.getEarStats(),
        telegramEarManager.getDiscoveredChannels(),
        telegramEarManager.getJoinedChannels(),
      ]);
      setEarConfigs(stats);
      setDiscoveredChannels(discovered as DiscoveredChannel[]);
      setJoinedChannels(channels as JoinedChannel[]);
    } catch (e) { console.error(e); }
  }, []);

  const handleRefreshJoinedChannels = useCallback(async () => {
    setIsRefreshingChannels(true);
    try {
      toast.info('Refreshing channels list from Telegram...');
      const channels = await telegramEarManager.refreshJoinedChannels();
      setJoinedChannels(channels as JoinedChannel[]);
      toast.success(`Fetched ${channels.length} channels successfully.`);
    } catch { toast.error('Failed to refresh channels. Is the Telegram server running?'); }
    finally { setIsRefreshingChannels(false); }
  }, [toast]);

  const handleSaveConfig = useCallback(async (cfg: any[]) => {
    const success = await telegramEarManager.saveConfig(cfg);
    if (success) { setShowSettings(false); fetchEars(); }
    return success;
  }, [fetchEars]);

  // Export ledger
  const exportLedgerJson = useCallback(() => {
    try {
      const blob = new Blob([JSON.stringify(ledgerRecords, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `telegram-signal-ledger-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success('Ledger exported');
    } catch { toast.error('Export failed'); }
  }, [ledgerRecords, toast]);

  // Channel trust
  const handleTrustChannel = useCallback((channelName: string, trusted: boolean) => {
    setTrustedChannels(prev => {
      const next = new Set(prev);
      if (trusted) next.add(channelName); else next.delete(channelName);
      localStorage.setItem(TRUSTED_CHANNELS_KEY, JSON.stringify([...next]));
      return next;
    });
    toast.success(trusted ? `Trusted ${channelName}` : `Untrusted ${channelName}`);
  }, [toast]);

  // Menu / detail handlers
  const handleAddToJournal = useCallback((msg: TelegramMessage) => {
    toast.info(`Add to Journal: ${msg.channelName || 'message'} — coming soon`);
  }, [toast]);
  const handleOpenChart = useCallback((_msg: TelegramMessage) => {
    window.open(`https://www.tradingview.com/chart/`, '_blank');
  }, []);
  const handleCopyRaw = useCallback(async (msg: TelegramMessage) => {
    try { await navigator.clipboard.writeText(msg.text || ''); toast.success('Raw text copied'); }
    catch { toast.error('Copy failed'); }
  }, [toast]);
  const handleOpenDetail = useCallback((msg: TelegramMessage) => setDetailMsg(msg), []);

  // Filtering
  const filteredMessages = useMemo(() => messages.filter(msg => {
    if (filterType === 'starred') return msg.isStarred === 1;
    if (filterType === 'signals') return msg.messageType === 'PARSED_SIGNAL';
    if (filterType === 'news') return msg.messageType === 'NEWS';
    return true;
  }), [messages, filterType]);

  const activeEar = useMemo(() => ears.find(e => e.earId === activeEarId), [ears, activeEarId]);

  // Helpers
  const getNewsTags = useCallback((text: string) => {
    const tags: string[] = [];
    const t = text.toUpperCase();
    if (t.includes('RBI') || t.includes('POLICY') || t.includes('RATE')) tags.push('RBI');
    if (t.includes('FII') || t.includes('DII') || t.includes('FLOW')) tags.push('FLOWS');
    if (t.includes('GDP') || t.includes('INFLATION') || t.includes('CPI')) tags.push('MACRO');
    if (t.includes('EARNING') || /Q[1-4]|RESULT/.test(t)) tags.push('EARNINGS');
    if (tags.length === 0) tags.push('GENERAL');
    return tags;
  }, []);

  const getExpiryDteDetails = useCallback((expiryDateStr?: string): DteDetails | null => {
    if (!expiryDateStr) return null;
    const expiry = new Date(expiryDateStr); expiry.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dte = Math.ceil((expiry.getTime() - today.getTime()) / 86_400_000);
    if (dte < 0) return { label: 'Expired', class: 'dteExpired' };
    if (dte === 0) return { label: 'Expiring Today', class: 'dteToday' };
    if (dte <= 2) return { label: `${dte} DTE`, class: 'dteDanger' };
    if (dte <= 7) return { label: `${dte} DTE`, class: 'dteWarning' };
    return { label: `${dte} DTE`, class: 'dteNormal' };
  }, []);

  // Map messages to view-model props
  const viewMessages: ViewMessage[] = useMemo(() => filteredMessages.map(msg => {
    let parsed: TelegramParsedSignal | null = null;
    if (msg.parsedJson) {
      if (typeof msg.parsedJson === 'object') {
        parsed = msg.parsedJson;
      } else {
        try { parsed = JSON.parse(msg.parsedJson); } catch { /* ignore */ }
      }
    }
    const isSignal = !!(msg.messageType === 'PARSED_SIGNAL' && parsed);
    const isNews = msg.messageType === 'NEWS';
    return {
      msg, parsed, isSignal, isNews,
      earColor: activeEar?.color,
      dteDetails: isSignal ? getExpiryDteDetails(parsed!.expiryDate) : null,
      newsTags: isNews ? getNewsTags(msg.text) : [],
    };
  }), [filteredMessages, activeEar, getExpiryDteDetails, getNewsTags]);

  return {
    // State
    ears, activeEarId, messages, searchQuery, filterType,
    summary, isSummarizing,
    expandedThreads, threadMessages,
    showSettings, earConfigs, discoveredChannels, joinedChannels, isRefreshingChannels,
    selectedSignalForSizing,
    ledgerRecords, ledgerFilter, pendingSignal,
    detailMsg, trustedChannels,
    showLedgerModal,
    isSummaryCollapsed,
    // Derived
    activeEar, filteredMessages, viewMessages,
    // Setters
    setActiveEarId, setSearchQuery, setFilterType,
    setSelectedSignalForSizing, setDetailMsg,
    setPendingSignal, setShowSettings, setLedgerFilter,
    setShowLedgerModal,
    // Handlers
    toggleThread, toggleStar, autofillOrder,
    handleSummarize, handleSavePendingSignal, handleCancelPendingSignal,
    openConfigSettings, handleRefreshJoinedChannels, handleSaveConfig,
    exportLedgerJson, handleTrustChannel,
    handleAddToJournal, handleOpenChart, handleCopyRaw, handleOpenDetail,
    toggleSummaryCollapse,
  };
}
