import { ragQueryEngine, RetrievedDoc } from './RAGQueryEngine';
import { llmPipeline } from '../llm';
import { SEBI_COMPLIANCE_CORE } from '../aiService';
import { logger } from '../Logger';

export interface PersonalizedBrainResponse {
  answer: string;
  sources: RetrievedDoc[];
}

export class PersonalizedBrain {
  private static instance: PersonalizedBrain;

  private constructor() {}

  static getInstance(): PersonalizedBrain {
    if (!PersonalizedBrain.instance) {
      PersonalizedBrain.instance = new PersonalizedBrain();
    }
    return PersonalizedBrain.instance;
  }

  /**
   * Main query path: retrieves context documents from IndexedDB,
   * constructs the prompt, queries the LLM pipeline, and returns the response.
   */
  async query(userQuestion: string): Promise<PersonalizedBrainResponse> {
    try {
      // 1. Retrieve most similar documents
      const sources = await ragQueryEngine.retrieveRelevantDocs(userQuestion, 8);

      // 2. Format documents into context text
      let contextText = '';
      if (sources.length > 0) {
        contextText = sources
          .map((doc, idx) => `[Record ${idx + 1}] (${doc.docType.toUpperCase()} - ID: ${doc.docId}): "${doc.text}"`)
          .join('\n\n');
      } else {
        contextText = 'No specific historical records found matching the query. Respond generally.';
      }

      // 3. Build target prompt
      const prompt = `${SEBI_COMPLIANCE_CORE}

You are the Wealth Dashboard AI Trading Companion, a private, personalized AI engine running locally on the user's browser.
You have secure access to the user's historical personal finance database (trades, signals, and journal reviews).

Here is the retrieved context from their database matching their question:
${contextText}

USER QUESTION: "${userQuestion}"

Instructions:
1. Provide a highly personalized, accurate, and direct response addressing the user's question.
2. Directly reference specific numbers, dates, instruments, or notes from the retrieved records if applicable.
3. Be supportive, objective, and analytical. Use Indian English format.
4. Keep the answer under 3-4 paragraphs. Always end with a very short regulatory compliance disclaimer.`;

      // 4. Call LLM Pipeline
      const response = await llmPipeline(prompt, {
        noCache: true,
        requireHighIntelligence: true
      });

      return {
        answer: response.text,
        sources
      };
    } catch (err) {
      logger.error('[PersonalizedBrain] Error running RAG query', err);
      return {
        answer: 'I encountered an error querying your trading history. Please verify that your deep scan index is fully built and try again.',
        sources: []
      };
    }
  }
}

export const personalizedBrain = PersonalizedBrain.getInstance();
