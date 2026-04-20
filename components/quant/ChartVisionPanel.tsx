import React, { useState, useEffect, useRef } from 'react';
import { Upload, Eye, RefreshCw, AlertTriangle, TrendingUp, TrendingDown, ArrowRight, ShieldAlert, CheckCircle, HelpCircle, History, FileText } from 'lucide-react';
import { ChartVisionService, ChartVisionResult, ChartPattern, chartVisionHistory, HistoryItem } from '../../services/ChartVisionService';
import { useToast } from '../shared/ToastProvider';
import { EmptyState } from '../shared/EmptyState';

export const ChartVisionPanel: React.FC = () => {
  const { toast } = useToast();
  const [ticker, setTicker] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [result, setResult] = useState<ChartVisionResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activePatternIdx, setActivePatternIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load history on mount
  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    const items = await chartVisionHistory.getHistory();
    setHistory(items);
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Only image files (png, jpeg, webp) are supported.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        setImageSrc(e.target.result as string);
        setResult(null);
        setActivePatternIdx(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  // Support paste event (Ctrl+V) for screenshot convenience
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (e.clipboardData && e.clipboardData.files.length > 0) {
        processFile(e.clipboardData.files[0]);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const handleAnalyze = async () => {
    if (!imageSrc) {
      toast.error('Please upload or paste a chart screenshot first.');
      return;
    }

    setIsAnalyzing(true);
    try {
      const analysis = await ChartVisionService.analyzeChart(imageSrc, ticker);
      setResult(analysis);
      toast.success('Chart analysis completed successfully.');
      loadHistory();
    } catch (e: any) {
      toast.error(e.message || 'Failed to analyze chart.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSelectHistory = (item: HistoryItem) => {
    setImageSrc(item.imageBase64);
    setResult(item.result);
    setTicker(item.ticker || '');
    setActivePatternIdx(null);
    toast.success('Loaded analysis from history.');
  };

  const getTrendColor = (trend: string) => {
    if (trend === 'BULLISH') return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
    if (trend === 'BEARISH') return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
    return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
  };

  // Helper to draw specific shapes in 1000x1000 coordinate space
  const renderPatternShape = (pattern: ChartPattern, idx: number) => {
    const coords = pattern.relativeCoords;
    if (!coords || !coords.patternStart || !coords.patternEnd) return null;

    const isActive = activePatternIdx === null || activePatternIdx === idx;
    if (!isActive) return null;

    const startX = coords.patternStart.x * 1000;
    const startY = coords.patternStart.y * 1000;
    const endX = coords.patternEnd.x * 1000;
    const endY = coords.patternEnd.y * 1000;

    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);
    const leftX = Math.min(startX, endX);
    const topY = Math.min(startY, endY);

    const color = "stroke-indigo-500";
    const fill = "fill-indigo-500/10";
    const strokeWidth = "6";

    // Draw customized shapes based on pattern type
    const type = pattern.type.toLowerCase();
    if (type.includes('shoulders')) {
      // Draw head and shoulders silhouette
      const shoulderY = topY + height * 0.4;
      const headY = topY;
      const path = `
        M ${leftX} ${endY}
        Q ${leftX + width * 0.25} ${shoulderY} ${leftX + width * 0.25} ${shoulderY}
        Q ${leftX + width * 0.5} ${headY} ${leftX + width * 0.5} ${headY}
        Q ${leftX + width * 0.75} ${shoulderY} ${leftX + width * 0.75} ${shoulderY}
        Q ${endX} ${endY} ${endX} ${endY}
      `;
      return (
        <g key={`shape-${idx}`}>
          <path d={path} className={`${color} ${fill}`} strokeWidth={strokeWidth} strokeLinecap="round" />
          <line x1={leftX} y1={endY} x2={endX} y2={endY} className="stroke-indigo-400 stroke-2 stroke-dasharray-[10,5]" />
          <text x={leftX + width * 0.5} y={topY - 15} textAnchor="middle" className="fill-indigo-400 text-[20px] font-black font-mono">
            {pattern.type}
          </text>
        </g>
      );
    }

    if (type.includes('flag') || type.includes('pennant')) {
      // Flagpole + Flag Channel
      return (
        <g key={`shape-${idx}`}>
          {/* Flagpole */}
          <line x1={leftX} y1={endY} x2={leftX} y2={topY} className={`${color}`} strokeWidth={strokeWidth} />
          {/* Flag body */}
          <polygon
            points={`
              ${leftX},${topY} 
              ${endX},${topY + height * 0.2} 
              ${endX},${topY + height * 0.6} 
              ${leftX},${topY + height * 0.4}
            `}
            className={`${color} ${fill}`}
            strokeWidth={strokeWidth}
          />
          <text x={leftX + width * 0.5} y={topY - 15} textAnchor="middle" className="fill-indigo-400 text-[20px] font-black font-mono">
            {pattern.type}
          </text>
        </g>
      );
    }

    if (type.includes('triangle') || type.includes('wedge')) {
      // Triangle shape
      return (
        <g key={`shape-${idx}`}>
          <polygon
            points={`
              ${leftX},${topY} 
              ${endX},${topY + height * 0.5} 
              ${leftX},${endY}
            `}
            className={`${color} ${fill}`}
            strokeWidth={strokeWidth}
          />
          <text x={leftX + width * 0.3} y={topY - 15} textAnchor="middle" className="fill-indigo-400 text-[20px] font-black font-mono">
            {pattern.type}
          </text>
        </g>
      );
    }

    if (type.includes('double top') || type.includes('m-top')) {
      // Two circles on peaks + neckline
      return (
        <g key={`shape-${idx}`}>
          <circle cx={leftX + width * 0.25} cy={topY} r="25" className={`${color} ${fill}`} strokeWidth={strokeWidth} />
          <circle cx={leftX + width * 0.75} cy={topY} r="25" className={`${color} ${fill}`} strokeWidth={strokeWidth} />
          <line x1={leftX} y1={endY} x2={endX} y2={endY} className="stroke-indigo-400 stroke-2 stroke-dasharray-[8,4]" />
          <text x={leftX + width * 0.5} y={topY - 35} textAnchor="middle" className="fill-indigo-400 text-[20px] font-black font-mono">
            {pattern.type}
          </text>
        </g>
      );
    }

    if (type.includes('double bottom') || type.includes('w-bottom')) {
      // Two circles on valleys
      return (
        <g key={`shape-${idx}`}>
          <circle cx={leftX + width * 0.25} cy={endY} r="25" className={`${color} ${fill}`} strokeWidth={strokeWidth} />
          <circle cx={leftX + width * 0.75} cy={endY} r="25" className={`${color} ${fill}`} strokeWidth={strokeWidth} />
          <line x1={leftX} y1={topY} x2={endX} y2={topY} className="stroke-indigo-400 stroke-2 stroke-dasharray-[8,4]" />
          <text x={leftX + width * 0.5} y={topY - 15} textAnchor="middle" className="fill-indigo-400 text-[20px] font-black font-mono">
            {pattern.type}
          </text>
        </g>
      );
    }

    // Default bounding box
    return (
      <g key={`shape-${idx}`}>
        <rect
          x={leftX}
          y={topY}
          width={width}
          height={height}
          className={`${color} ${fill}`}
          strokeWidth={strokeWidth}
          rx="10"
        />
        <text x={leftX + width * 0.5} y={topY - 15} textAnchor="middle" className="fill-indigo-400 text-[20px] font-black font-mono">
          {pattern.type}
        </text>
      </g>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-950 dark:text-white flex items-center gap-2">
            <Eye className="text-indigo-500" size={20} /> AI Chart Pattern Scanner
          </h3>
          <p className="text-xs text-slate-500">
            Upload a chart screenshot to scan patterns, support/resistance lines, and target zones via Gemini Multimodal.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Ticker (e.g. NIFTY, BTC)"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            className="px-3 py-1.5 text-xs rounded-xl bg-slate-50 border border-slate-200 focus:outline-none dark:bg-slate-900 dark:border-slate-800 dark:text-white"
          />
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || !imageSrc}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAnalyzing ? <RefreshCw className="animate-spin" size={14} /> : <Eye size={14} />}
            {isAnalyzing ? 'Scanning Chart...' : 'Analyze Pattern'}
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Upload Zone & Interactive Canvas */}
        <div className="lg:col-span-2 space-y-4">
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !imageSrc && fileInputRef.current?.click()}
            className={`relative rounded-[28px] border-2 border-dashed flex flex-col items-center justify-center min-h-[420px] p-6 transition-all bg-slate-50/50 dark:bg-slate-950/20 overflow-hidden ${
              imageSrc ? 'border-transparent' : dragOver ? 'border-indigo-500 bg-indigo-50/20' : 'border-slate-200 hover:border-slate-300 dark:border-slate-800'
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*"
              className="hidden"
            />

            {!imageSrc ? (
              <div className="text-center space-y-3 cursor-pointer">
                <div className="mx-auto w-12 h-12 bg-indigo-50 dark:bg-slate-900 rounded-2xl flex items-center justify-center text-indigo-500">
                  <Upload size={22} />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200">Drag & Drop Chart Screenshot</p>
                  <p className="text-[10px] text-slate-400 mt-1">Or click to browse, or paste (Ctrl+V) directly from clipboard</p>
                </div>
              </div>
            ) : (
              <div className="relative w-full h-full flex items-center justify-center">
                {/* Original Image */}
                <img
                  src={imageSrc}
                  alt="Chart Preview"
                  className="max-h-[420px] object-contain rounded-2xl"
                />

                {/* SVG Annotation Overlay */}
                {result && (
                  <svg
                    viewBox="0 0 1000 1000"
                    preserveAspectRatio="none"
                    className="absolute inset-0 w-full h-full pointer-events-none z-10"
                  >
                    {/* Render Level Lines */}
                    {result.patterns.map((p, idx) => {
                      const coords = p.relativeCoords;
                      if (!coords) return null;
                      const isActive = activePatternIdx === null || activePatternIdx === idx;
                      if (!isActive) return null;

                      return (
                        <g key={`levels-${idx}`}>
                          {/* Breakout Level */}
                          {coords.breakoutLevel !== undefined && (
                            <g>
                              <line
                                x1="0"
                                y1={coords.breakoutLevel * 1000}
                                x2="1000"
                                y2={coords.breakoutLevel * 1000}
                                className="stroke-indigo-400 stroke-4 stroke-dasharray-[12,6]"
                              />
                              <rect x="20" y={coords.breakoutLevel * 1000 - 30} width="160" height="26" rx="6" className="fill-indigo-950/80 stroke-indigo-400/20 stroke" />
                              <text x="30" y={coords.breakoutLevel * 1000 - 12} className="fill-indigo-300 text-[14px] font-bold font-mono">Breakout: {p.entryZone}</text>
                            </g>
                          )}

                          {/* Target Level */}
                          {coords.targetLevel !== undefined && (
                            <g>
                              <line
                                x1="0"
                                y1={coords.targetLevel * 1000}
                                x2="1000"
                                y2={coords.targetLevel * 1000}
                                className="stroke-emerald-500 stroke-4"
                              />
                              <rect x="20" y={coords.targetLevel * 1000 - 30} width="160" height="26" rx="6" className="fill-emerald-950/80 stroke-emerald-500/20 stroke" />
                              <text x="30" y={coords.targetLevel * 1000 - 12} className="fill-emerald-300 text-[14px] font-bold font-mono">Target: {p.target}</text>
                            </g>
                          )}

                          {/* Stop Loss Level */}
                          {coords.slLevel !== undefined && (
                            <g>
                              <line
                                x1="0"
                                y1={coords.slLevel * 1000}
                                x2="1000"
                                y2={coords.slLevel * 1000}
                                className="stroke-rose-500 stroke-4"
                              />
                              <rect x="20" y={coords.slLevel * 1000 - 30} width="160" height="26" rx="6" className="fill-rose-950/80 stroke-rose-500/20 stroke" />
                              <text x="30" y={coords.slLevel * 1000 - 12} className="fill-rose-300 text-[14px] font-bold font-mono">StopLoss: {p.stopLoss}</text>
                            </g>
                          )}
                        </g>
                      );
                    })}

                    {/* Render Pattern Outline Shapes */}
                    {result.patterns.map((p, idx) => renderPatternShape(p, idx))}
                  </svg>
                )}

                {/* Reset Image Control */}
                {!isAnalyzing && (
                  <button
                    onClick={() => {
                      setImageSrc(null);
                      setResult(null);
                      setActivePatternIdx(null);
                    }}
                    className="absolute top-4 right-4 bg-slate-950/80 hover:bg-slate-900 text-white rounded-xl px-2.5 py-1.5 text-[10px] font-bold transition-all pointer-events-auto"
                  >
                    Clear Chart
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Results / Panel Details */}
        <div className="space-y-4">
          {isAnalyzing && (
            <div className="rounded-[28px] border border-slate-200/80 bg-white p-6 dark:border-slate-800 dark:bg-slate-900/50 flex flex-col items-center justify-center py-20 text-center space-y-4">
              <RefreshCw className="animate-spin text-indigo-500" size={36} />
              <div>
                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Running Computer Vision Scanner</h4>
                <p className="text-[11px] text-slate-400 mt-1">Scanning candlestick structures, trend lines, and support/resistance zones...</p>
              </div>
            </div>
          )}

          {!isAnalyzing && !result && (
            <div className="rounded-[28px] border border-slate-200/80 bg-white p-6 dark:border-slate-800 dark:bg-slate-900/50 space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                <History size={16} className="text-slate-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Scanner History</h4>
              </div>

              <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                {history.map((item, idx) => (
                  <button
                    key={item.id || idx}
                    onClick={() => handleSelectHistory(item)}
                    className="w-full text-left p-3 rounded-2xl bg-slate-50/50 hover:bg-slate-100 dark:bg-slate-950/30 dark:hover:bg-slate-950/50 border border-slate-200/50 dark:border-slate-800/50 transition-all flex items-start gap-3"
                  >
                    <img
                      src={item.imageBase64}
                      alt="Thumbnail"
                      className="w-12 h-12 object-cover rounded-xl border border-slate-200/50 dark:border-slate-800"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start">
                        <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                          {item.ticker || 'Unknown Asset'}
                        </h5>
                        <span className="text-[9px] text-slate-400 font-mono">
                          {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-[10px] text-indigo-500 font-bold truncate mt-1">
                        {item.result.patterns[0]?.type || 'No patterns'} ({item.result.patterns[0]?.confidence || 0}% conf)
                      </p>
                      <span className={`inline-block text-[9px] font-bold uppercase px-1.5 py-0.5 rounded mt-1.5 ${getTrendColor(item.result.trend)}`}>
                        {item.result.trend}
                      </span>
                    </div>
                  </button>
                ))}

                {history.length === 0 && (
                  <EmptyState
                    variant="minimal"
                    type="setup-required"
                    message="No scanner history found. Upload a chart to begin."
                    icon={Upload}
                  />
                )}
              </div>
            </div>
          )}

          {!isAnalyzing && result && (
            <div className="space-y-4">
              {/* Trend & Bias Summary */}
              <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/50 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Market Structure</span>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider ${getTrendColor(result.trend)}`}>
                    {result.trend} • {result.trendStrength}
                  </span>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-950/40 rounded-2xl border border-slate-200/30 dark:border-slate-800/30 space-y-1">
                  <span className="text-[9px] font-bold uppercase text-slate-400">Trading Bias</span>
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100 leading-relaxed">
                    {result.tradingBias}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 bg-slate-50/50 dark:bg-slate-950/20 rounded-xl">
                    <span className="text-[9px] text-slate-400 block mb-0.5">Timeframe</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300">{result.timeframeGuess}</span>
                  </div>
                  <div className="p-2.5 bg-slate-50/50 dark:bg-slate-950/20 rounded-xl">
                    <span className="text-[9px] text-slate-400 block mb-0.5">Confidence</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300">{result.confidence}% Match</span>
                  </div>
                </div>
              </div>

              {/* Detected Patterns */}
              <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/50 space-y-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block pb-1 border-b border-slate-100 dark:border-slate-800">
                  Detected Candle Patterns
                </span>

                <div className="space-y-3">
                  {result.patterns.map((pattern, idx) => (
                    <div
                      key={idx}
                      onMouseEnter={() => setActivePatternIdx(idx)}
                      onMouseLeave={() => setActivePatternIdx(null)}
                      className={`p-3 rounded-2xl border transition-all cursor-pointer ${
                        activePatternIdx === idx
                          ? 'border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/10'
                          : 'border-slate-200/60 bg-slate-50/50 dark:border-slate-850 dark:bg-slate-950/30'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">{pattern.type}</h4>
                        <span className="text-[10px] font-bold text-indigo-500 px-1.5 py-0.5 rounded bg-indigo-500/10">
                          {pattern.confidence}% Match
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                        {pattern.description}
                      </p>

                      <div className="mt-3 grid grid-cols-3 gap-1.5 text-[9px] font-mono">
                        <div className="p-1 rounded bg-indigo-500/5 text-indigo-500 text-center font-bold">
                          In: {pattern.entryZone.split(' ').pop()}
                        </div>
                        <div className="p-1 rounded bg-emerald-500/5 text-emerald-500 text-center font-bold">
                          Tgt: {pattern.target.split(' ').shift()}
                        </div>
                        <div className="p-1 rounded bg-rose-500/5 text-rose-500 text-center font-bold">
                          SL: {pattern.stopLoss.split(' ').pop()}
                        </div>
                      </div>
                    </div>
                  ))}

                  {result.patterns.length === 0 && (
                    <div className="py-4 text-center text-[10px] text-slate-400 italic">
                      No distinct chart patterns detected.
                    </div>
                  )}
                </div>
              </div>

              {/* Levels & Observations */}
              <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/50 space-y-4">
                {/* Levels Grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-bold uppercase text-rose-400">Support Levels</span>
                    <div className="flex flex-wrap gap-1">
                      {result.supportLevels.map((lvl, idx) => (
                        <span key={idx} className="px-2 py-0.5 bg-rose-500/10 text-rose-400 rounded-lg text-[10px] font-mono font-bold">
                          {lvl}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-bold uppercase text-emerald-400">Resistance Levels</span>
                    <div className="flex flex-wrap gap-1">
                      {result.resistanceLevels.map((lvl, idx) => (
                        <span key={idx} className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-lg text-[10px] font-mono font-bold">
                          {lvl}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Key Observations */}
                <div className="space-y-2 border-t border-slate-100 dark:border-slate-850 pt-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Key Observations
                  </span>
                  <ul className="space-y-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {result.keyObservations.map((obs, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="text-indigo-500 mt-0.5">•</span>
                        <span>{obs}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default ChartVisionPanel;
