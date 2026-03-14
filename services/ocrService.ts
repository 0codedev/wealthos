/**
 * Client-Side OCR Service
 * ------------------------
 * Lazy Tesseract.js worker pool. Runs entirely in the browser using
 * dynamic `import()` so the heavy Tesseract runtime + WASM core never
 * ends up in the main bundle. All recognition happens locally; nothing
 * is ever sent to an external OCR API.
 */
import { logger } from './Logger';

export interface OCRWord {
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OCRResult {
    text: string;
    confidence: number;
    words: OCRWord[];
    durationMs: number;
}

export type OCRProgressCallback = (progress: number, status: string) => void;

interface WorkerHolder {
    worker: any; // Tesseract.Worker (untyped to avoid top-level import)
    inUse: boolean;
}

class OCREngineImpl {
    private workers: WorkerHolder[] = [];
    private initializing: Promise<WorkerHolder> | null = null;
    private tesseract: any | null = null;

    /** Lazy-load Tesseract.js via dynamic import (code-split, not in main bundle). */
    private async getTesseract() {
        if (this.tesseract) return this.tesseract;
        try {
            // Code-split: this is the only place tesseract.js is loaded.
            // The string is intentionally a runtime variable so that bundlers
            // (Vite) always emit a dynamic chunk instead of inlining it in main.
            const moduleName = 'tesseract.js';
            const mod: any = await import(/* @vite-ignore */ moduleName);
            this.tesseract = mod;
            return mod;
        } catch (err) {
            logger.error('OCRService: failed to load tesseract.js', err, 'OCRService');
            throw new Error('tesseract.js unavailable. Run `npm install tesseract.js`.');
        }
    }

    /** Get or create an available worker. */
    private async acquireWorker(onProgress?: OCRProgressCallback): Promise<WorkerHolder> {
        const tesseract = await this.getTesseract();
        // Look for a free worker first
        const free = this.workers.find(w => !w.inUse);
        if (free) {
            free.inUse = true;
            if (onProgress) {
                free.worker.on('progress', (m: any) => {
                    try { onProgress(m.progress || 0, m.status || 'processing'); } catch { /* ignore */ }
                });
            }
            return free;
        }
        // Serialize creation
        if (!this.initializing) {
            this.initializing = (async () => {
                const w = await tesseract.createWorker('eng', undefined, {
                    logger: (m: any) => {
                        try { onProgress?.(m.progress || 0, m.status || 'init'); } catch { /* ignore */ }
                    }
                });
                const holder: WorkerHolder = { worker: w, inUse: true };
                this.workers.push(holder);
                this.initializing = null;
                return holder;
            })();
        }
        return this.initializing;
    }

    private releaseWorker(holder: WorkerHolder) {
        holder.inUse = false;
        // Try to remove the progress listener to avoid leaking
        try { holder.worker.off('progress'); } catch { /* ignore */ }
    }

    /**
     * Recognize text in an image. Accepts Blob, File, data URL, or remote URL.
     * Returns the recognized plain text, an aggregate confidence (0-1), the per-word
     * confidences / bounding boxes (from Tesseract), and the wall-clock duration.
     */
    async recognize(
        imageData: Blob | File | string,
        onProgress?: OCRProgressCallback
    ): Promise<OCRResult> {
        const start = Date.now();
        const holder = await this.acquireWorker(onProgress);
        try {
            const result = await holder.worker.recognize(imageData as any);
            // Tesseract 5.x returns { data: { text, confidence, words } }
            const data = result?.data ?? result;
            const text: string = (data.text || '').trim();
            const confidence: number = typeof data.confidence === 'number'
                ? Math.max(0, Math.min(100, data.confidence)) / 100
                : 0;
            const words: OCRWord[] = Array.isArray(data.words)
                ? data.words.map((w: any) => ({
                    text: w.text || '',
                    confidence: typeof w.confidence === 'number' ? Math.max(0, Math.min(100, w.confidence)) / 100 : 0,
                    bbox: {
                        x0: w.bbox?.x0 ?? 0,
                        y0: w.bbox?.y0 ?? 0,
                        x1: w.bbox?.x1 ?? 0,
                        y1: w.bbox?.y1 ?? 0,
                    }
                }))
                : [];
            return {
                text,
                confidence,
                words,
                durationMs: Date.now() - start,
            };
        } catch (err) {
            logger.error('OCRService: recognition failed', err, 'OCRService');
            throw err;
        } finally {
            this.releaseWorker(holder);
        }
    }

    /** Tear down all workers — call on app unload if you want to be tidy. */
    async terminateAll() {
        for (const w of this.workers) {
            try { await w.worker.terminate?.(); } catch { /* ignore */ }
        }
        this.workers = [];
        this.initializing = null;
    }
}

export const OCREngine = new OCREngineImpl();
export default OCREngine;
