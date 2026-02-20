
/**
 * Global App Copy Library
 * Centralized source for all user-facing strings, error messages, and empty states.
 *
 * Voice rules (CC50):
 *  - Second person, present tense, <= 12 words.
 *  - Calm errors (no "Oops!", no exclamation on errors).
 *  - One emoji per success message, none on errors.
 *  - Action-oriented: every error has a "Try again" or "Learn more" path.
 *
 * Naming: COPY.<surface>.<state>.<key>
 */

export const COPY = {
  // ----- Legacy / pre-existing categories (preserved verbatim) -----
  errors: {
    networkFailed: "Couldn't connect right now. Your data is safe offline. 🔌",
    brokerTokenExpired: "Your broker session has expired. Re-connect to see live data.",
    portfolioLoadFailed: "We hit a snag loading your portfolio. Pull down to refresh.",
    tradeSubmitFailed: "Trade couldn't be saved. Check your entries and try again.",
    aiTimeout: "Jarvis is thinking a bit slow today. Try again in a moment. 🤔",
    generic: "Something didn't go as planned. We're on it.",
  },
  empty: {
    noTrades: "No trades yet. Add your first trade to start tracking your performance. 📈",
    noHoldings: "Your portfolio is empty. Add your first investment to get started.",
    noJournalEntries: "No journal entries yet. Start reflecting on your trades.",
    noAlerts: "No alerts set. Configure alerts to stay ahead of market moves.",
    noIPOs: "No upcoming IPOs right now. Check back soon.",
    noSignals: "No signals added yet. Paste a trading signal to analyze it.",
    noAchievements: "No achievements unlocked yet. Keep trading to earn your first badge! 🏆",
    searchNoResults: (query: string) => `No results for "${query}". Try a different search.`,
  },
  toasts: {
    nav: {
      refreshSuccess: (n: number) => `Refreshed NAV for ${n} fund${n === 1 ? '' : 's'}.`,
      refreshPartial: (ok: number, total: number) =>
        `Refreshed ${ok} of ${total} funds. ${total - ok} failed.`,
      refreshFailed: 'Could not refresh NAV. Service may be offline.',
    },
    noActiveSIPs: 'No active SIPs found.',
    noHoldingsFound: 'No holdings found in your DhanHQ account.',
    noExecutedTrades: 'No executed trades found for the selected date on DhanHQ.',
    noMatchesFound: 'No matches found. Run "Full Dhan Import" first to link holdings.',
    noAccount: 'No account found with this email.',
    noAllottedApps: 'No allotted applications found to realize.',
    noLegacyWatchlist: 'No legacy watchlist items found.',
    nothingToArchive: 'No existing trade found for this ticker to archive to.',
    validQtyPriceRequired: 'Valid quantity and price are required.',
    validQtyRequired: 'Valid quantity required.',
    validLimitPriceRequired: 'Valid limit price required.',
    validOrderDetailsRequired: 'Valid order details are required.',
    dhanNotConfigured: 'DhanHQ not configured. Please link in integrations.',
    dhanNotConfiguredShort: 'Dhan credentials not configured.',
    preflightBlocking: 'Preflight found blocking issues. Review before sending the order.',
    sniperPreflightBlocking: 'Sniper preflight found blocking issues.',
    freshPreflight: 'Run a fresh pre-trade check before confirming this order.',
    freshSniperPreflight: 'Run a fresh sniper preflight before firing this order.',
    orderPlaced: (qty: string | number, ticker: string) => `Order placed for ${qty} ${ticker}!`,
    sniperFired: 'Sniper Order Fired! (Entry + Target + SL)',
    titleAndLessonRequired: 'Please enter a title and a lesson learned.',
    mistakeSaved: 'Saved.',
    mistakeRemoved: 'Mistake removed.',
    mistakeSaveFailed: 'Failed to save mistake.',
    mistakeDeleteFailed: 'Failed to delete mistake.',
    insufficientFunds: (required: string, available: string) =>
      `Insufficient funds. Required: ₹${required}, Available: ₹${available}`,
    positionOpened: (type: string, qty: string | number, ticker: string, price: string) =>
      `Position opened: ${type} ${qty} shares of ${ticker} at ₹${price}`,
    paperTradeFailed: 'Failed to execute paper trade.',
    positionClosedProfit: (pnl: string) => `Position closed! Profit: +₹${pnl}. Earned +25 XP!`,
    positionClosedLoss: (pnl: string) => `Position closed. Loss: -₹${pnl}`,
    positionCloseFailed: 'Failed to close position.',
    simulatorReset: 'Simulator reset complete.',
    simulatorResetFailed: 'Failed to reset simulator.',
    lessonCompleted: (xp: string | number) => `Lesson Completed! +${xp} XP`,
    pricesUpdated: (count: number, source: string) => `Updated ${count} asset(s) with ${source}.`,
    syncComplete: (updated: number, added: number) => `Sync Complete: Updated ${updated}, Added ${added} new.`,
    importedLegacy: (n: number) => `Imported ${n} symbol(s) from legacy watchlist.`,
    sniperOrderPlaced: (action: string, qty: string | number, ticker: string) =>
      `${action} order placed for ${qty} ${ticker}!`,
  },

  loading: {
    portfolio: "Loading your portfolio...",
    marketData: "Fetching live market data...",
    aiAnalysis: "Jarvis is analyzing your portfolio... ✨",
    backtest: "Running backtest simulation...",
  },
  confirmations: {
    // Top-10 #2 — soft-delete is recoverable. Confirmation copy is no
    // longer shown in the one-step UX (toast is the affordance), but some
    // legacy flows still read it.
    deleteTrade: "Remove this trade?",
    deleteInvestment: "Remove this investment from your portfolio?",
    clearJournal: "Clear all journal entries? This is permanent.",
    logout: "Sign out of Wealth Dashboard?",
  },
  undo: {
    investmentDeleted: (label: string) => `${label} moved to trash.`,
    tradeDeleted: (label: string) => `${label} trade removed.`,
    mistakeDeleted: (label: string) => `"${label}" forgotten.`,
    restored: (label: string) => `${label} restored.`,
    failed: "Could not complete that action.",
    recentlyDeletedMoved: "Moved to Recently Deleted.",
  },
  recentlyDeleted: {
    title: "Recently Deleted",
    empty: "Nothing in the trash.",
    restore: "Restore",
    permanentDelete: "Delete forever",
    confirmPermanent: (label: string) => `Permanently delete "${label}"? This cannot be undone.`,
    permanentDeleted: (label: string) => `${label} permanently deleted.`,
    ago: (human: string) => `${human} ago`,
  },
  network: {
    banner: {
      title: 'Offline',
      subtitle: 'Showing local data. Cloud sync paused.',
    },
    pill: 'You are offline',
    backOnline: 'Back online — resuming live data.',
    offlineBlocked: (action: string) => `${action} is offline — will retry when online.`,
    offlineNoCache: 'No cached data — connect to refresh.',
  },
  success: {
    tradeSaved: "Trade recorded! 📝",
    investmentAdded: "Investment added to your portfolio.",
    goalReached: (goalName: string) => `You've reached your ${goalName} goal! 🎉`,
    backupComplete: "Portfolio backed up successfully.",
  },

  // ----- New categories added by CC50 (premium polish pillar 3B) -----

  // state.* — verb-first, present-tense status messages
  state: {
    loading: "Loading…",
    syncing: "Syncing latest data…",
    analyzing: "Analyzing market conditions…",
    backtesting: "Running your backtest…",
    aiThinking: "Jarvis is thinking…",
    fetchingQuotes: "Fetching live quotes…",
    calculating: "Calculating values…",
    saving: "Saving your changes…",
  },

  // sequences.* — multi-step loading copy. Each is an array to drive a
  // step-by-step progress indicator without making callers re-define them.
  sequences: {
    backtest: [
      "Gathering historical candles…",
      "Walking through each trading day…",
      "Computing risk-adjusted returns…",
      "Preparing your results…",
    ],
    rebalance: [
      "Analyzing current allocation…",
      "Comparing against target weights…",
      "Generating trade plan…",
      "Ready to execute…",
    ],
    ocr: [
      "Reading the screenshot…",
      "Detecting broker format…",
      "Extracting trade fields…",
      "Cross-checking against your portfolio…",
    ],
  },

  // errorsWithAction.* — every error has a title, detail, and CTA.
  // Titles are calm, no exclamation points, no "Oops!".
  errorsWithAction: {
    network: {
      title: "Connection is offline",
      detail: "We can't reach our servers right now. Your data is safe.",
      cta: "Try again",
    },
    brokerToken: {
      title: "Broker session expired",
      detail: "Reconnect your broker to see live prices again.",
      cta: "Reconnect",
    },
    portfolioLoad: {
      title: "Portfolio didn't load",
      detail: "We hit a snag fetching your investments.",
      cta: "Try again",
    },
    tradeSubmit: {
      title: "Trade didn't save",
      detail: "Check your entries and try again.",
      cta: "Try again",
    },
    aiTimeout: {
      title: "Jarvis is taking a moment",
      detail: "Our AI is slower than usual right now.",
      cta: "Try again",
    },
    backtestFailed: {
      title: "Backtest couldn't finish",
      detail: "Some market data is missing for that window.",
      cta: "Learn more",
    },
    ocrFailed: {
      title: "Couldn't read the screenshot",
      detail: "Try a sharper image or enter the trade manually.",
      cta: "Enter manually",
    },
    generic: {
      title: "Something didn't go as planned",
      detail: "We're already looking into it.",
      cta: "Try again",
    },
  },

  // help.* — About / Help drawer copy (CC50 deliverable)
  help: {
    drawerTitle: "Help & Resources",
    tour: "Restart product tour",
    shortcuts: "Keyboard shortcuts",
    about: "About this app",
    changelog: "Changelog",
    reportBug: "Report a bug",
    restartTourConfirm: "Restart the product tour from the beginning?",
    restartTourDone: "Tour reset. Reloading…",
  },

  // dashboard.* — high-traffic dashboard strings consolidated
  dashboard: {
    welcomeBack: (firstName: string) => `Welcome back, ${firstName}.`,
    netWorth: "Net worth",
    todayPnl: "Today's P&L",
    allTimePnl: "All-time P&L",
    quickActions: "Quick actions",
    addTrade: "Add trade",
    addInvestment: "Add investment",
    refreshAll: "Refresh all",
  },

  // ai.* — strings shared by the AI Command Hub and Jarvis surfaces
  ai: {
    askAnything: "Ask Jarvis anything about your portfolio…",
    thinking: "Thinking…",
    listening: "Listening…",
    speaking: "Speaking…",
    voiceUnavailable: "Voice isn't available right now. Type your request instead.",
  },

  // journal.* — journal tab copy
  journal: {
    addEntry: "Add journal entry",
    filterBy: "Filter by tag",
    sortBy: "Sort by",
    noEntriesFor: (filter: string) => `No journal entries match "${filter}".`,
  },

  // portfolio.* — portfolio copy
  portfolio: {
    addAsset: "Add asset",
    holdings: "Holdings",
    allocation: "Allocation",
    performance: "Performance",
    hiddenFromTotals: "Hidden from totals",
  },

  // firstRun.* — first-run demo + guided critical path (Top-10 #1)
  firstRun: {
    gate: {
      eyebrow: 'Welcome',
      title: 'How would you like to start?',
      subtitle: 'Wealth Aggregator Pro is a self-hosted finance OS. Pick one — you can switch any time.',
      importCta: 'Import my broker data',
      importHint: 'Connect Dhan, Upstox, or paste a broker CSV.',
      demoCta: 'Try with demo data',
      demoHint: '5 holdings, 8 trades, 1 goal. Watermarked "Demo".',
      emptyCta: 'Start empty',
      emptyHint: 'Begin with a blank canvas. Add what you want, when you want.',
    },
    pill: {
      label: (n: number) => `Demo mode · ${n} demo row${n === 1 ? '' : 's'}`,
      clearTitle: 'Clear demo data?',
      clearBody: 'This soft-deletes the demo holdings, trades, journal entries, and goal. Your real data stays. Undo for 30 seconds.',
      clearConfirm: 'Clear demo',
      clearCancel: 'Keep demo',
    },
    toasts: {
      demoLoaded: (h: number, t: number, g: number) =>
        `Demo loaded · ${h} holdings, ${t} trades, ${g} goal${g === 1 ? '' : 's'} 🪁`,
      demoCleared: 'Demo data cleared. Undo for 30s.',
      demoRestored: 'Demo data restored.',
      blocked: (action: string) => `Demo mode active — ${action} is blocked. Clear demo to continue.`,
    },
    criticalPath: {
      eyebrow: 'Critical path',
      step1Title: 'Import your data',
      step1Body: 'Bring in your broker holdings to see your real net worth.',
      step2Title: 'Log your first trade',
      step2Body: 'Add a trade so your journal and analytics have something to chew on.',
      step3Title: 'Reflect in your journal',
      step3Body: 'A 60-second reflection now pays off in 6 months. Open the Journal tab.',
      step4Title: "You're set",
      step4Body: 'Wealth Aggregator Pro is yours now. Trade well.',
      nextCta: 'Next',
      doneCta: 'Finish',
      skipCta: 'Skip for now',
    },
  },
} as const;

export type CopyShape = typeof COPY;
