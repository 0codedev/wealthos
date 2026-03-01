import { db, BrainVector } from '../../database';
import { logger } from '../Logger';
import { KeyPoolManager } from '../llm/keyPool';
import { useSettingsStore } from '../../store/settingsStore';

export class VectorMemoryService {
  private static instance: VectorMemoryService;
  private isScanning = false;

  private constructor() {}

  static getInstance(): VectorMemoryService {
    if (!VectorMemoryService.instance) {
      VectorMemoryService.instance = new VectorMemoryService();
    }
    return VectorMemoryService.instance;
  }

  /**
   * Calls the Gemini Embedding API for the provided text.
   */
  async getEmbedding(text: string): Promise<number[]> {
    try {
      const apiKey = KeyPoolManager.getInstance().getNextKey('gemini') || useSettingsStore.getState().geminiApiKey;
      if (!apiKey) {
        throw new Error('No Gemini API key available for embedding.');
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: {
            parts: [{ text }]
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Gemini Embedding API returned status ${response.status}`);
      }

      const data = await response.json();
      const vector = data?.embedding?.values;
      if (!Array.isArray(vector)) {
        throw new Error('Embedding response did not contain vector values array.');
      }

      return vector;
    } catch (err) {
      logger.error('[VectorMemoryService] Failed to fetch embedding', err);
      throw err;
    }
  }

  /**
   * Deep scans all trades, signals, and daily reviews.
   * Only embeds entries not already in the vector index.
   */
  async runDeepScan(onProgress?: (progress: number, statusText: string) => void): Promise<void> {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      if (onProgress) onProgress(0, 'Scanning database for entries...');

      // 1. Gather all documents
      const trades = await db.trades.toArray();
      const signals = await db.parsed_signals.toArray();
      const reviews = await db.daily_reviews.toArray();

      const totalDocs = trades.length + signals.length + reviews.length;
      if (totalDocs === 0) {
        if (onProgress) onProgress(100, 'Database is empty. No documents to index.');
        this.isScanning = false;
        return;
      }

      let processed = 0;
      logger.info(`[VectorMemoryService] Starting deep scan of ${totalDocs} documents.`);

      // Helper to process in chunks to prevent rate limit limits
      const batchSize = 5;
      const docsToProcess: { type: 'trade' | 'signal' | 'journal'; id: string; text: string }[] = [];

      // Format trades
      for (const t of trades) {
        if (t.id === undefined) continue;
        docsToProcess.push({
          type: 'trade',
          id: t.id.toString(),
          text: `Trade Date: ${t.date}. Ticker: ${t.ticker}. Side: ${t.direction}. Quantity: ${t.quantity}. Entry Price: ${t.entryPrice}. Exit Price: ${t.exitPrice}. Realized P&L: ₹${t.pnl ?? 'N/A'}. Mood: ${t.moodEntry} entering, ${t.moodExit} exiting. Setup: ${t.setup || 'N/A'}. Mistakes: ${t.mistakes?.join(', ') || 'None'}. Notes: ${t.notes || ''}`
        });
      }

      // Format signals
      for (const s of signals) {
        if (s.id === undefined) continue;
        docsToProcess.push({
          type: 'signal',
          id: s.id.toString(),
          text: `Signal Date: ${s.timestamp}. Instrument: ${s.instrument}. Side: ${s.action}. Provider: ${s.provider}. Target 1: ${s.target1 ?? 'N/A'}. StopLoss: ${s.stopLoss ?? 'N/A'}. Status: ${s.status}. Realized P&L: ₹${s.outcomePnL ?? 'N/A'}.`
        });
      }

      // Format reviews
      for (const r of reviews) {
        docsToProcess.push({
          type: 'journal',
          id: r.date,
          text: `Daily Review Date: ${r.date}. Rating: ${r.rating} stars. Mood: ${r.mood ?? 'Neutral'}. Energy: ${r.energyLevel ?? 'N/A'}/10. Sleep: ${r.sleepHours ?? 'N/A'} hours. Market: ${r.marketCondition}. Notes: ${r.notes || ''}. Did Well: ${r.didWell || ''}. Did Poorly: ${r.didPoorly || ''}`
        });
      }

      // Process and index
      for (let i = 0; i < docsToProcess.length; i += batchSize) {
        const batch = docsToProcess.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (doc) => {
            try {
              // Check if already embedded
              const exists = await db.brain_vectors
                .where('docType').equals(doc.type)
                .and((bv: BrainVector) => bv.docId === doc.id)
                .first();

              if (!exists) {
                const vector = await this.getEmbedding(doc.text);
                const record: BrainVector = {
                  docType: doc.type,
                  docId: doc.id,
                  text: doc.text,
                  vector,
                  timestamp: Date.now()
                };
                await db.brain_vectors.add(record);
              }
            } catch (err) {
              logger.error(`[VectorMemoryService] Failed to index ${doc.type} ID ${doc.id}`, err);
            }
          })
        );

        processed += batch.length;
        const pct = Math.round((processed / docsToProcess.length) * 100);
        if (onProgress) {
          onProgress(pct, `Indexing ${processed}/${docsToProcess.length} entries...`);
        }
        
        // Minor throttle to stay under TPM limits
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      if (onProgress) onProgress(100, `Deep Scan complete. ${totalDocs} entries indexed.`);
    } catch (err) {
      logger.error('[VectorMemoryService] Deep scan failed', err);
      if (onProgress) onProgress(100, 'Deep scan failed. Try again.');
    } finally {
      this.isScanning = false;
    }
  }

  async clearIndex(): Promise<void> {
    try {
      await db.brain_vectors.clear();
      logger.info('[VectorMemoryService] Vector store cleared.');
    } catch (err) {
      logger.error('[VectorMemoryService] Failed to clear vector store', err);
    }
  }
}

export const vectorMemoryService = VectorMemoryService.getInstance();
