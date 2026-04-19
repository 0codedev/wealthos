import React, { useState } from 'react';
import { Clipboard, ArrowRight, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { sanitizePasteText, safeFiniteNumber, PASTE_TEXT_MAX_LENGTH } from '../utils/security';
import { useToast } from './shared/ToastProvider';
import { safeAsync } from '../utils/safeAsync';
import { newIdempotencyKey, checkAndStoreIdempotencyKey, clearIdempotencyKey } from '../utils/idempotency';

interface ParsedData {
    fresh?: number;
    promoter?: number;
    gmp?: number;
    sub?: number;
    qib?: number;
    nii?: number;
    retail?: number;
}

interface PasteParserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onParse: (data: ParsedData) => void;
}

const PasteParserModal: React.FC<PasteParserModalProps> = ({ isOpen, onClose, onParse }) => {
    const { toast } = useToast();
    const [text, setText] = useState('');
    const [isParsing, setIsParsing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const parseText = () => {
        if (isParsing) return; // Pillar 3A: double-submit guard
        setIsParsing(true);
        setError(null);

        setTimeout(() => {
            // Pillar 3A: idempotency key — 60s de-dup window
            const idemKey = newIdempotencyKey('paste-parse');
            if (checkAndStoreIdempotencyKey('paste-parse', idemKey)) {
                setIsParsing(false);
                return;
            }
            void safeAsync(async () => {
                try {
                    // CC12 — sanitize the raw paste text BEFORE the regex parsers
                    // touch it. Strips control characters, bidi overrides, and
                    // caps the payload at 8KB so a hostile 200MB paste can't
                    // lock the main thread.
                    const cleaned = sanitizePasteText(text);
                    if (!cleaned.trim()) {
                        throw new Error("No readable text found. Paste must contain plain text only.");
                    }

                    const data: ParsedData = {};
                    const lower = cleaned.toLowerCase();

                    // Regex Patterns — now operating on sanitized input
                    const freshMatch = lower.match(/fresh.*?(\d+(\.\d+)?)/);
                    if (freshMatch && freshMatch[1] !== undefined) {
                        const n = safeFiniteNumber(parseFloat(freshMatch[1]));
                        if (n !== null) data.fresh = n;
                    }

                    const promoterMatch = lower.match(/promoter.*?(\d+(\.\d+)?)/);
                    if (promoterMatch && promoterMatch[1] !== undefined) {
                        const n = safeFiniteNumber(parseFloat(promoterMatch[1]));
                        if (n !== null) data.promoter = n;
                    }

                    const gmpMatch = lower.match(/gmp.*?(\d+(\.\d+)?)/);
                    if (gmpMatch && gmpMatch[1] !== undefined) {
                        const n = safeFiniteNumber(parseFloat(gmpMatch[1]));
                        if (n !== null) data.gmp = n;
                    }

                    const subMatch = lower.match(/sub.*?(\d+(\.\d+)?)/);
                    if (subMatch && subMatch[1] !== undefined) {
                        const n = safeFiniteNumber(parseFloat(subMatch[1]));
                        if (n !== null) data.sub = n;
                    }

                    const qibMatch = lower.match(/qib.*?(\d+(\.\d+)?)/);
                    if (qibMatch && qibMatch[1] !== undefined) {
                        const n = safeFiniteNumber(parseFloat(qibMatch[1]));
                        if (n !== null) data.qib = n;
                    }

                    const niiMatch = lower.match(/nii.*?(\d+(\.\d+)?)/);
                    if (niiMatch && niiMatch[1] !== undefined) {
                        const n = safeFiniteNumber(parseFloat(niiMatch[1]));
                        if (n !== null) data.nii = n;
                    }

                    const retailMatch = lower.match(/retail.*?(\d+(\.\d+)?)/);
                    if (retailMatch && retailMatch[1] !== undefined) {
                        const n = safeFiniteNumber(parseFloat(retailMatch[1]));
                        if (n !== null) data.retail = n;
                    }

                    if (Object.keys(data).length === 0) {
                        throw new Error("No recognizable data found. Try pasting 'GMP: 50, Sub: 10x'");
                    }

                    onParse(data);
                    toast.success('Data extracted successfully.');
                    onClose();
                    setText('');
                    clearIdempotencyKey('paste-parse', idemKey);
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : String(err);
                    setError(message);
                    clearIdempotencyKey('paste-parse', idemKey);
                } finally {
                    setIsParsing(false);
                }
            });
        }, 800); // Fake delay for effect
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Clipboard className="text-indigo-500" size={20} /> Paste Parser
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                        Close
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Paste text from Chittorgarh, GMP sites, or WhatsApp messages. We'll extract the numbers.
                    </p>

                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value.slice(0, PASTE_TEXT_MAX_LENGTH))}
                        placeholder="Example: NTPC Green IPO. GMP 8. Subscription 2.5x. QIB 3.2x..."
                        className="w-full h-32 p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl outline-none focus:border-indigo-500 text-sm font-mono resize-none"
                        maxLength={PASTE_TEXT_MAX_LENGTH}
                    />

                    {error && (
                        <div className="flex items-center gap-2 text-rose-500 text-xs font-bold bg-rose-50 dark:bg-rose-900/20 p-3 rounded-lg">
                            <AlertCircle size={14} /> {error}
                        </div>
                    )}

                    <button
                        onClick={parseText}
                        disabled={!text.trim() || isParsing}
                        className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
                    >
                        {isParsing ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                        {isParsing ? 'Analyzing...' : 'Extract Data'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PasteParserModal;
