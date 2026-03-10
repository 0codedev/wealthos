import { askGemini } from './aiService';
import { logger } from './Logger';

export interface AIAnalysisResult {
    tags: string[];
    summary: string;
    actionItems: string[];
    relatedTopics: string[];
    mood: 'eureka' | 'frustrated' | 'neutral' | 'confident' | 'confused';
}

const DEFAULT_ANALYSIS: AIAnalysisResult = {
    tags: [],
    summary: 'Reflection captured.',
    actionItems: [],
    relatedTopics: [],
    mood: 'neutral'
};

/**
 * MistakeIntelligenceService: Performs semantic analysis on mistake reflections.
 * High-performance LLM pipeline with robust fallback and strict JSON enforcement.
 */
export const analyzeMistakeReflection = async (text: string): Promise<AIAnalysisResult> => {
    if (!text || text.trim().length < 10) {
        return DEFAULT_ANALYSIS;
    }

  const prompt = `Analyze trading mistake. Extract structured info.
Task:
Tags: 'fomo','revenge','oversizing','sl-violation','bad-entry' etc.
Summary: 1-sentence key lesson.
Action Items: Next steps to avoid.
Topics: 'Risk','Psychology','Technical' etc.
Mood: 'eureka'|'frustrated'|'neutral'|'confident'|'confused'.

Text: "${text}"

JSON ONLY:
{
  "tags": [], "summary": "", "actionItems": [], "relatedTopics": [], "mood": ""
}`;

    try {
        // We use askGemini which uses generateWithFallback underneath
        const response = await askGemini(prompt, true); // Use Pro for better analysis
        
        // Extract JSON block if LLM included markdown
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        const jsonText = jsonMatch ? jsonMatch[0] : response;
        
        const parsed = JSON.parse(jsonText) as AIAnalysisResult;

        // Validation & Cleanup
        return {
            tags: Array.isArray(parsed.tags) ? parsed.tags : [],
            summary: typeof parsed.summary === 'string' ? parsed.summary : 'No summary provided.',
            actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
            relatedTopics: Array.isArray(parsed.relatedTopics) ? parsed.relatedTopics : [],
            mood: ['eureka', 'frustrated', 'neutral', 'confident', 'confused'].includes(parsed.mood) 
                ? parsed.mood 
                : 'neutral'
        };
    } catch (error) {
        logger.error('MistakeIntelligenceService: AI analysis failed', error);
        return DEFAULT_ANALYSIS;
    }
};
