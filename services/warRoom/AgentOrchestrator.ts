import { llmPipeline } from '../llm';
import { AGENT_PERSONAS } from './AgentPersonas';
import { logger } from '../Logger';

export interface JudgeConsensus {
  verdict: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'WAIT';
  confidence: number;
  summary: string;
  synthesisPoints: string[];
}

export interface WarRoomReport {
  bull: string;
  bear: string;
  quant: string;
  risk: string;
  judge: JudgeConsensus;
}

export class AgentOrchestrator {
  private static instance: AgentOrchestrator;

  private constructor() {}

  static getInstance(): AgentOrchestrator {
    if (!AgentOrchestrator.instance) {
      AgentOrchestrator.instance = new AgentOrchestrator();
    }
    return AgentOrchestrator.instance;
  }

  /**
   * Run the parallel agent swarm research and synthesize the consensus report.
   */
  async runResearchSwarm(query: string, contextSnippet = ''): Promise<WarRoomReport | null> {
    try {
      logger.info(`[AgentOrchestrator] Launching parallel AI Swarm research for query: "${query}"`);

      // 1. Run Bull, Bear, Quant, Risk in parallel
      const roles: ('BULL' | 'BEAR' | 'QUANT' | 'RISK')[] = ['BULL', 'BEAR', 'QUANT', 'RISK'];
      
      const results = await Promise.allSettled(
        roles.map(async (role) => {
          const config = AGENT_PERSONAS[role];
          const fullPrompt = `${config.systemPrompt}\n\nContext:\n${contextSnippet}\n\nQuestion: ${query}`;
          
          const res = await llmPipeline(fullPrompt, {
            noCache: true,
            requireHighIntelligence: false
          });
          return { role, text: res.text.trim() };
        })
      );

      const reportParts: Record<string, string> = {
        BULL: '',
        BEAR: '',
        QUANT: '',
        RISK: ''
      };

      results.forEach((r) => {
        if (r.status === 'fulfilled') {
          reportParts[r.value.role] = r.value.text;
        } else {
          logger.error(`[AgentOrchestrator] Sub-agent failed to respond`, r.reason);
          reportParts[(r as any).role] = 'Agent was unable to complete research due to rate limits or API timeout.';
        }
      });

      // 2. Feed all arguments to the JUDGE for final synthesis
      const judgeConfig = AGENT_PERSONAS.JUDGE;
      const judgePrompt = `${judgeConfig.systemPrompt}

Here are the cases presented by the sub-agents:
---
[BULLISH ARGUMENTS]:
${reportParts.BULL}

---
[BEARISH RISK ARGUMENTS]:
${reportParts.BEAR}

---
[QUANT STATISTICAL DATA]:
${reportParts.QUANT}

---
[TAIL RISKS & HEDGING]:
${reportParts.RISK}

---
USER QUERY: "${query}"

Return strictly the raw JSON matching the Judge schema. Do not wrap in markdown tags or comments.`;

      const judgeResponse = await llmPipeline(judgePrompt, {
        noCache: true,
        requireHighIntelligence: true
      });

      const cleanJson = judgeResponse.text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsedJudge: JudgeConsensus = JSON.parse(cleanJson);

      return {
        bull: reportParts.BULL ?? '',
        bear: reportParts.BEAR ?? '',
        quant: reportParts.QUANT ?? '',
        risk: reportParts.RISK ?? '',
        judge: parsedJudge
      };
    } catch (err) {
      logger.error('[AgentOrchestrator] Swarm orchestration failed', err);
      return null;
    }
  }
}

export const agentOrchestrator = AgentOrchestrator.getInstance();
export default agentOrchestrator;
