import { db, PaperTrade } from '../../database';
import { logger } from '../Logger';
import { llmPipeline } from '../llm';

export class ActionExecutor {
  private static instance: ActionExecutor;

  private constructor() {}

  static getInstance(): ActionExecutor {
    if (!ActionExecutor.instance) {
      ActionExecutor.instance = new ActionExecutor();
    }
    return ActionExecutor.instance;
  }

  /**
   * Parses the suggested trade details from a brief text using the LLM pipeline,
   * then adds the trade to the IndexedDB paper_trades table.
   */
  async executePaperTrade(briefText: string): Promise<number | null> {
    try {
      const prompt = `You are a structured finance parser. Parse this market brief text and extract the suggested paper trade (instrument, side, quantity, price, notes).
Brief: "${briefText}"

Return strictly a raw JSON object matching this schema:
{
  "ticker": "string",
  "type": "BUY" | "SELL",
  "quantity": number,
  "entryPrice": number,
  "notes": "string"
}
If no specific trade is suggested in the brief, return strictly: null. Do not include markdown wraps or block quotes.`;

      const res = await llmPipeline(prompt, { noCache: true });
      const cleanJson = res.text.replace(/```json/g, '').replace(/```/g, '').trim();
      
      if (!cleanJson || cleanJson.toLowerCase() === 'null') {
        logger.info('[ActionExecutor] No paper trade suggested in this brief.');
        return null;
      }

      const parsed = JSON.parse(cleanJson);
      if (!parsed || !parsed.ticker || !parsed.type || !parsed.entryPrice) {
        logger.warn('[ActionExecutor] Parsed trade was incomplete or invalid.');
        return null;
      }

      const entry: PaperTrade = {
        ticker: parsed.ticker.toUpperCase(),
        type: parsed.type,
        entryPrice: parsed.entryPrice,
        quantity: parsed.quantity || 100, // default
        openDate: new Date().toISOString(),
        status: 'OPEN',
        notes: parsed.notes || 'Executed autonomously by Jarvis 3.0 Sentinel confluence signal.'
      };

      const id = await db.paper_trades.add(entry);
      logger.info(`[ActionExecutor] Successfully added paper trade ${parsed.type} ${parsed.ticker} at ₹${parsed.entryPrice} with ID ${id}.`);
      return typeof id === 'number' ? id : null;
    } catch (err) {
      logger.error('[ActionExecutor] Failed to parse or execute paper trade', err);
      return null;
    }
  }
}

export const actionExecutor = ActionExecutor.getInstance();
