// VoiceJournalService.ts
import { db, VoiceSession } from '../database';
import { llmPipeline } from './llm';
import { logger } from './Logger';

class VoiceJournalService {
  private recognition: any = null;
  private isListening = false;
  private transcript = '';
  private startTime = 0;
  private durationSeconds = 0;
  
  // Callbacks
  private onTranscriptUpdate: ((text: string) => void) | null = null;
  private onStatusUpdate: ((isListening: boolean) => void) | null = null;

  constructor() {}

  public startRecording(
    onTranscript: (text: string) => void,
    onStatus: (isListening: boolean) => void
  ) {
    if (this.isListening) return;

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      logger.warn('[VoiceJournal] SpeechRecognition not supported in this browser.');
      return false;
    }

    this.onTranscriptUpdate = onTranscript;
    this.onStatusUpdate = onStatus;
    this.transcript = '';
    this.startTime = Date.now();

    try {
      this.recognition = new SR();
      this.recognition.lang = 'en-IN';
      this.recognition.continuous = true;
      this.recognition.interimResults = true;

      this.recognition.onstart = () => {
        this.isListening = true;
        if (this.onStatusUpdate) this.onStatusUpdate(true);
      };

      this.recognition.onresult = (e: any) => {
        let final = '';
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            final += e.results[i][0].transcript;
          } else {
            interim += e.results[i][0].transcript;
          }
        }
        this.transcript = (this.transcript + ' ' + final).trim();
        if (this.onTranscriptUpdate) {
          this.onTranscriptUpdate(this.transcript + (interim ? ` [${interim}]` : ''));
        }
      };

      this.recognition.onerror = (err: any) => {
        logger.error('[VoiceJournal] Recognition error', err);
        this.stopRecording();
      };

      this.recognition.onend = () => {
        this.isListening = false;
        if (this.onStatusUpdate) this.onStatusUpdate(false);
      };

      this.recognition.start();
      return true;
    } catch (err) {
      logger.error('[VoiceJournal] Start failed', err);
      return false;
    }
  }

  public stopRecording(): Promise<VoiceSession | null> {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (_) {}
      this.recognition = null;
    }

    this.isListening = false;
    if (this.onStatusUpdate) this.onStatusUpdate(false);

    this.durationSeconds = Math.round((Date.now() - this.startTime) / 1000);
    
    if (this.transcript.trim().length < 5) {
      return Promise.resolve(null);
    }

    return this.analyzeAndSaveSession(this.transcript, this.durationSeconds);
  }

  private async analyzeAndSaveSession(transcriptText: string, duration: number): Promise<VoiceSession | null> {
    try {
      const prompt = `You are a trading psychology AI model. Analyse the following voice journal entry recorded after a trading session.
Transcript: "${transcriptText}"

Extract:
1. Dominant Emotion: Choose one from ['Confidence', 'Uncertainty', 'FOMO', 'Greed', 'Fear', 'Frustration', 'Disciplined'].
2. Key Instruments: List of tickers/stocks mentioned.
3. Rationale / Key Ideas: Bullet points of key thoughts.
4. AI Psychology Commentary: Provide 2 sentences of feedback. If FOMO/Fear is present, advise on stops and pausing.

Provide a JSON object containing:
{
  "dominantEmotion": "string",
  "keyIdeas": ["string"],
  "instruments": ["string"],
  "aiCommentary": "string"
}
Return ONLY valid JSON. No markdown wrappers.`;

      const response = await llmPipeline(prompt, { jsonMode: true, modelOverride: 'gemini-2.5-flash' });
      const cleanText = response.text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleanText);

      // Generate a mock emotion timeline based on the extracted dominant emotion
      const timeline = [
        { timestamp: 0, emotion: 'Neutral', intensity: 2 },
        { timestamp: Math.round(duration * 0.4), emotion: parsed.dominantEmotion || 'Confidence', intensity: 4 },
        { timestamp: duration, emotion: parsed.dominantEmotion || 'Confidence', intensity: 3 }
      ];

      const session: VoiceSession = {
        date: new Date().toISOString(),
        durationSeconds: duration,
        transcript: transcriptText,
        dominantEmotion: parsed.dominantEmotion || 'Disciplined',
        emotionTimeline: timeline,
        aiCommentary: parsed.aiCommentary || 'Session captured successfully. Continue log discipline.',
        instruments: parsed.instruments || [],
        keyIdeas: parsed.keyIdeas || ['Routine session logger.'],
      };

      // Save to IndexedDB
      const id = await db.voice_sessions.add(session);
      session.id = id;

      return session;
    } catch (err) {
      logger.error('[VoiceJournal] Saving/analysis failed', err);
      // Fallback save
      const fallback: VoiceSession = {
        date: new Date().toISOString(),
        durationSeconds: duration,
        transcript: transcriptText,
        dominantEmotion: 'Disciplined',
        emotionTimeline: [{ timestamp: 0, emotion: 'Disciplined', intensity: 3 }],
        aiCommentary: 'Voice entry saved successfully. AI extraction offline.',
        instruments: [],
        keyIdeas: ['Captured post-session transcript.'],
      };
      const id = await db.voice_sessions.add(fallback);
      fallback.id = id;
      return fallback;
    }
  }

  public async getSessions(): Promise<VoiceSession[]> {
    return db.voice_sessions.toArray();
  }

  public async deleteSession(id: number) {
    return db.voice_sessions.delete(id);
  }
}

export const voiceJournalService = new VoiceJournalService();
export default voiceJournalService;
