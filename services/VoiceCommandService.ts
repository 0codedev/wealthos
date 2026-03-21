/**
 * VoiceCommandService - Voice-controlled portfolio management
 * Covers: Natural language commands, speech recognition, voice feedback
 */

// ==================== COMMAND TYPES ====================

export type VoiceCommandType =
    | 'add_investment'
    | 'check_portfolio'
    | 'set_alert'
    | 'ask_advisor'
    | 'navigate'
    | 'search'
    | 'unknown';

export interface ParsedCommand {
    type: VoiceCommandType;
    confidence: number;
    parameters: Record<string, string | number>;
    originalText: string;
    action?: () => void;
}

// ==================== COMMAND PATTERNS ====================

const COMMAND_PATTERNS: Array<{
    pattern: RegExp;
    type: VoiceCommandType;
    extractor: (match: RegExpMatchArray) => Record<string, string | number>;
}> = [
        // Add investment commands
        {
            pattern: /(?:add|invest|buy)\s+(?:₹|rs|rupees?)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:in|to|into)?\s*(.+)/i,
            type: 'add_investment',
            extractor: (match) => {
                const match1 = match[1];
                const match2 = match[2];
                return {
                    amount: match1 !== undefined ? parseFloat(match1.replace(/,/g, '')) : 0,
                    asset: match2 !== undefined ? match2.trim() : ''
                };
            }
        },
        // Check portfolio
        {
            pattern: /(?:check|show|what(?:'s| is)|how(?:'s| is))\s+(?:my\s+)?(?:portfolio|investments?|holdings?)/i,
            type: 'check_portfolio',
            extractor: () => ({})
        },
        // Set alert
        {
            pattern: /(?:set|create|add)\s+(?:an?\s+)?(?:alert|reminder|notification)\s+(?:for|when|if)\s+(.+)/i,
            type: 'set_alert',
            extractor: (match) => {
                const match1 = match[1];
                return { condition: match1 !== undefined ? match1.trim() : '' };
            }
        },
        // Ask advisor
        {
            pattern: /(?:ask|tell me|what|should i|advice|suggest)\s+(.+)/i,
            type: 'ask_advisor',
            extractor: (match) => {
                const match1 = match[1];
                return { question: match1 !== undefined ? match1.trim() : '' };
            }
        },
        // Navigate
        {
            pattern: /(?:go to|open|show|navigate to)\s+(.+)/i,
            type: 'navigate',
            extractor: (match) => {
                const match1 = match[1];
                return { destination: match1 !== undefined ? match1.trim() : '' };
            }
        },
        // Search
        {
            pattern: /(?:search|find|look for)\s+(.+)/i,
            type: 'search',
            extractor: (match) => {
                const match1 = match[1];
                return { query: match1 !== undefined ? match1.trim() : '' };
            }
        }
    ];

// Tab name mappings
const TAB_MAPPINGS: Record<string, string> = {
    'dashboard': 'dashboard',
    'home': 'dashboard',
    'portfolio': 'portfolio',
    'holdings': 'portfolio',
    'advisor': 'advisor',
    'ai': 'advisor',
    'academy': 'academy',
    'learn': 'academy',
    'goals': 'goal-gps',
    'ipo': 'ipo',
    'tax': 'compliance',
    'compliance': 'compliance',
    'retirement': 'retirement',
    'fire': 'retirement',
    'journal': 'journal',
    'macro': 'macro',
    'market': 'macro',
};

// ==================== SPEECH RECOGNITION ====================

export class VoiceCommandService {
    private recognition: SpeechRecognition | null = null;
    private synthesis: SpeechSynthesis;
    private isListening = false;
    private onCommandCallback: ((command: ParsedCommand) => void) | null = null;
    private onStatusCallback: ((status: string) => void) | null = null;

    constructor() {
        this.synthesis = window.speechSynthesis;
        this.initRecognition();
    }

    private initRecognition(): void {
        const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;

        if (!SpeechRecognition) {
            console.warn('Speech recognition not supported');
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false;
        this.recognition.interimResults = false;
        this.recognition.lang = 'en-IN'; // Indian English

        this.recognition.onstart = () => {
            this.isListening = true;
            this.onStatusCallback?.('Listening...');
        };

        this.recognition.onresult = (event) => {
            const res0 = event.results[0];
            if (!res0) return;
            const item0 = res0[0];
            if (!item0) return;
            const transcript = item0.transcript;
            const confidence = item0.confidence;

            const command = this.parseCommand(transcript);
            command.confidence = confidence;

            this.onCommandCallback?.(command);
        };

        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            this.onStatusCallback?.(`Error: ${event.error}`);
            this.isListening = false;
        };

        this.recognition.onend = () => {
            this.isListening = false;
            this.onStatusCallback?.('Stopped');
        };
    }

    /**
     * Start listening for voice commands
     */
    startListening(
        onCommand: (command: ParsedCommand) => void,
        onStatus?: (status: string) => void
    ): boolean {
        if (!this.recognition) {
            onStatus?.('Voice not supported');
            return false;
        }

        this.onCommandCallback = onCommand;
        this.onStatusCallback = onStatus || null;

        try {
            this.recognition.start();
            return true;
        } catch (e) {
            console.error('Failed to start recognition:', e);
            return false;
        }
    }

    /**
     * Stop listening
     */
    stopListening(): void {
        if (this.recognition && this.isListening) {
            this.recognition.stop();
        }
    }

    /**
     * Parse voice input into command
     */
    parseCommand(text: string): ParsedCommand {
        const normalized = text.toLowerCase().trim();

        for (const { pattern, type, extractor } of COMMAND_PATTERNS) {
            const match = normalized.match(pattern);
            if (match) {
                return {
                    type,
                    confidence: 0,
                    parameters: extractor(match),
                    originalText: text
                };
            }
        }

        return {
            type: 'unknown',
            confidence: 0,
            parameters: {},
            originalText: text
        };
    }

    /**
     * Speak response
     */
    speak(text: string, rate: number = 1): Promise<void> {
        return new Promise((resolve, reject) => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'en-IN';
            utterance.rate = rate;

            utterance.onend = () => resolve();
            utterance.onerror = (e) => reject(e);

            this.synthesis.speak(utterance);
        });
    }

    /**
     * Cancel speech
     */
    cancelSpeech(): void {
        this.synthesis.cancel();
    }

    /**
     * Get navigation tab from destination
     */
    getNavigationTab(destination: string): string | null {
        const normalized = destination.toLowerCase().trim();

        for (const [key, value] of Object.entries(TAB_MAPPINGS)) {
            if (normalized.includes(key)) {
                return value;
            }
        }

        return null;
    }

    /**
     * Generate voice response for command
     */
    getResponseForCommand(command: ParsedCommand): string {
        switch (command.type) {
            case 'add_investment':
                const { amount, asset } = command.parameters;
                return `Adding ${amount} rupees to ${asset}`;

            case 'check_portfolio':
                return 'Opening your portfolio';

            case 'set_alert':
                return `Setting alert for ${command.parameters.condition}`;

            case 'navigate':
                const tab = this.getNavigationTab(command.parameters.destination as string);
                return tab ? `Navigating to ${tab}` : `Sorry, I couldn't find ${command.parameters.destination}`;

            case 'search':
                return `Searching for ${command.parameters.query}`;

            case 'ask_advisor':
                return 'Let me check with your AI advisor';

            default:
                return "Sorry, I didn't understand that command";
        }
    }

    /**
     * Check if voice is supported
     */
    isSupported(): boolean {
        return !!(window.SpeechRecognition || (window as any).webkitSpeechRecognition);
    }

    /**
     * Get listening status
     */
    getIsListening(): boolean {
        return this.isListening;
    }
}

// Export singleton
export const voiceCommandService = new VoiceCommandService();

export default VoiceCommandService;
