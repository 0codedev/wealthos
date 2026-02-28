/**
 * backupManifest.ts
 * -----------------------------------------------------------------------------
 * SINGLE SOURCE OF TRUTH for what a WealthOS backup contains.
 *
 * Consumers (all of them, no exceptions):
 *   - services/BackupService.ts  -> JSON file export (optimized / full)
 *   - services/BackupService.ts  -> GCS cloud upload (multi-device sync)
 *
 * Philosophy: game-save discipline. A save file must capture every piece of
 * USER state needed to restore an identical experience on another device,
 * while excluding anything reconstructable (caches, static reference data,
 * derived analytics) and anything device-local/ephemeral (session tokens that
 * expire daily, sync queues, UI collapse flags).
 *
 * Dexie tables are discovered dynamically via `db.tables`, so new schema
 * versions are covered automatically. Only EXCLUSIONS are declared here.
 * -----------------------------------------------------------------------------
 */

export type BackupMode = 'optimized' | 'full';

export const BACKUP_FORMAT_VERSION = 3;

/**
 * Static reference datasets. Never backed up in ANY mode - they are re-fetched
 * from market data providers and are enormous (instruments alone is ~2k+ rows
 * of security master data, historical_data is multi-year OHLC candles).
 */
export const STATIC_REFERENCE_TABLES = [
    'historical_data',
    'instruments',
] as const;

/**
 * Caches, ML artifacts and derived analytics. Excluded from OPTIMIZED backups
 * because they can be recomputed from market data / retraining. Included in
 * FULL backups so "Full" means true device parity.
 */
export const RECONSTRUCTABLE_TABLES = [
    // Generic caches
    'cache',
    'candle_cache',
    'snapshots',
    'alphaSnapshots',
    // Telegram raw feeds (ear cache holds routing state only)
    'telegram_messages',
    'telegram_ear_cache',
    // ML training artifacts (retrainable)
    'rl_experiences',
    'ml_weights',
    'ml_models',
    // Broker mirrors (re-syncable from broker APIs)
    'broker_holdings_cache',
    'broker_positions_cache',
    // Derived feature/analytics history (recomputable scans)
    'watchlist_snapshots',
    'mce_feature_history',
    'market_day_features',
    'scan_candidates',
] as const;

/** Tables excluded for a given mode. */
export function getExcludedTables(mode: BackupMode): string[] {
    return mode === 'optimized'
        ? [...STATIC_REFERENCE_TABLES, ...RECONSTRUCTABLE_TABLES]
        : [...STATIC_REFERENCE_TABLES];
}

/**
 * Device-local / ephemeral localStorage keys. NEVER included in any backup:
 * they either expire within hours, are meaningless on another device, or
 * would cause duplicate side-effects after a restore.
 */
const EPHEMERAL_STORAGE_PATTERNS: RegExp[] = [
    // Backup/sync markers (rewritten locally after any restore)
    /^wealth-last-(backup|restore)-at$/,
    /^wealthos_last_sync_timestamp$/,
    /^wealth_crosstab_correlator_lock$/,
    // Daily/expiring markers
    /(_|^)(dismissed_date|last_brief_date|last_premarket_digest_date|last_proactive_check_date|last_tilt_alert|duel_model_time|snoozed_until)$/,
    /^morning_brief_dismissed_date$/,
    // Device pairing / bridge codes
    /^alpha_bridge_(pulse_|sector_)?code$/,
    // Live caches & session state
    /^dhan_cached_/,
    /^dhan_last_/,
    /^upstox_session_cache$/,
    /^upstox_blocker/,
    /^ambient_ai_cache$/,
    /^premarket_/,
    /^firebase/,
    // Offline mutation queue is device-local by design - restoring it on
    // another device would replay mutations twice.
    /^wealth_offline_mutation_queue/,
    // Short-lived handoff envelopes (60s TTL dedup envelopes)
    /^wealth-broker-execution-handoff$/,
    /^wealth-journal-review-handoff$/,
    // Ephemeral UI state
    /^(telegram_ai_summary|telegram_ear_sidebar)_collapsed$/,
    /^wa_cmd_palette_recent$/,
    /^foo-v9$/,
    /^oracle_usage_count$/,
    /^wealth_aggregator_onboarding$/,
];

export function isEphemeralStorageKey(key: string): boolean {
    return EPHEMERAL_STORAGE_PATTERNS.some((re) => re.test(key));
}

/**
 * Curated whitelist used by OPTIMIZED mode: every persistent user-state key
 * that exists in the app today. Absent keys are simply skipped at snapshot
 * time, so this list is safe to keep ahead of the codebase.
 *
 * FULL mode ignores this whitelist and snapshots EVERYTHING in localStorage
 * except EPHEMERAL keys - guaranteeing future keys are never forgotten.
 */
export const OPTIMIZED_STORAGE_KEYS: string[] = [
    // --- Core preferences ---
    'theme',
    'realized_ltcg_fy',
    'wealth-aggregator-logic',          // settingsStore persist
    'wealth-aggregator-settings',       // legacy settings blob (harmless if absent)
    'wealth_aggregator_preferences',    // UserPreferencesService
    'wealth_aggregator_transactions',   // TransactionContext
    'trading-journal-prefs',
    'category-rules-storage',
    'trading_rules_v1',
    'rebalance-targets',
    'rebalance_targets_v1',
    'wealth_journal_strict_mode',
    'wealth_privacy_mode',
    'wealth_privacy_level',
    'fnoFocusMode',
    'isSandboxMode',
    'enable_rvol_prefetch',
    'total_tax_saved',
    'wa:ux-mode',
    'wa:ux-density',
    'wealth-command-center-acknowledged',

    // --- Gamification / progression stores ---
    'wealth-aggregator-xp',
    'wealth-aggregator-mastery',
    'academy_completed_items',
    'academy_simulator_balance',
    'wealth_trading_challenge',

    // --- Zustand persist stores (added in parity sweep) ---
    'wealth-morning-momentum-storage',  // focus mode + Clean-Trend thresholds
    'wealth-guardrail-storage',
    'wealth-time-capsules',
    'wealthagg-alpha-stocks',
    'cosmic-governor-state',
    'wealth-voice-memory',
    'wealth-macro-regime',
    'wealthagg-lite-mode',
    'wealth_quantum_state_v1',

    // --- Alerts / intelligence ---
    'wealth-aggregator-alerts',
    'smart_watchlist_v2',
    'apex_strategies',
    'alpha_alert_config',
    'alpha_alert_history',
    'alpha_advanced_filters',
    'pnl_matrix_history',
    'jarvis_alerts_history',
    'financial_mistakes',
    'impulse_check_history',
    'boardroom_debate_history',
    'wealth_tilt_detector_state',
    'wealth_notifications_7d_v1',
    'telegram_trust_audit',

    // --- User content ---
    'advisor_chat_history',
    'advisor_report_data',
    'fortress_notes_v2',
    'fortress_hash',
    'fortress_dms_enabled',
    'fortress_timeout_days',
    'fortress_last_active',
    'secure_vault_docs',
    'vault_master_hash',
    'execution_desk_draft',
    'liability-vault-data',
    'ecas:pan',

    // --- Dashboard layout ---
    'dash_widget_order_v5',
    'dash_widget_spans_v2',
    'dash_hidden_widgets_v5',

    // --- Credentials & encryption (values get protection transform) ---
    'wealth-secure-broker-creds',
    'wealth-secure-external-api-keys',
    'wealth-secure-api-key',
    'wealth-secure-settings',
    'wealth-secure-user-data',
    'wealth-encryption-key-v3',
    'wealth-encryption-salt',
    'wealth_encryption_key',
    'wealth_auth_pin_hash',
    'wealth_biometric_lock_settings',
    'wealth-api-key-gemini',
    'wealth-api-key-groq',
    'wealth-api-key-openrouter',
    'wealth-api-key-mistral',
    'wealth-api-key-cerebras',
    'wealth-api-key-github',
    'wealth-api-key-cloudflare',
    'wealth-api-key-cohere',
    'wealth-api-key-telegrambot',
    'gemini-api-key',

    // --- Market Screener & Alpha Engine Bearer Tokens ---
    'stockezee_token',
    'tf_jwt_token',
    'tf_totp_secret',
    'tradefinder_jwt_token',
    'tradefinder_totp_secret',
    'upstox_access_token',
    'upstox_token_created_at',

    // --- Paper trader ---
    'wealth-aggregator-paper-trader',
];

/**
 * Credential-bearing localStorage keys that must ALSO travel through the
 * SyncEngine (VPS push/pull) path so a new device gets working AI providers
 * and active broker sessions after a pull - not just after a file restore.
 * These are encrypted at rest via SecurityService protection when snapshotted into backups.
 */
export const CREDENTIAL_STORAGE_KEYS: string[] = [
    'gemini-api-key',
    'wealth-api-key-gemini',
    'wealth-api-key-groq',
    'wealth-api-key-openrouter',
    'wealth-api-key-mistral',
    'wealth-api-key-cerebras',
    'wealth-api-key-github',
    'wealth-api-key-cloudflare',
    'wealth-api-key-cohere',
    'wealth-api-key-telegrambot',
    'stockezee_token',
    'tf_jwt_token',
    'tf_totp_secret',
    'tradefinder_jwt_token',
    'tradefinder_totp_secret',
    'upstox_access_token',
    'upstox_token_created_at',
];

/**
 * Raw localStorage snapshot for a mode. Returns ONLY keys that currently hold
 * a value. Ephemeral keys are filtered in both modes.
 */
export function collectRawStorageSnapshot(mode: BackupMode): Record<string, string> {
    const candidates =
        mode === 'full'
            ? new Set<string>([...OPTIMIZED_STORAGE_KEYS, ...Object.keys(localStorage)])
            : new Set<string>(OPTIMIZED_STORAGE_KEYS);

    const out: Record<string, string> = {};
    candidates.forEach((key) => {
        if (isEphemeralStorageKey(key)) return;
        let val: string | null = null;
        try {
            val = localStorage.getItem(key);
        } catch {
            return;
        }
        if (val !== null && val !== undefined) out[key] = val;
    });
    return out;
}
