/**
 * Jarvis Voice Navigation — Semantic Command Set
 *
 * Owner: Agent CC11 — Ambient AI Command Center & Voice Jarvis V2
 *
 * Replaces the old per-keyword `if/else` chain in `JarvisCommandService`
 * with a small, declarative command registry. Each entry is:
 *
 *   - `patterns`: array of phrases, each with a list of "tokens" (lowercase
 *     word-stems) that must ALL be present in the user's transcript. This
 *     is more flexible than a literal match.
 *   - `slots`: optional list of "capture" words that, if present, get
 *     extracted into `payload` for downstream actions.
 *   - `type` + `payload`: the JarvisAction.
 *   - `response`: spoken reply.
 *
 * Adding a new command = adding one entry, no parser code change.
 *
 * Phrases can include the special `{slot:index}` and `{slot:ticker}` markers
 * for the natural-language commands listed in the spec:
 *   "Show me Nifty Options for tomorrow"
 *   "Add a BUY order for 100 shares of Reliance"
 *   "Generate my monthly trading mistakes report"
 */
import type { JarvisAction } from './JarvisCommandService';

export interface JarvisPhrase {
    tokens: string[];                              // must all appear in the transcript (order-independent)
    slots?: Array<{ key: string; match: RegExp }>; // extract {key} placeholders into payload
}

export interface JarvisCommand {
    id: string;
    type: JarvisAction['type'];
    payload?: string;
    response: string;
    phrases: JarvisPhrase[];
    _dynamicResponse?: () => string;
}

// ============================================================
// SEMANTIC COMMAND REGISTRY
// ============================================================

export const JARVIS_COMMANDS: JarvisCommand[] = [
    // ============== NAVIGATION ==============
    {
        id: 'nav.dashboard',
        type: 'NAVIGATE', payload: 'dashboard',
        response: 'Opening Dashboard.',
        phrases: [{ tokens: ['dashboard'] }, { tokens: ['home'] }, { tokens: ['main', 'screen'] }, { tokens: ['overview'] }]
    },
    {
        id: 'nav.portfolio',
        type: 'NAVIGATE', payload: 'portfolio',
        response: 'Accessing Portfolio.',
        phrases: [{ tokens: ['portfolio'] }, { tokens: ['investments'] }, { tokens: ['holdings'] }, { tokens: ['my', 'stocks'] }, { tokens: ['my', 'assets'] }]
    },
    {
        id: 'nav.market',
        type: 'NAVIGATE', payload: 'market',
        response: 'Loading Market Intelligence.',
        phrases: [{ tokens: ['market'] }, { tokens: ['market', 'intel'] }, { tokens: ['macro', 'pulse'] }, { tokens: ['sector', 'rotation'] }]
    },
    {
        id: 'nav.ipo',
        type: 'NAVIGATE', payload: 'ipo',
        response: 'Opening IPO War Room.',
        phrases: [{ tokens: ['ipo'] }, { tokens: ['ipo', 'war', 'room'] }, { tokens: ['initial', 'public', 'offering'] }, { tokens: ['new', 'listings'] }]
    },
    {
        id: 'nav.journal',
        type: 'NAVIGATE', payload: 'journal',
        response: 'Opening Trading Journal.',
        phrases: [{ tokens: ['journal'] }, { tokens: ['trading', 'journal'] }, { tokens: ['trade', 'log'] }, { tokens: ['trades'] }, { tokens: ['psychology'] }]
    },
    {
        id: 'nav.growth',
        type: 'NAVIGATE', payload: 'growth',
        response: 'Loading Growth Engine.',
        phrases: [{ tokens: ['growth'] }, { tokens: ['alpha', 'predator'] }, { tokens: ['insider'] }, { tokens: ['bulk', 'deals'] }]
    },
    {
        id: 'nav.life',
        type: 'NAVIGATE', payload: 'portfolio',
        response: 'Opening Life Planner.',
        phrases: [{ tokens: ['life', 'planner'] }, { tokens: ['retirement'] }, { tokens: ['legacy'] }, { tokens: ['planning'] }]
    },
    {
        id: 'nav.gps',
        type: 'NAVIGATE', payload: 'gps',
        response: 'Opening Goal GPS.',
        phrases: [{ tokens: ['goals'] }, { tokens: ['goal', 'gps'] }, { tokens: ['financial', 'goals'] }, { tokens: ['target'] }]
    },
    {
        id: 'nav.settings',
        type: 'NAVIGATE', payload: 'settings',
        response: 'Opening Settings.',
        phrases: [{ tokens: ['settings'] }, { tokens: ['preferences'] }, { tokens: ['configuration'] }]
    },

    // ============== PROFILE SWITCHING ==============
    {
        id: 'profile.mom',
        type: 'SWITCH_PROFILE', payload: 'MOM',
        response: "Switching to Mom's profile.",
        phrases: [{ tokens: ['mom'] }, { tokens: ['mother'] }, { tokens: ['moms', 'account'] }]
    },
    {
        id: 'profile.spouse',
        type: 'SWITCH_PROFILE', payload: 'SPOUSE',
        response: "Switching to Spouse's profile.",
        phrases: [{ tokens: ['spouse'] }, { tokens: ['wife'] }, { tokens: ['husband'] }, { tokens: ['partner'] }]
    },
    {
        id: 'profile.kids',
        type: 'SWITCH_PROFILE', payload: 'KIDS',
        response: 'Switching to Kids Trust.',
        phrases: [{ tokens: ['kids'] }, { tokens: ['children'] }, { tokens: ['child', 'account'] }, { tokens: ['kids', 'trust'] }]
    },
    {
        id: 'profile.huf',
        type: 'SWITCH_PROFILE', payload: 'HUF',
        response: 'Switching to HUF Account.',
        phrases: [{ tokens: ['huf'] }, { tokens: ['family', 'trust'] }]
    },
    {
        id: 'profile.self',
        type: 'SWITCH_PROFILE', payload: 'SELF',
        response: 'Switching to your personal portfolio.',
        phrases: [{ tokens: ['my', 'portfolio'] }, { tokens: ['my', 'account'] }, { tokens: ['self'] }, { tokens: ['personal'] }, { tokens: ['back', 'to', 'me'] }]
    },
    {
        id: 'profile.all',
        type: 'SWITCH_PROFILE', payload: 'ALL',
        response: 'Switching to Family Office view.',
        phrases: [{ tokens: ['family', 'office'] }, { tokens: ['all', 'accounts'] }, { tokens: ['family', 'view'] }, { tokens: ['aggregated', 'view'] }]
    },

    // ============== DATA QUERIES ==============
    {
        id: 'query.networth',
        type: 'QUERY_DATA', payload: 'NET_WORTH',
        response: 'Calculating your net worth…',
        phrases: [{ tokens: ['net', 'worth'] }, { tokens: ['total', 'value'] }, { tokens: ['how', 'much'] }, { tokens: ['balance'] }, { tokens: ['status', 'report'] }]
    },
    {
        id: 'query.xirr',
        type: 'QUERY_DATA', payload: 'XIRR',
        response: 'Fetching your XIRR…',
        phrases: [{ tokens: ['xirr'] }, { tokens: ['returns'] }, { tokens: ['performance'] }, { tokens: ['how', 'am', 'i', 'doing'] }]
    },
    {
        id: 'query.top',
        type: 'QUERY_DATA', payload: 'TOP_PERFORMER',
        response: 'Finding your top performer…',
        phrases: [{ tokens: ['top', 'performer'] }, { tokens: ['best', 'stock'] }, { tokens: ['best', 'investment'] }, { tokens: ['highest', 'gainer'] }]
    },
    {
        id: 'query.worst',
        type: 'QUERY_DATA', payload: 'WORST_PERFORMER',
        response: 'Finding your worst performer…',
        phrases: [{ tokens: ['worst', 'performer'] }, { tokens: ['biggest', 'loser'] }, { tokens: ['worst', 'stock'] }, { tokens: ['lowest'] }]
    },
    {
        id: 'query.dividends',
        type: 'QUERY_DATA', payload: 'DIVIDENDS',
        response: 'Calculating dividend income…',
        phrases: [{ tokens: ['dividends'] }, { tokens: ['dividend', 'income'] }, { tokens: ['passive', 'income'] }]
    },

    // ============== MODAL TRIGGERS ==============
    {
        id: 'modal.add_investment',
        type: 'OPEN_MODAL', payload: 'ADD_INVESTMENT',
        response: 'Opening Add Investment form.',
        phrases: [{ tokens: ['add', 'investment'] }, { tokens: ['add', 'stock'] }, { tokens: ['add', 'asset'] }, { tokens: ['new', 'investment'] }, { tokens: ['buy'] }]
    },
    {
        id: 'modal.add_sip',
        type: 'OPEN_MODAL', payload: 'ADD_SIP',
        response: "Let's set up a new SIP.",
        phrases: [{ tokens: ['add', 'sip'] }, { tokens: ['new', 'sip'] }, { tokens: ['start', 'sip'] }, { tokens: ['systematic', 'investment'] }]
    },
    {
        id: 'modal.export',
        type: 'OPEN_MODAL', payload: 'EXPORT',
        response: 'Opening export options.',
        phrases: [{ tokens: ['export'] }, { tokens: ['download', 'data'] }, { tokens: ['backup'] }, { tokens: ['save', 'data'] }]
    },
    {
        id: 'modal.mistake_report',
        type: 'OPEN_MODAL', payload: 'MISTAKE_REPORT',
        response: 'Generating your monthly mistakes report.',
        phrases: [{ tokens: ['mistake', 'report'] }, { tokens: ['mistakes', 'report'] }, { tokens: ['monthly', 'mistakes'] }, { tokens: ['error', 'analysis'] }]
    },
    {
        id: 'modal.options_chain',
        type: 'OPEN_MODAL', payload: 'OPTIONS_CHAIN',
        response: 'Loading the options chain.',
        // Slot capture: optional {index} and {when} (tomorrow / next week / etc.)
        phrases: [
            {
                tokens: ['nifty', 'options'],
                slots: [{ key: 'index', match: /\b(nifty|nifty\s*50)\b/i }, { key: 'when', match: /\b(today|tomorrow|next\s*week|this\s*week|expiry)\b/i }]
            },
            {
                tokens: ['banknifty', 'options'],
                slots: [{ key: 'index', match: /\b(banknifty|bank\s*nifty)\b/i }, { key: 'when', match: /\b(today|tomorrow|next\s*week|expiry)\b/i }]
            },
            {
                tokens: ['fin', 'nifty', 'options'],
                slots: [{ key: 'index', match: /\b(fin\s*nifty|finnifty)\b/i }, { key: 'when', match: /\b(today|tomorrow|expiry)\b/i }]
            },
            { tokens: ['options', 'chain'] },
            { tokens: ['option', 'chain'] }
        ]
    },
    {
        id: 'modal.order',
        type: 'OPEN_MODAL', payload: 'ORDER',
        response: 'Preparing the order ticket.',
        // Natural-language: "Add a BUY order for 100 shares of Reliance"
        phrases: [
            {
                tokens: ['buy', 'order', 'shares'],
                slots: [
                    { key: 'side', match: /\b(buy|sell)\b/i },
                    { key: 'quantity', match: /\b(\d{1,6})\b/ },
                    { key: 'symbol', match: /\bof\s+([a-z0-9&\-\.]+)/i }
                ]
            },
            {
                tokens: ['buy', 'order'],
                slots: [
                    { key: 'side', match: /\b(buy|sell)\b/i },
                    { key: 'quantity', match: /\b(\d{1,6})\b/ },
                    { key: 'symbol', match: /\bof\s+([a-z0-9&\-\.]+)/i }
                ]
            },
            { tokens: ['place', 'order'] }
        ]
    },

    // ============== TOGGLES ==============
    {
        id: 'toggle.privacy',
        type: 'TOGGLE_PRIVACY',
        response: 'Toggling privacy mode.',
        phrases: [{ tokens: ['privacy'] }, { tokens: ['hide', 'numbers'] }, { tokens: ['show', 'numbers'] }, { tokens: ['toggle', 'privacy'] }]
    },
    {
        id: 'toggle.theme',
        type: 'TOGGLE_THEME',
        response: 'Switching theme.',
        phrases: [{ tokens: ['dark', 'mode'] }, { tokens: ['light', 'mode'] }, { tokens: ['toggle', 'theme'] }, { tokens: ['change', 'theme'] }]
    },

    // ============== REFRESH ==============
    {
        id: 'refresh.data',
        type: 'REFRESH_DATA',
        response: 'Refreshing all data streams.',
        phrases: [{ tokens: ['refresh'] }, { tokens: ['update'] }, { tokens: ['sync'] }, { tokens: ['reload', 'data'] }]
    },

    // ============== CONVERSATIONAL ==============
    {
        id: 'speak.greeting',
        type: 'SPEAK',
        response: '', // Computed at match-time
        phrases: [{ tokens: ['hello'] }, { tokens: ['hi', 'jarvis'] }, { tokens: ['hey', 'jarvis'] }, { tokens: ['good', 'morning'] }, { tokens: ['good', 'evening'] }],
        _dynamicResponse: () => {
            const h = new Date().getHours();
            return h < 12 ? 'Good morning! Online and ready to assist.' : h < 18 ? 'Good afternoon! Online and ready.' : 'Good evening! Online and ready to assist.';
        }
    },
    {
        id: 'speak.status',
        type: 'SPEAK',
        response: 'Online and monitoring your portfolio.',
        phrases: [{ tokens: ['status'] }, { tokens: ['are', 'you', 'there'] }, { tokens: ['jarvis'] }]
    },
    {
        id: 'speak.help',
        type: 'SPEAK',
        response: 'I can navigate to any section, show your net worth, XIRR, top performers, add investments, toggle privacy mode, and more. Just ask!',
        phrases: [{ tokens: ['help'] }, { tokens: ['what', 'can', 'you', 'do'] }, { tokens: ['commands'] }]
    },
    {
        id: 'speak.thanks',
        type: 'SPEAK',
        response: "You're welcome! Happy to help.",
        phrases: [{ tokens: ['thank', 'you'] }, { tokens: ['thanks', 'jarvis'] }, { tokens: ['great', 'job'] }]
    }
];

// ============================================================
// MATCHER
// ============================================================

/**
 * Returns the matched command and the captured slots (if any), or null.
 *
 * Matching is order-independent at the token level: a phrase "buy order shares"
 * matches transcripts "shares buy order" or "order to buy me some shares".
 * The first command in the registry that has any matching phrase wins.
 *
 * For slot capture, the matcher pulls the first match of each slot's regex
 * from the *original* transcript (case-insensitive).
 */
export function matchJarvisCommand(transcript: string): { command: JarvisCommand; slots: Record<string, string> } | null {
    const lower = transcript.toLowerCase().trim();
    if (!lower) return null;

    for (const cmd of JARVIS_COMMANDS) {
        for (const phrase of cmd.phrases) {
            const tokensPresent = phrase.tokens.every(t => lower.includes(t));
            if (!tokensPresent) continue;

            const slots: Record<string, string> = {};
            if (phrase.slots) {
                for (const s of phrase.slots) {
                    const m = transcript.match(s.match);
                    if (m) slots[s.key] = (m[1] || m[0]).trim();
                }
            }

            // Use the dynamic response generator if present
            const dyn = (cmd as any)._dynamicResponse;
            if (typeof dyn === 'function') {
                (cmd as any).response = dyn();
            }

            return { command: cmd, slots };
        }
    }
    return null;
}

/**
 * Convenience: produces a JarvisAction directly from a transcript.
 * The semantic command is also stamped into the response so the user
 * sees what Jarvis interpreted.
 */
export function interpretJarvisTranscript(transcript: string): { action: JarvisAction; matchedId: string; slots: Record<string, string> } | null {
    const match = matchJarvisCommand(transcript);
    if (!match) return null;

    const cmd = match.command;
    const slotText = Object.keys(match.slots).length
        ? ' (slots: ' + Object.entries(match.slots).map(([k, v]) => `${k}=${v}`).join(', ') + ')'
        : '';

    return {
        action: {
            type: cmd.type,
            payload: cmd.payload,
            response: cmd.response + slotText
        },
        matchedId: cmd.id,
        slots: match.slots
    };
}
