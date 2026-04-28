import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Zap, TrendingUp, AlertTriangle, X, Check, Activity, ShieldAlert, Edit2 } from 'lucide-react';
import { TelegramSignalParser, ParsedSignal } from '../../../services/TelegramSignalParser';
import { DhanScripResolver } from '../../../services/DhanScripResolver';
import { dhanOrderService } from '../../../services/DhanOrderService';
import { useSettingsStore } from '../../../store/settingsStore';
import { useSandboxStore } from '../../../store/sandboxStore';
import { useToast } from '../../shared/ToastProvider';

// --- Editable Card Component ---
const EditableSignalCard = ({ 
    signalId, 
    rawText, 
    timestamp, 
    initialParsed, 
    onExecute, 
    onRemove, 
    isExecuting 
}: {
    signalId: string;
    rawText: string;
    timestamp: number;
    initialParsed?: ParsedSignal;
    onExecute: (id: string, signal: ParsedSignal, qty: number, target: number | null) => void;
    onRemove: (id: string) => void;
    isExecuting: boolean;
}) => {
    const [edited, setEdited] = useState<ParsedSignal | null>(null);
    const [quantity, setQuantity] = useState<number>(1);
    const [selectedTarget, setSelectedTarget] = useState<number | null>(null);

    useEffect(() => {
        if (initialParsed && !edited) {
            setEdited(initialParsed);
            if (initialParsed.targets && initialParsed.targets.length > 0) {
                setSelectedTarget(initialParsed.targets[0]);
            }
        }
    }, [initialParsed]);

    if (!edited) {
        return (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 relative">
                <button onClick={() => onRemove(signalId)} className="absolute top-3 right-3 text-slate-500 hover:text-red-400"><X className="w-4 h-4" /></button>
                <div className="mb-3">
                    <p className="text-xs text-slate-500 mb-1">{new Date(timestamp).toLocaleTimeString()}</p>
                    <p className="text-sm text-slate-300 whitespace-pre-wrap font-mono bg-slate-900/50 p-2 rounded">{rawText}</p>
                </div>
                <div className="border-t border-slate-700/50 pt-3 mt-3 flex items-center justify-center space-x-2 text-indigo-400">
                    <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm font-medium">AI Parsing Signal...</span>
                </div>
            </motion.div>
        );
    }

    return (
        <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-slate-800/60 border border-slate-700 hover:border-indigo-500/50 transition-all rounded-xl p-4 relative group">
            <button onClick={() => onRemove(signalId)} className="absolute top-3 right-3 text-slate-500 hover:text-red-400 transition-colors z-10"><X className="w-4 h-4" /></button>
            
            <div className="mb-3">
                <p className="text-xs text-slate-500 mb-1 flex items-center space-x-1">
                    <span>{new Date(timestamp).toLocaleTimeString()}</span>
                    <Edit2 className="w-3 h-3 ml-2 opacity-50" />
                    <span className="text-[10px] text-indigo-400/70 uppercase">Editable</span>
                </p>
                <p className="text-sm text-slate-300 whitespace-pre-wrap font-mono bg-slate-900/50 p-2 rounded text-xs">{rawText}</p>
            </div>

            <div className="border-t border-slate-700/50 pt-3 mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-900/50 rounded p-2 flex flex-col">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Scrip Name</span>
                        <input type="text" value={edited.tradingSymbol} onChange={e => setEdited({...edited, tradingSymbol: e.target.value.toUpperCase()})} className="bg-transparent text-sm text-indigo-300 font-bold outline-none border-b border-indigo-500/30 focus:border-indigo-400 pb-0.5" />
                    </div>
                    
                    <div className="bg-slate-900/50 rounded p-2 flex flex-col">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Action & Entry</span>
                        <div className="flex items-center space-x-2">
                            <select value={edited.action} onChange={e => setEdited({...edited, action: e.target.value as 'BUY'|'SELL'})} className="bg-transparent text-sm font-bold outline-none text-slate-300 appearance-none cursor-pointer">
                                <option value="BUY">BUY</option>
                                <option value="SELL">SELL</option>
                            </select>
                            <span className="text-slate-500">@</span>
                            <input type="number" value={edited.suggestedEntryPrice || ''} onChange={e => setEdited({...edited, suggestedEntryPrice: Number(e.target.value)})} placeholder="MKT" className="bg-transparent text-sm font-bold outline-none border-b border-emerald-500/30 focus:border-emerald-400 pb-0.5 w-full" />
                        </div>
                    </div>

                    <div className="bg-slate-900/50 rounded p-2 flex flex-col">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Stop Loss</span>
                        <input type="number" value={edited.stopLoss || ''} onChange={e => setEdited({...edited, stopLoss: Number(e.target.value)})} className="bg-transparent text-sm text-red-400 font-bold outline-none border-b border-red-500/30 focus:border-red-400 pb-0.5" />
                    </div>

                    <div className="bg-slate-900/50 rounded p-2 flex flex-col">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Lot / Qty</span>
                        <input type="number" value={quantity} onChange={e => setQuantity(Number(e.target.value))} min="1" className="bg-transparent text-sm text-blue-300 font-bold outline-none border-b border-blue-500/30 focus:border-blue-400 pb-0.5" />
                    </div>
                </div>

                <div className="bg-slate-900/50 rounded p-2">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wide mb-2 block">Select Target to Execute</span>
                    <div className="flex flex-wrap gap-2">
                        {edited.targets.length > 0 ? edited.targets.map((tgt, i) => (
                            <button 
                                key={i} 
                                onClick={() => setSelectedTarget(tgt)}
                                className={`text-xs px-3 py-1 rounded-full border transition-all ${selectedTarget === tgt ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-medium' : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                            >
                                T{i+1}: {tgt}
                            </button>
                        )) : (
                            <span className="text-xs text-slate-500 italic">No targets parsed. Enter manually if needed.</span>
                        )}
                        <input 
                            type="number" 
                            placeholder="Custom TGT"
                            value={!edited.targets.includes(selectedTarget || 0) && selectedTarget !== null ? selectedTarget : ''}
                            onChange={(e) => setSelectedTarget(Number(e.target.value))}
                            className="bg-transparent border border-dashed border-slate-600 rounded-full px-3 py-1 text-xs text-emerald-300 outline-none focus:border-emerald-500 w-24"
                        />
                    </div>
                </div>

                <button
                    onClick={() => onExecute(signalId, edited, quantity, selectedTarget)}
                    disabled={isExecuting}
                    className={`w-full py-2.5 mt-2 rounded-lg flex items-center justify-center space-x-2 font-medium transition-all
                        ${isExecuting 
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'}
                    `}
                >
                    {isExecuting ? (
                        <>
                            <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                            <span>Executing via Dhan...</span>
                        </>
                    ) : (
                        <>
                            <Zap className="w-4 h-4" />
                            <span>1-Click Execute</span>
                        </>
                    )}
                </button>
            </div>
        </motion.div>
    );
};

export const SignalRadar: React.FC = () => {
  const { toast } = useToast();
  const [rawSignals, setRawSignals] = useState<{ id: string, text: string, timestamp: number }[]>([]);
  const [parsedSignals, setParsedSignals] = useState<Record<string, ParsedSignal>>({});
  const [isListening, setIsListening] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);

  const [wsInstance, setWsInstance] = useState<WebSocket | null>(null);

  // Initialize WebSocket connection to Telegram Ear and Scrip Master
  useEffect(() => {
    // Start downloading the 3MB CSV in the background
    DhanScripResolver.initialize();

    let ws: WebSocket;
    
    const connect = () => {
      ws = new WebSocket('ws://localhost:8080');
      setWsInstance(ws);
      
      ws.onopen = () => setIsListening(true);
      ws.onclose = () => {
        setIsListening(false);
        setWsInstance(null);
        // Try to reconnect every 5s silently
        setTimeout(connect, 5000);
      };
      
      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'NEW_SIGNAL') {
            const id = Math.random().toString(36).substring(7);
            setRawSignals(prev => [{ id, text: data.text, timestamp: data.timestamp }, ...prev].slice(0, 10)); // Keep last 10
            
            // Background Parse
            const parsed = await TelegramSignalParser.parseRawSignal(data.text);
            if (parsed) {
              setParsedSignals(prev => ({ ...prev, [id]: parsed }));
            }
          }

          if (data.type === 'ORDER_RESULT') {
            if (data.success) {
                alert('🚀 Order Executed Successfully via Proxy!');
                // Remove from list after execution
                setRawSignals(prev => prev.filter(s => s.text.includes(data.result.tradingSymbol) === false));
            } else {
                alert(`❌ Execution Failed: ${JSON.stringify(data.result)}`);
            }
            setExecutingId(null);
          }
        } catch (error) {
          console.error("SignalRadar WebSocket Error:", error);
        }
      };
    };

    connect();
    return () => {
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, []);

  const handleExecute = async (id: string, signal: ParsedSignal, quantity: number, target: number | null) => {
    const { isSandboxMode } = useSandboxStore.getState();
    if (isSandboxMode) {
      toast.info(`Sandbox Mode Active: Simulated execution for ${signal.tradingSymbol || 'instrument'} (Qty: ${quantity}). Zero real broker orders placed.`);
      return;
    }

    if (!window.confirm(`Transmit LIVE Dhan order for ${signal.tradingSymbol || 'instrument'} (Qty: ${quantity})? This risks real capital.`)) {
      return;
    }

    if (!wsInstance) {
        alert('Terminal Script is not connected. Please run: node scripts/telegram-ear.js');
        return;
    }
    setExecutingId(id);
    
    try {
      // Create a modified signal with the selected target so the execution uses it correctly if needed
      const executionSignal = { ...signal };
      if (target) {
          executionSignal.targets = [target]; // Force the selected target
      }

      const orderRequest = TelegramSignalParser.toDhanOrderRequest(executionSignal, quantity);
      const settings = useSettingsStore.getState(); 

      // SEND TO PROXY
      wsInstance.send(JSON.stringify({
        type: 'EXECUTE_ORDER',
        order: orderRequest,
        accessToken: settings.dhanAccessToken,
        clientId: settings.dhanClientId
      }));
      
    } catch (error) {
      console.error('Signal Preparation Failed:', error);
      setExecutingId(null);
    }
  };

  const removeSignal = (id: string) => {
    setRawSignals(prev => prev.filter(s => s.id !== id));
  };

  return (
    <div className="bg-slate-900/40 border border-indigo-500/30 rounded-2xl p-6 backdrop-blur-xl relative overflow-hidden">
      {/* Decorative pulse for listening state */}
      {isListening && (
        <div className="absolute top-4 right-4 flex items-center space-x-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
          <span className="text-xs text-emerald-400/80 font-medium tracking-wider upper">Live Radar</span>
        </div>
      )}

      <div className="flex items-center space-x-4 mb-6">
        <div className="p-3 bg-indigo-500/20 rounded-xl rounded-tl-sm text-indigo-400">
          <Bot className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Signal Interceptor</h2>
          <p className="text-sm text-slate-400">Listening to Premium Telegram Groups</p>
        </div>
      </div>

      {!isListening && rawSignals.length === 0 && (
        <div className="py-12 flex flex-col items-center justify-center text-center">
          <Activity className="w-12 h-12 text-slate-600 mb-4 animate-pulse" />
          <p className="text-slate-400 text-sm">
            Node listener is offline.<br/>
            Run <code className="bg-slate-800 px-1 py-0.5 rounded text-indigo-300">node scripts/telegram-ear.js</code>
          </p>
        </div>
      )}

      {isListening && rawSignals.length === 0 && (
        <div className="py-8 flex flex-col items-center justify-center border border-dashed border-slate-700/50 rounded-xl">
          <TrendingUp className="w-8 h-8 text-indigo-500/50 mb-2" />
          <p className="text-slate-500 text-sm">Waiting for incoming signals...</p>
        </div>
      )}

      <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
        <AnimatePresence>
          {rawSignals.map((signal) => (
            <EditableSignalCard
              key={signal.id}
              signalId={signal.id}
              rawText={signal.text}
              timestamp={signal.timestamp}
              initialParsed={parsedSignals[signal.id]}
              onExecute={handleExecute}
              onRemove={removeSignal}
              isExecuting={executingId === signal.id}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};
