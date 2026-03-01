import { db, BrainVector } from '../../database';
import { vectorMemoryService } from './VectorMemoryService';
import { logger } from '../Logger';

export interface RetrievedDoc {
  docType: 'trade' | 'signal' | 'journal';
  docId: string;
  text: string;
  score: number;
  timestamp: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class RAGQueryEngine {
  private static instance: RAGQueryEngine;

  private constructor() {}

  static getInstance(): RAGQueryEngine {
    if (!RAGQueryEngine.instance) {
      RAGQueryEngine.instance = new RAGQueryEngine();
    }
    return RAGQueryEngine.instance;
  }

  /**
   * Embeds the user query, scans all vector records, and retrieves the
   * top-K matches using cosine similarity with a recency bonus.
   */
  async retrieveRelevantDocs(query: string, topK = 8): Promise<RetrievedDoc[]> {
    try {
      logger.info(`[RAGQueryEngine] Starting RAG query retrieval for: "${query}"`);
      
      // 1. Get embedding of query
      const queryVector = await vectorMemoryService.getEmbedding(query);

      // 2. Fetch all vector records from IndexedDB
      const allVectors = await db.brain_vectors.toArray();
      if (allVectors.length === 0) {
        logger.info('[RAGQueryEngine] No vector records found in IndexedDB.');
        return [];
      }

      // 3. Compute similarities
      const now = Date.now();
      const results: RetrievedDoc[] = allVectors.map((record: BrainVector) => {
        const sim = cosineSimilarity(queryVector, record.vector);
        
        // 90-day recency bonus: linear scaling from +0.1 for brand new documents to +0.0 for older ones
        const daysOld = (now - record.timestamp) / (24 * 60 * 60 * 1000);
        const recencyBonus = daysOld <= 90 ? 0.1 * (1 - daysOld / 90) : 0;

        return {
          docType: record.docType,
          docId: record.docId,
          text: record.text,
          score: sim + recencyBonus,
          timestamp: record.timestamp
        };
      });

      // 4. Sort and filter
      const ranked = results
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      logger.info(`[RAGQueryEngine] Retrieved ${ranked.length} relevant context records.`);
      return ranked;
    } catch (err) {
      logger.error('[RAGQueryEngine] Failed to retrieve relevant documents', err);
      return [];
    }
  }
}

export const ragQueryEngine = RAGQueryEngine.getInstance();
