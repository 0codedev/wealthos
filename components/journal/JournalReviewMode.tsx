import React, { useState, useEffect, useRef } from 'react';
import { db, Trade } from '../../database';
import { liveQuery } from 'dexie';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Mic, 
  CheckCircle2, 
  ChevronRight, 
  AlertCircle, 
  Tag, 
  Brain, 
  Smile, 
  Frown, 
  SkipForward 
} from 'lucide-react';
import { useToast } from '../shared/ToastProvider';
import { llmPipeline } from '../../services/llm';
import { logger } from '../../services/Logger';

const JournalReviewMode: React.FC = () => {
  const { toast } = useToast();
  const [untaggedTrades, setUntaggedTrades] = useState<Trade[]>([]);

  // 1. Fetch untagged trades (No notes or no mood)
  useEffect(() => {
    const sub = liveQuery(
      () => db.trades.filter(t => !t.notes || !t.moodEntry).toArray()
    ).subscribe(setUntaggedTrades);
    return () => sub.unsubscribe();
  }, []);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<any>(null);
  const [notes, setNotes] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const currentTrade = untaggedTrades?.[currentIndex];

  // 2. Listen for text entry (for Groq Dictate)
  useEffect(() => {
    if (notes.length > 10 && !isAnalyzing) {
      const timer = setTimeout(() => {
        handleAutoAnalyze();
      }, 1000); // Wait for user to finish speaking
      return () => clearTimeout(timer);
    }
  }, [notes]);

  const handleAutoAnalyze = async () => {
    if (!notes || notes.length < 10) return;
    
    setIsAnalyzing(true);
    const prompt = `
      Analyze this trader's journal entry and extract metadata:
      "${notes}"

      Respond ONLY with a JSON object:
      {
        "emotion": "Confident|Anxious|Greedy|Fearful|Focused",
        "mistake": "None|FOMO|Revenge Trading|Early Exit|Over-leveraged|Stop-Loss Moved",
        "strategy": "Breakout|Mean Reversion|Trend Following|Scalp"
      }
    `;

    try {
      const response = await llmPipeline(prompt, {
        modelOverride: 'llama-3.1-8b-instant', // Fast model for real-time feedback
        jsonMode: true
      });
      
      let result;
      try {
        result = JSON.parse(response.text.replace(/```json|```/g, '').trim());
      } catch (e) {
        logger.error("Failed to parse AI response", response.text);
        throw new Error("Invalid AI response format");
      }
      
      setAiSuggestions(result);
    } catch (error) {
      logger.error("JournalReview: AI Analysis failed", error);
      toast.error("AI Analysis failed. Using defaults.");
      setAiSuggestions({
        emotion: "Focused",
        mistake: "None",
        strategy: "Unknown"
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSaveAndNext = async () => {
    if (!currentTrade) return;

    try {
      await db.trades.update(currentTrade.id!, {
        notes: notes,
        moodEntry: aiSuggestions?.emotion || 'Focused',
        mistakes: aiSuggestions?.mistake ? [aiSuggestions.mistake] : [],
        setup: aiSuggestions?.strategy || currentTrade.setup,
        reviewStatus: 'READY_FOR_LESSON'
      });

      // Reset for next
      setNotes("");
      setAiSuggestions(null);
      setCurrentIndex(prev => prev + 1);
    } catch (error) {
      console.error("Failed to update trade:", error);
      toast.error("Failed to save review. Please try again.");
    }
  };

  if (!untaggedTrades) return <div className="p-10 text-slate-400">Loading backlog...</div>;
  if (untaggedTrades.length === 0 || currentIndex >= untaggedTrades.length) {
    return (
      <div className="flex flex-col items-center justify-center h-[440px] md:h-[600px] text-center p-10">
        <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mb-6">
          <CheckCircle2 className="w-10 h-10 text-emerald-500" />
        </div>
        <h2 className="text-3xl font-black text-white mb-2">Clean Slate!</h2>
        <p className="text-slate-400 max-w-md">Every trade is now documented. Your mental edge is sharpened.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <Brain className="text-indigo-500" />
            Journal Speed-Run
          </h1>
          <p className="text-slate-500">Tagging {untaggedTrades.length - currentIndex} remaining trades</p>
        </div>
        <div className="bg-slate-900 rounded-full px-4 py-1 border border-slate-800 text-xs font-mono text-indigo-400">
          STEP {currentIndex + 1} / {untaggedTrades.length}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={currentTrade.id}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6"
        >
          {/* Left: Trade Data Card */}
          <div className="bg-slate-950 rounded-[32px] p-8 border border-slate-800 shadow-2xl">
            <div className="flex justify-between items-start mb-6">
              <div>
                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider mb-2 inline-block ${
                  currentTrade.direction === 'Long' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'
                }`}>
                  {currentTrade.direction}
                </span>
                <h2 className="text-4xl font-black text-white">{currentTrade.ticker}</h2>
                <p className="text-slate-500 mt-1">{new Date(currentTrade.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
              </div>
              <div className={`text-2xl font-black ${currentTrade.pnl! >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {currentTrade.pnl! >= 0 ? '+' : ''}{currentTrade.pnl?.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-slate-900/50 rounded-2xl p-4 border border-slate-800/50">
                <p className="text-[10px] text-slate-500 uppercase font-black mb-1">Entry</p>
                <p className="text-xl font-bold text-white">₹{currentTrade.entryPrice}</p>
              </div>
              <div className="bg-slate-900/50 rounded-2xl p-4 border border-slate-800/50">
                <p className="text-[10px] text-slate-500 uppercase font-black mb-1">Exit</p>
                <p className="text-xl font-bold text-white">₹{currentTrade.exitPrice}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Quantity</span>
                <span className="text-white font-bold">{currentTrade.quantity}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Asset Class</span>
                <span className="text-white font-bold">{currentTrade.assetClass || 'Options'}</span>
              </div>
            </div>
          </div>

          {/* Right: AI Analysis & Notes */}
          <div className="flex flex-col gap-6">
            <div className="bg-slate-950 rounded-[32px] p-8 border border-slate-800 flex-1 relative">
              <div className="flex items-center gap-2 mb-4">
                <Mic className="w-4 h-4 text-rose-500" />
                <h3 className="text-sm font-black text-white uppercase tracking-widest">Voice Journal</h3>
              </div>
              
              <textarea
                ref={noteRef}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Hold F8 and describe the trade..."
                className="w-full h-40 bg-transparent text-white text-lg placeholder:text-slate-700 resize-none focus:outline-none border-none"
              />

              {isAnalyzing && (
                <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm rounded-[32px] flex items-center justify-center">
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-indigo-400 font-bold animate-pulse">Gemini analyzing...</p>
                  </div>
                </div>
              )}

              {aiSuggestions && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 pt-6 border-t border-slate-800 space-y-4"
                >
                  <div className="flex flex-wrap gap-2">
                    <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg px-3 py-1 flex items-center gap-2">
                      <Smile className="w-3 h-3 text-indigo-400" />
                      <span className="text-[10px] font-black text-white uppercase">{aiSuggestions.emotion}</span>
                    </div>
                    {aiSuggestions.mistake !== "None" && (
                      <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-1 flex items-center gap-2">
                        <Frown className="w-3 h-3 text-rose-400" />
                        <span className="text-[10px] font-black text-white uppercase">{aiSuggestions.mistake}</span>
                      </div>
                    )}
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-1 flex items-center gap-2">
                      <Tag className="w-3 h-3 text-emerald-400" />
                      <span className="text-[10px] font-black text-white uppercase">{aiSuggestions.strategy}</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>

            <div className="flex gap-4">
              <button 
                onClick={() => setCurrentIndex(prev => prev + 1)}
                className="flex-1 py-4 rounded-2xl bg-slate-900 text-slate-400 font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors"
              >
                <SkipForward className="w-4 h-4" />
                Skip
              </button>
              <button 
                onClick={handleSaveAndNext}
                disabled={!notes && !aiSuggestions}
                className="flex-[2] py-4 rounded-2xl bg-indigo-600 text-white font-black flex items-center justify-center gap-2 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_0_20px_rgba(79,70,229,0.4)]"
              >
                Commit & Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default JournalReviewMode;
