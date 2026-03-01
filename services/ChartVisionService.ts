import { llmPipeline } from "./llm";

export interface ChartPattern {
  type: string;               // "Head & Shoulders", "Bull Flag", "Ascending Triangle", "Double Top", "Double Bottom", etc.
  confidence: number;         // 0-100
  entryZone: string;          // "Break above 24,850"
  target: string;             // "25,400 (measured move)"
  stopLoss: string;           // "Below 24,600"
  description: string;        // One-sentence explanation
  relativeCoords?: {          // Normalized 0-1 coordinates for SVG overlay
    patternStart: { x: number; y: number };
    patternEnd: { x: number; y: number };
    breakoutLevel?: number;   // normalized y-coord (0.0 to 1.0)
    targetLevel?: number;     // normalized y-coord (0.0 to 1.0)
    slLevel?: number;         // normalized y-coord (0.0 to 1.0)
  };
}

export interface ChartVisionResult {
  patterns: ChartPattern[];
  supportLevels: string[];     // e.g. ["24,500", "24,200"]
  resistanceLevels: string[];  // e.g. ["25,000", "25,500"]
  trend: "BULLISH" | "BEARISH" | "SIDEWAYS";
  trendStrength: "STRONG" | "MODERATE" | "WEAK";
  keyObservations: string[];
  tradingBias: string;         // One-line summary
  timeframeGuess: string;      // "Likely 15-min or hourly chart"
  confidence: number;          // Overall analysis confidence 0-100
}

export interface HistoryItem {
  id?: number;
  imageBase64: string;
  result: ChartVisionResult;
  ticker?: string;
  timestamp: string;
}

class ChartVisionHistoryStore {
  private dbName = 'wealth-chart-vision-history-db';
  private storeName = 'history';

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id', autoIncrement: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  public async addAnalysis(imageBase64: string, result: ChartVisionResult, ticker?: string): Promise<void> {
    try {
      const db = await this.openDB();
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      
      const items: any[] = await new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
      });

      // Sort items by id descending
      items.sort((a, b) => b.id - a.id);

      // Keep only last 4, deleting the rest to make space for the 5th
      if (items.length >= 5) {
        const toDelete = items.slice(4);
        for (const item of toDelete) {
          store.delete(item.id);
        }
      }

      store.add({
        imageBase64,
        result,
        ticker,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      console.error("Failed to add analysis to history", e);
    }
  }

  public async getHistory(): Promise<HistoryItem[]> {
    try {
      const db = await this.openDB();
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      
      const items: HistoryItem[] = await new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      return items.sort((a, b) => (b.id || 0) - (a.id || 0)); // Newest first
    } catch {
      return [];
    }
  }
}

export const chartVisionHistory = new ChartVisionHistoryStore();

export class ChartVisionService {
  public static async analyzeChart(base64Image: string, ticker?: string): Promise<ChartVisionResult> {
    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");
    
    const prompt = `You are an expert technical analyst. Analyze this chart image. ${ticker ? `The instrument is: ${ticker}` : ''}
Return ONLY a valid JSON object with this exact structure (no markdown formatting, no code block backticks):
{
  "patterns": [
    {
      "type": "Head & Shoulders",
      "confidence": 85,
      "entryZone": "Break below neckline at 24,800",
      "target": "24,500 (measured move)", 
      "stopLoss": "Above right shoulder at 24,950",
      "description": "Forming head and shoulders with neckline at 24,800, indicating bearish reversal on breakout.",
      "relativeCoords": {
        "patternStart": { "x": 0.2, "y": 0.4 },
        "patternEnd": { "x": 0.8, "y": 0.65 },
        "breakoutLevel": 0.6,
        "targetLevel": 0.7,
        "slLevel": 0.35
      }
    }
  ],
  "supportLevels": ["24,800", "24,500"],
  "resistanceLevels": ["25,000", "25,200"],
  "trend": "BEARISH",
  "trendStrength": "MODERATE",
  "keyObservations": [
    "Neckline support tested three times.",
    "RSI is showing bearish divergence.",
    "Volume is expanding on down legs."
  ],
  "tradingBias": "Short on confirmed breakdown below 24,800",
  "timeframeGuess": "15-minute chart",
  "confidence": 80
}

Identify up to 3 major chart patterns. Be highly specific and accurate.
Normalize all coordinates to 0.0-1.0 range (0,0 = top-left of chart, 1,1 = bottom-right).
For breakoutLevel, targetLevel, slLevel: these are normalized y-coordinates (0.0 = top, 1.0 = bottom).`;

    const res = await llmPipeline(prompt, {
      modelOverride: 'gemini-3-flash-latest', // June 2026 model supporting vision
      jsonMode: true,
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/png', data: cleanBase64 } },
          { text: prompt }
        ]
      }]
    });

    const result = this.parseResponse(res.text);

    // Save to history
    await chartVisionHistory.addAnalysis(base64Image, result, ticker);

    return result;
  }

  private static parseResponse(raw: string): ChartVisionResult {
    try {
      let clean = raw.trim();
      if (clean.startsWith("```")) {
        const lines = clean.split("\n");
        if (lines[0].includes("json")) {
          lines.shift();
        } else {
          lines.shift();
        }
        if (lines[lines.length - 1].startsWith("```")) {
          lines.pop();
        }
        clean = lines.join("\n").trim();
      }

      return JSON.parse(clean) as ChartVisionResult;
    } catch (e) {
      console.error("Failed to parse Chart Vision AI JSON response. Raw output:", raw, e);
      throw new Error("AI returned invalid JSON formatting. Please try again.");
    }
  }
}
