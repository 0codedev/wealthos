import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Send, X, Database, Sparkles, RefreshCw, AlertCircle, ChevronDown, ChevronUp
} from 'lucide-react';
import { personalizedBrain } from '../../services/brain/PersonalizedBrain';
import { vectorMemoryService } from '../../services/brain/VectorMemoryService';
import { RetrievedDoc } from '../../services/brain/RAGQueryEngine';
import { db } from '../../database';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  sources?: RetrievedDoc[];
}

export const BrainChat: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState('');
  const [hasScanned, setHasScanned] = useState(false);
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Check if we already have indexed vectors
  useEffect(() => {
    db.brain_vectors.count().then((count: number) => {
      setHasScanned(count > 0);
    });
  }, [isScanning]);

  // Auto scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isThinking]);

  const handleScan = async () => {
    setIsScanning(true);
    setScanProgress(0);
    setScanStatus('Starting deep scan...');
    
    await vectorMemoryService.runDeepScan((progress, statusText) => {
      setScanProgress(progress);
      setScanStatus(statusText);
    });

    setIsScanning(false);
    setHasScanned(true);
  };

  const handleSend = async (textToSend?: string) => {
    const queryText = (textToSend || input).trim();
    if (!queryText) return;

    if (!textToSend) setInput('');

    const userMsg: Message = {
      id: `msg-${Date.now()}-user`,
      sender: 'user',
      text: queryText
    };

    setMessages(prev => [...prev, userMsg]);
    setIsThinking(true);

    try {
      const response = await personalizedBrain.query(queryText);
      const assistantMsg: Message = {
        id: `msg-${Date.now()}-ai`,
        sender: 'assistant',
        text: response.answer,
        sources: response.sources
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const errorMsg: Message = {
        id: `msg-${Date.now()}-err`,
        sender: 'assistant',
        text: 'I had trouble processing that query. Please make sure your database is indexed and try again.'
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <>
      {/* Floating Action Trigger Button */}
      <div className="fixed bottom-6 right-24 z-[210]">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsOpen(!isOpen)}
          className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 flex items-center justify-center text-white shadow-xl shadow-indigo-500/20 border border-indigo-400/30 backdrop-blur-md cursor-pointer relative"
          aria-label="Ask Trading Brain"
        >
          <Brain size={20} className="animate-pulse" />
          {hasScanned && (
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-slate-900 rounded-full" />
          )}
        </motion.button>
      </div>

      {/* Floating Glassmorphism Chat Drawer */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 30 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed bottom-22 right-6 w-[380px] h-[550px] bg-slate-900/90 dark:bg-slate-950/95 border border-slate-800 dark:border-indigo-500/30 rounded-3xl shadow-2xl overflow-hidden z-[250] flex flex-col backdrop-blur-xl"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-800/80 bg-slate-950/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain size={18} className="text-indigo-400" />
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Trading Brain</h3>
                  <p className="text-[9px] text-slate-400">Local Vector RAG Engine</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleScan}
                  disabled={isScanning}
                  className={`p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-40 cursor-pointer`}
                  title="Run Deep Database Index Scan"
                >
                  <RefreshCw size={13} className={isScanning ? 'animate-spin' : ''} />
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Scan Progress Bar */}
            {isScanning && (
              <div className="bg-indigo-950/20 border-b border-indigo-500/20 px-5 py-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-[9px] text-indigo-300">
                  <span className="font-mono">{scanStatus}</span>
                  <span className="font-bold">{scanProgress}%</span>
                </div>
                <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-300"
                    style={{ width: `${scanProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Chat Body */}
            <div ref={scrollRef} className="flex-1 p-4 overflow-y-auto space-y-4">
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center p-5 space-y-4">
                  <div className="w-10 h-10 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                    <Sparkles size={16} className="text-indigo-400" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white mb-1">On-Device Intelligence</h4>
                    <p className="text-[10px] text-slate-400 leading-relaxed max-w-[240px]">
                      {!hasScanned
                        ? 'Trigger a deep scan of your database using the refresh button above to index your trading history.'
                        : 'Ask me anything about your past trades, signal win rates, or mood triggers. Fully local and secure.'}
                    </p>
                  </div>
                </div>
              )}

              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[85%] text-xs px-3.5 py-2.5 rounded-2xl shadow-md leading-relaxed ${
                      m.sender === 'user'
                        ? 'bg-indigo-600 text-white rounded-tr-none'
                        : 'bg-slate-900 border border-slate-800/80 text-slate-200 rounded-tl-none'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.text}</p>
                  </div>

                  {/* Collapsible Sources Section */}
                  {m.sources && m.sources.length > 0 && (
                    <div className="w-[85%] mt-1.5 bg-slate-900/40 rounded-xl border border-slate-800/60 overflow-hidden">
                      <button
                        onClick={() => setOpenSourceId(openSourceId === m.id ? null : m.id)}
                        className="w-full px-3 py-1.5 flex items-center justify-between text-[9px] text-indigo-400 font-bold hover:bg-slate-800/20 transition-colors"
                      >
                        <span className="flex items-center gap-1">
                          <Database size={9} /> Sources Referenced ({m.sources.length})
                        </span>
                        {openSourceId === m.id ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                      </button>
                      
                      <AnimatePresence>
                        {openSourceId === m.id && (
                          <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: 'auto' }}
                            exit={{ height: 0 }}
                            className="overflow-hidden border-t border-slate-800/50"
                          >
                            <div className="p-2 space-y-1.5 max-h-40 overflow-y-auto">
                              {m.sources.map((s, idx) => (
                                <div key={idx} className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/40 space-y-1">
                                  <div className="flex items-center justify-between text-[8px] font-black uppercase tracking-wider text-slate-400">
                                    <span>{s.docType}</span>
                                    <span>Ref: #{s.docId}</span>
                                  </div>
                                  <p className="text-[9.5px] text-slate-300 italic leading-normal font-mono">
                                    &ldquo;{s.text.length > 120 ? s.text.substring(0, 120) + '...' : s.text}&rdquo;
                                  </p>
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              ))}

              {isThinking && (
                <div className="flex items-center gap-1 text-[10px] text-indigo-400 italic">
                  <Brain size={12} className="animate-spin" /> Analyzing trading records...
                </div>
              )}
            </div>

            {/* Quick Suggestion Chips */}
            {messages.length === 0 && hasScanned && (
              <div className="px-4 py-2 border-t border-slate-800/60 bg-slate-950/20">
                <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Suggested Queries</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'What is my win rate on BANKNIFTY?',
                    'Which setup gives me best returns?',
                    'Summarize my main mistakes.'
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => handleSend(q)}
                      className="text-[9px] px-2 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-300 hover:border-indigo-500/50 hover:text-white transition-colors cursor-pointer"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input Footer */}
            <div className="p-4 border-t border-slate-800/80 bg-slate-950/40">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    !hasScanned
                      ? 'Index database first...'
                      : 'Ask about your trading history...'
                  }
                  disabled={!hasScanned || isScanning}
                  className="flex-1 bg-slate-900 border border-slate-850 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all disabled:opacity-40"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isScanning || !hasScanned}
                  className="p-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-800 disabled:text-slate-600 text-white transition-all shadow-md shadow-indigo-500/10 cursor-pointer"
                >
                  <Send size={12} />
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
export default BrainChat;
