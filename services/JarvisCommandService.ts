import { llmPipeline } from './llm';
import { logger } from './Logger';
import { interpretJarvisTranscript, matchJarvisCommand } from './JarvisSemanticCommands';

export type JarvisActionType =
    | 'NAVIGATE'
    | 'SPEAK'
    | 'TOGGLE_THEME'
    | 'TOGGLE_PRIVACY'
    | 'REFRESH_DATA'
    | 'OPEN_MODAL'
    | 'QUERY_DATA'
    | 'SWITCH_PROFILE'
    | 'NONE';

export interface JarvisAction {
    type: JarvisActionType;
    payload?: string;
    response?: string;
    /** CC11 — captured slot values (e.g. {symbol: 'RELIANCE', quantity: '100'}). */
    slots?: Record<string, string>;
}

class JarvisCommandService {

    /**
     * AI-Enhanced Command Processor
     * Falls back to LLM if rule-based parsing fails.
     */
    async processCommandAI(transcript: string): Promise<JarvisAction> {
        // 1. Try Fast Rule-Based Matching first
        const action = this.processCommand(transcript);
        if (action.type !== 'NONE') return action;

        // 1.5 Try Sub-15ms Local NaiveBayes Classifier
        try {
          const { jarvisIntentClassifier } = await import('./ml/JarvisIntentClassifier');
          const localMatch = jarvisIntentClassifier.classify(transcript);
          if (localMatch.confidence >= 0.65 && localMatch.intent !== 'UNKNOWN') {
            const mappedType: JarvisActionType =
              localMatch.intent === 'OPEN_CHART' ? 'NAVIGATE' :
              localMatch.intent === 'SHOW_PORTFOLIO' ? 'NAVIGATE' :
              localMatch.intent === 'SHOW_MISTAKES' ? 'NAVIGATE' : 'QUERY_DATA';

            return {
              type: mappedType,
              payload: localMatch.intent.toLowerCase(),
              response: `Understood (${localMatch.intent} - ${(localMatch.confidence * 100).toFixed(0)}% confidence). Executing locally.`,
            };
          }
        } catch {
          /* swallow */
        }

        // 2. Fallback to LLM for complex/natural language
        const prompt = `
            You are "Jarvis", the AI core of a Wealth Dashboard. 
            Interpret the user's intent: "${transcript}"

            AVAILABLE SYSTEM ACTIONS:
            - NAVIGATE: { payload: "dashboard" | "portfolio" | "market" | "ipo" | "journal" | "growth" | "settings" | "gps" }
            - TOGGLE_THEME: (dark/light mode)
            - TOGGLE_PRIVACY: (hide/show numbers)
            - REFRESH_DATA: (sync/update data)
            - OPEN_MODAL: { payload: "ADD_INVESTMENT" | "ADD_SIP" | "EXPORT" }
            - QUERY_DATA: { payload: "NET_WORTH" | "XIRR" | "TOP_PERFORMER" | "WORST_PERFORMER" | "DIVIDENDS" }
            - SWITCH_PROFILE: { payload: "MOM" | "SPOUSE" | "KIDS" | "HUF" | "SELF" | "ALL" }
            - SPEAK: (Only if no other action fits - just talk to them)

            RESPOND ONLY WITH JSON:
            {
                "type": "ACTION_TYPE",
                "payload": "...",
                "response": "A professional, Jarvis-style confirmation (e.g., 'Of course. Loading your portfolio now.')"
            }
        `;

        try {
            const result = await llmPipeline(prompt, {
                modelOverride: 'llama-3.1-8b-instant', // Fastest for UI feedback
                jsonMode: true
            });
            const parsed = JSON.parse(result.text.replace(/```json|```/g, '').trim());
            return {
                type: parsed.type || 'NONE',
                payload: parsed.payload,
                response: parsed.response || "Command processed."
            };
        } catch (error) {
            logger.error("Jarvis: AI parsing failed", error);
            return { type: 'NONE', response: "I didn't quite catch that. Try saying 'help'." };
        }
    }

    processCommand(transcript: string): JarvisAction {
        const match = interpretJarvisTranscript(transcript);
        if (match) {
            const cleaned: JarvisAction = { ...match.action };
            // Strip the slot-debug suffix from the spoken reply (we add it
            // for transparency in the response, but Jarvis shouldn't literally
            // say "(slots: symbol=RELIANCE)" out loud).
            if (cleaned.response) {
                cleaned.response = cleaned.response.replace(/\s*\(slots:[^)]+\)\s*$/, '');
            }
            cleaned.slots = match.slots;
            return cleaned;
        }
        return { type: 'NONE', response: "I didn't understand that. Try saying 'help' for available commands." };
    }

    /** Expose the underlying matcher for consumers that need slot inspection. */
    inspect(transcript: string) {
        return matchJarvisCommand(transcript);
    }
}

export const jarvisCommandService = new JarvisCommandService();
