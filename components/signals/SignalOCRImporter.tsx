import React, { useState, useEffect, useCallback } from 'react';
import { Upload, Clipboard, Cpu, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { signalIntelligenceService } from '../../services/SignalIntelligenceService';
import { db, ParsedSignal } from '../../database';
import { logger } from '../../services/Logger';

interface SignalOCRImporterProps {
  onSignalSaved: () => void;
  providers: string[];
}

export const SignalOCRImporter: React.FC<SignalOCRImporterProps> = ({ onSignalSaved, providers }) => {
  // Tesseract script loading state
  const [isLibLoaded, setIsLibLoaded] = useState(false);
  const [isLibLoading, setIsLibLoading] = useState(false);

  // OCR state
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [ocrText, setOcrText] = useState('');

  // Editing form state
  const [provider, setProvider] = useState('Manual Paste');
  const [customProvider, setCustomProvider] = useState('');
  const [instrument, setInstrument] = useState('');
  const [action, setAction] = useState<'BUY' | 'SELL' | 'SHORT' | 'COVER'>('BUY');
  const [entryPrice, setEntryPrice] = useState<number>(0);
  const [stopLoss, setStopLoss] = useState<number>(0);
  const [target1, setTarget1] = useState<number>(0);
  const [target2, setTarget2] = useState<number>(0);
  const [target3, setTarget3] = useState<number>(0);
  const [notes, setNotes] = useState('');
  
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Dynamic script loader for Tesseract.js
  useEffect(() => {
    if ((window as any).Tesseract) {
      setIsLibLoaded(true);
      return;
    }

    setIsLibLoading(true);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/tesseract.js@4.0.2/dist/tesseract.min.js';
    script.onload = () => {
      setIsLibLoaded(true);
      setIsLibLoading(false);
      logger.info('Tesseract.js loaded dynamically from CDN');
    };
    script.onerror = () => {
      setIsLibLoading(false);
      logger.error('Failed to load Tesseract.js from CDN');
    };
    document.body.appendChild(script);
  }, []);

  const performOCR = useCallback(async (imageSrc: string) => {
    if (!(window as any).Tesseract) {
      setStatusMessage('Error: OCR Library not loaded yet.');
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setStatusMessage('Initializing OCR engine...');

    try {
      const worker = await (window as any).Tesseract.createWorker({
        logger: (m: any) => {
          if (m.status === 'recognizing text') {
            setProgress(m.progress);
            setStatusMessage(`Extracting text: ${Math.round(m.progress * 100)}%`);
          }
        }
      });

      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      const { data: { text } } = await worker.recognize(imageSrc);
      await worker.terminate();

      setOcrText(text);
      setStatusMessage('Parsing signal details...');

      // Parse details
      const activeProvider = provider === 'Other' ? customProvider || 'Manual Paste' : provider;
      const parsed = await signalIntelligenceService.parseSignal(text, activeProvider);

      // Load form values
      setInstrument(parsed.instrument);
      setAction(parsed.action);
      setEntryPrice(parsed.entryPrice);
      setStopLoss(parsed.stopLoss || 0);
      setTarget1(parsed.target1 || 0);
      setTarget2(parsed.target2 || 0);
      setTarget3(parsed.target3 || 0);
      setNotes(parsed.notes || '');

      setStatusMessage('Analysis complete. Please review fields below.');
    } catch (err) {
      logger.error('OCR processing failed', err);
      setStatusMessage('Failed to extract text from image.');
    } finally {
      setIsProcessing(false);
    }
  }, [provider, customProvider]);

  const handleImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please select or paste an image file.');
      return;
    }
    const url = URL.createObjectURL(file);
    setImagePreview(url);
    performOCR(url);
  }, [performOCR]);

  // Drag and drop handlers
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleImageFile(e.dataTransfer.files[0]);
    }
  }, [handleImageFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Clipboard paste handler
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          handleImageFile(file);
          break;
        }
      }
    }
  }, [handleImageFile]);

  // Direct file input selection
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleImageFile(e.target.files[0]);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instrument || entryPrice <= 0) {
      alert('Instrument and Entry Price are required.');
      return;
    }

    setIsSaving(true);
    const activeProvider = provider === 'Other' ? customProvider || 'Custom Provider' : provider;

    const signalToSave: ParsedSignal = {
      instrument: instrument.toUpperCase().trim(),
      action,
      entryPrice,
      stopLoss: stopLoss > 0 ? stopLoss : undefined,
      target1: target1 > 0 ? target1 : undefined,
      target2: target2 > 0 ? target2 : undefined,
      target3: target3 > 0 ? target3 : undefined,
      provider: activeProvider,
      timestamp: new Date().toISOString(),
      status: 'ACTIVE', // Save straight to ACTIVE paper trade
      notes: notes.trim()
    };

    if (signalToSave.entryPrice && signalToSave.stopLoss && signalToSave.target1) {
      const risk = Math.abs(signalToSave.entryPrice - signalToSave.stopLoss);
      const reward = Math.abs(signalToSave.target1 - signalToSave.entryPrice);
      signalToSave.riskRewardRatio = Number((reward / (risk || 1)).toFixed(2));
    }

    try {
      await db.parsed_signals.add(signalToSave);
      await signalIntelligenceService.updateProviderStats(activeProvider);
      
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        setImagePreview(null);
        setOcrText('');
        setInstrument('');
        setEntryPrice(0);
        setStopLoss(0);
        setTarget1(0);
        setTarget2(0);
        setTarget3(0);
        setNotes('');
      }, 1500);

      onSignalSaved();
    } catch (err) {
      logger.error('Failed to save signal', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl shadow-xl relative overflow-hidden flex flex-col h-full justify-between">
      {/* Title */}
      <div className="mb-4 pb-3 border-b border-slate-800">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <Cpu className="w-5 h-5 text-indigo-400" /> 
          <span>OCR Signal Importer</span>
        </h3>
        <p className="text-xs text-slate-300 font-normal mt-1 leading-relaxed">
          Paste Telegram screenshot (Ctrl+V) or drag &amp; drop to parse details instantly.
        </p>
      </div>

      {/* Upload Zone */}
      {!imagePreview ? (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onPaste={handlePaste}
          tabIndex={0}
          className="flex-grow min-h-[160px] border-2 border-dashed border-slate-700/80 hover:border-indigo-400 rounded-xl flex flex-col items-center justify-center p-6 text-center cursor-pointer transition-all bg-slate-950/60 group outline-none focus:border-indigo-400"
          onClick={() => document.getElementById('ocr-file-input')?.click()}
        >
          <input
            id="ocr-file-input"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileInputChange}
          />
          {isLibLoading ? (
            <div className="flex flex-col items-center gap-2">
              <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
              <span className="text-xs text-indigo-300 font-medium">Loading Tesseract.js engine...</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="w-8 h-8 text-indigo-400/80 group-hover:text-indigo-300 transition-colors" />
              <span className="text-xs font-bold text-slate-200 group-hover:text-white">
                Drag &amp; Drop Screenshot here
              </span>
              <span className="text-xs text-slate-400 font-mono flex items-center gap-1.5">
                <Clipboard className="w-3.5 h-3.5 text-slate-400" /> Or click inside &amp; paste image (Ctrl+V)
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-grow flex flex-col gap-4">
          {/* Image & Status */}
          <div className="grid grid-cols-3 gap-4 bg-slate-950/35 border border-slate-800/80 rounded-xl p-3 items-center">
            <div className="col-span-1 aspect-video relative rounded overflow-hidden border border-slate-800">
              <img src={imagePreview} alt="Screenshot preview" className="object-cover w-full h-full" />
            </div>
            <div className="col-span-2 flex flex-col justify-center">
              <div className="flex items-center gap-2">
                {isProcessing ? (
                  <RefreshCw className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                )}
                <span className="text-xs font-mono font-bold text-slate-300">{statusMessage}</span>
              </div>
              {isProcessing && (
                <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
                  <div
                    className="bg-indigo-500 h-full rounded-full transition-all duration-150"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Form */}
          {!isProcessing && (
            <form onSubmit={handleSave} className="grid grid-cols-2 gap-3.5 text-xs">
              <div className="col-span-2 grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-300 uppercase font-bold tracking-wider mb-1">Provider</label>
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700/80 focus:border-indigo-400 rounded-lg p-2.5 text-slate-100 font-semibold outline-none cursor-pointer"
                  >
                    <option value="Manual Paste">Manual Paste</option>
                    {providers.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                    <option value="Other">Other (Write New)</option>
                  </select>
                </div>
                {provider === 'Other' && (
                  <div>
                    <label className="block text-[11px] text-slate-300 uppercase font-bold tracking-wider mb-1">Provider Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Swarm Trader"
                      value={customProvider}
                      onChange={(e) => setCustomProvider(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700/80 focus:border-indigo-400 rounded-lg p-2.5 text-slate-100 outline-none font-bold"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] text-slate-300 uppercase font-bold tracking-wider mb-1">Ticker / Instrument</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. NIFTY 23500 CE"
                  value={instrument}
                  onChange={(e) => setInstrument(e.target.value.toUpperCase())}
                  className="w-full bg-slate-950 border border-slate-700/80 focus:border-indigo-400 rounded-lg p-2.5 text-white outline-none font-bold uppercase font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-300 uppercase font-bold tracking-wider mb-1">Direction</label>
                <div className="grid grid-cols-4 border border-slate-700/80 rounded-lg overflow-hidden">
                  {(['BUY', 'SELL', 'SHORT', 'COVER'] as const).map((dir) => (
                    <button
                      key={dir}
                      type="button"
                      onClick={() => setAction(dir)}
                      className={`py-2 text-[11px] font-bold tracking-wider transition-colors cursor-pointer ${
                        action === dir 
                          ? dir === 'BUY' || dir === 'COVER' 
                            ? 'bg-emerald-500/20 text-emerald-300 border-r border-slate-700/80'
                            : 'bg-rose-500/20 text-rose-300 border-r border-slate-700/80'
                          : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {dir}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-300 uppercase font-bold tracking-wider mb-1">Entry Price ₹</label>
                <input
                  type="number"
                  step="any"
                  required
                  placeholder="0.00"
                  value={entryPrice || ''}
                  onChange={(e) => setEntryPrice(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-950 border border-slate-700/80 focus:border-indigo-400 rounded-lg p-2.5 text-white outline-none font-mono font-bold text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-300 uppercase font-bold tracking-wider mb-1">Stop Loss ₹</label>
                <input
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={stopLoss || ''}
                  onChange={(e) => setStopLoss(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-950 border border-rose-500/40 focus:border-rose-400 rounded-lg p-2.5 text-rose-300 outline-none font-mono font-bold text-xs"
                />
              </div>

              <div className="col-span-2 grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-300 uppercase font-bold tracking-wider mb-1">Target 1 ₹</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="0.00"
                    value={target1 || ''}
                    onChange={(e) => setTarget1(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-emerald-500/40 focus:border-emerald-400 rounded-lg p-2.5 text-emerald-300 outline-none font-mono font-bold text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-300 uppercase font-bold tracking-wider mb-1">Target 2 ₹</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="0.00"
                    value={target2 || ''}
                    onChange={(e) => setTarget2(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-emerald-500/40 focus:border-emerald-400 rounded-lg p-2.5 text-emerald-300 outline-none font-mono font-bold text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-300 uppercase font-bold tracking-wider mb-1">Target 3 ₹</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="0.00"
                    value={target3 || ''}
                    onChange={(e) => setTarget3(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-emerald-500/40 focus:border-emerald-400 rounded-lg p-2.5 text-emerald-300 outline-none font-mono font-bold text-xs"
                  />
                </div>
              </div>

              <div className="col-span-2">
                <label className="block text-[11px] text-slate-300 uppercase font-bold tracking-wider mb-1">Parsed Context / Notes</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional context extracted from screenshot..."
                  className="w-full bg-slate-950 border border-slate-700/80 focus:border-indigo-400 rounded-lg p-2.5 text-slate-200 outline-none resize-none font-sans text-xs"
                />
              </div>

              <div className="col-span-2 flex gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => {
                    setImagePreview(null);
                    setOcrText('');
                  }}
                  className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold uppercase rounded-xl border border-slate-750 transition-all flex items-center justify-center gap-1 text-xs tracking-wider cursor-pointer"
                >
                  Discard
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-[2] py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold uppercase rounded-xl transition-all flex items-center justify-center gap-2 text-xs tracking-wider shadow-lg shadow-indigo-600/25 cursor-pointer"
                >
                  {isSaving ? (
                    'Saving Paper Trade...'
                  ) : saveSuccess ? (
                    <>
                      <Check className="w-4 h-4" /> Saved Successfully!
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" /> Save Paper Trade
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
};
