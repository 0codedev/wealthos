import { chatWithGroq } from './groqService';
import { logger } from './Logger';

export interface MarketBrief {
    generatedAt: string;
    niftyOutlook: string;
    bankNiftyOutlook: string;
    keyLevels: {
        support: number[];
        resistance: number[];
    };
    optionData: string;
    macroEvents: string[];
    topThemes: string[];
    channelsSampled: string[];
    messageCount: number;
}

const SUMMARIZER_SYSTEM_PROMPT = `You are a professional Indian stock market analyst assistant.
You are given a collection of messages from premium Telegram channels discussing 
Nifty, BankNifty, options, and macro events for today's trading session.

Your job is to synthesize all this data into ONE clean, structured Market Brief.

OUTPUT FORMAT (strict JSON):
{
  "niftyOutlook": "Concise summary of Nifty view",
  "bankNiftyOutlook": "Concise summary of BankNifty view",
  "keyLevels": { "support": [22300, 22150], "resistance": [22600, 22800] },
  "optionData": "Summary of PCR, Max Pain, and option chain data",
  "macroEvents": ["Event 1", "Event 2"],
  "topThemes": ["Theme 1", "Theme 2"],
  "channelsSampled": ["Channel Name 1", "Channel Name 2"]
}

RULES:
1. Be concise but information-dense. No filler words.
2. Mention specific price levels when available.
3. If data for a field is absent, return an empty string or empty array.
4. Do NOT include promotional content or irrelevant chat.
5. Return ONLY valid JSON.
`;

const CLASSIFICATION_PROMPT = `Classify if the following Telegram message contains useful stock market analysis, levels, or macro updates. 
Exclude promotions, general greetings, or noise.
Respond with only 'YES' or 'NO'.`;

export class TelegramSummarizerService {
    private static messageBuffer: { text: string; channel: string; timestamp: number }[] = [];
    private static MAX_BUFFER_SIZE = 50;

    /**
     * Adds a message to the buffer if it's relevant analysis.
     */
    static async addMessage(text: string, channel: string) {
        try {
            // Optional: Quick classification to save buffer space
            // For now, we trust the ear's filtering, but we can add an AI check here if needed.
            
            this.messageBuffer.push({
                text,
                channel,
                timestamp: Date.now()
            });

            // Keep buffer size manageable (FIFO)
            if (this.messageBuffer.length > this.MAX_BUFFER_SIZE) {
                this.messageBuffer.shift();
            }
            
            logger.info(`TelegramSummarizer: Added message from ${channel}. Buffer size: ${this.messageBuffer.length}`);
        } catch (error) {
            logger.error('TelegramSummarizer: Failed to add message', error);
        }
    }

    /**
     * Clears the current buffer.
     */
    static clearBuffer() {
        this.messageBuffer = [];
        logger.info('TelegramSummarizer: Buffer cleared');
    }

    /**
     * Generates a market brief from the current buffer.
     */
    static async generateBrief(): Promise<MarketBrief | null> {
        if (this.messageBuffer.length === 0) {
            logger.warn('TelegramSummarizer: Cannot generate brief, buffer is empty');
            return null;
        }

        try {
            const combinedText = this.messageBuffer
                .map(m => `[${m.channel}]: ${m.text}`)
                .join('\n---\n');

            const responseText = await chatWithGroq(
                'llama-3.1-8b-instant', // Use fast model for summary
                [],
                `Synthesize a market brief from these messages:\n\n${combinedText}`,
                SUMMARIZER_SYSTEM_PROMPT
            );

            // Clean JSON response
            const cleanJsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const data = JSON.parse(cleanJsonString);

            const brief: MarketBrief = {
                generatedAt: new Date().toISOString(),
                niftyOutlook: data.niftyOutlook || '',
                bankNiftyOutlook: data.bankNiftyOutlook || '',
                keyLevels: {
                    support: Array.isArray(data.keyLevels?.support) ? data.keyLevels.support.map(Number) : [],
                    resistance: Array.isArray(data.keyLevels?.resistance) ? data.keyLevels.resistance.map(Number) : [],
                },
                optionData: data.optionData || '',
                macroEvents: Array.isArray(data.macroEvents) ? data.macroEvents : [],
                topThemes: Array.isArray(data.topThemes) ? data.topThemes : [],
                channelsSampled: Array.from(new Set(this.messageBuffer.map(m => m.channel))),
                messageCount: this.messageBuffer.length
            };

            return brief;
        } catch (error) {
            logger.error('TelegramSummarizer: Brief generation failed', error);
            return null;
        }
    }

    /**
     * Returns the current buffer for UI display if needed.
     */
    static getBuffer() {
        return this.messageBuffer;
    }
}
