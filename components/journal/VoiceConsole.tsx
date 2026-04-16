import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    Mic, Brain, X, History, TrendingUp, AlertCircle, 
    MessageSquare, ChevronDown, ChevronUp, Trash2 
} from 'lucide-react';
import { useVoiceStore, VoiceLog } from '../../store/voiceStore';
import { useGuardrailStore } from '../../store/useGuardrailStore';


interface VoiceConsoleProps {
    isOpen: boolean;
    isRecording: boolean;
    isProcessing: boolean;
    insight: any | null;
    onClose: () => void;
    volume?: number; // Add volume prop
}

const VoiceConsole: React.FC<VoiceConsoleProps> = ({ 
    isOpen, isRecording, isProcessing, insight, onClose, volume = 0
}) => {
    const [showHistory, setShowHistory] = useState(false);
    const { logs, clearLogs } = useVoiceStore();

    if (!isOpen && !isRecording && !isProcessing && !insight) return null;

    return (
        <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-3 pointer-events-none">
            <AnimatePresence>
                {(isRecording || isProcessing || insight || showHistory) && (
                    <motion.div
                        initial={{ opacity: 0, y: 20, scale: 0.95, filter: 'blur(10px)' }}
                        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, y: 20, scale: 0.95, filter: 'blur(10px)' }}
                        className="w-96 pointer-events-auto bg-slate-900/80 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden"
                    >
                        {/* Header */}
                        <div className="p-4 flex items-center justify-between border-b border-white/5 bg-white/5">
                            <div className="flex items-center gap-2">
                                <div className={`p-1.5 rounded-lg ${isRecording ? 'bg-indigo-500' : 'bg-indigo-500'}`}>
                                    {isProcessing ? <Brain size={16} className="text-white animate-pulse" /> : <Mic size={16} className="text-white" />}
                                </div>
                                <span className="text-xs font-bold uppercase tracking-widest text-white/70">
                                    {isRecording ? 'Listening...' : isProcessing ? 'AI Processing...' : 'Voice Intelligence'}
                                </span>
                            </div>
                            <div className="flex items-center gap-1">
                                <button 
                                    onClick={() => setShowHistory(!showHistory)}
                                    className={`p-1.5 rounded-lg transition-colors ${showHistory ? 'bg-indigo-500/20 text-indigo-400' : 'text-white/40 hover:text-white/70'}`}
                                >
                                    <History size={18} />
                                </button>
                                <button onClick={onClose} className="p-1.5 text-white/40 hover:text-white/70">
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        {/* Content Area */}
                        <div className="max-h-[450px] overflow-y-auto custom-scrollbar">
                            {showHistory ? (
                                <div className="p-4 space-y-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-wider">Memory Log</h3>
                                        <button onClick={clearLogs} className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1">
                                            <Trash2 size={10} /> Clear
                                        </button>
                                    </div>
                                    {logs.length === 0 ? (
                                        <div className="py-8 text-center text-white/20 italic text-sm">No past insights found.</div>
                                    ) : (
                                        logs.map((log) => (
                                            <div key={log.id} className="p-3 rounded-xl bg-white/5 border border-white/5 group">
                                                <div className="flex justify-between items-start mb-1">
                                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                                        log.emotion === 'FOMO' || log.emotion === 'Stress' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                                                    }`}>
                                                        {log.emotion}
                                                    </span>
                                                    <span className="text-[10px] text-white/20">{new Date(log.timestamp).toLocaleTimeString()}</span>
                                                </div>
                                                <p className="text-xs text-white/60 line-clamp-2 italic">"{log.transcript}"</p>
                                            </div>
                                        ))
                                    )}
                                </div>
                            ) : isRecording ? (
                                <div className="p-8 flex flex-col items-center justify-center gap-6">
                                    <div className="flex items-end gap-1.5 h-12">
                                        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                                            <motion.div
                                                key={i}
                                                animate={{ 
                                                    height: volume > 2 ? [10, 10 + (volume * 1.2), 10] : [10, 12, 10],
                                                    backgroundColor: volume > 2 ? ["#3b82f6", "#60a5fa", "#3b82f6"] : ["#1e293b", "#334155", "#1e293b"]
                                                }}
                                                transition={{ 
                                                    duration: 0.15, 
                                                    repeat: Infinity, 
                                                    delay: i * 0.04 
                                                }}
                                                className="w-1.5 rounded-full"
                                            />

                                        ))}
                                    </div>
                                    <div className="text-center space-y-1">
                                        <p className={`text-sm font-bold ${volume > 5 ? 'text-blue-400' : 'text-white/20'}`}>
                                            {volume > 5 ? 'Hearing your voice...' : 'Waiting for sound...'}
                                        </p>
                                        <p className="text-[10px] text-white/30 uppercase tracking-widest">
                                            {volume > 5 ? 'High-Fidelity Stream Active' : 'Check Windows Privacy Settings'}
                                        </p>
                                    </div>
                                </div>


                            ) : isProcessing ? (
                                <div className="p-12 flex flex-col items-center justify-center gap-4">
                                    <div className="relative">
                                        <motion.div 
                                            animate={{ rotate: 360 }}
                                            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                                            className="w-20 h-20 border-t-2 border-r-2 border-indigo-500 rounded-full blur-sm opacity-50"
                                        />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <Brain size={32} className="text-indigo-400 animate-pulse" />
                                        </div>
                                    </div>
                                    <p className="text-sm font-bold text-white/60 tracking-widest uppercase">Consulting AI Coach...</p>
                                </div>
                            ) : insight ? (
                                <div className="p-5 space-y-5">
                                    {/* Emotion & Transcript */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <h2 className="text-2xl font-black text-white tracking-tight">{insight.emotion}</h2>
                                            <span className={`px-2 py-1 rounded text-[10px] font-bold tracking-widest uppercase ${
                                                insight.risk_level === 'High' ? 'bg-red-500 text-white' : 'bg-green-500 text-white'
                                            }`}>
                                                {insight.risk_level} Risk
                                            </span>
                                        </div>
                                        <div className="p-3 rounded-2xl bg-white/5 border border-white/5 italic text-sm text-white/50 relative">
                                            <MessageSquare size={12} className="absolute -top-1.5 -left-1.5 text-white/20" />
                                            "{insight.transcript}"
                                        </div>
                                    </div>

                                    {/* Sentiment Bar */}
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between text-[10px] font-bold text-white/30 uppercase">
                                            <span>Psychological Sentiment</span>
                                        </div>
                                        <p className="text-xs text-white/70 leading-relaxed">{insight.sentiment}</p>
                                    </div>

                                    {/* Coach Directive */}
                                    <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 relative overflow-hidden group">
                                        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                        <div className="flex gap-3 relative z-10">
                                            <div className="p-2 rounded-xl bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.5)] h-fit">
                                                <TrendingUp size={16} className="text-white" />
                                            </div>
                                            <div className="space-y-1">
                                                <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">AI Coach Directive</span>
                                                <p className="text-sm font-medium text-white leading-snug">{insight.coach_tip}</p>
                                            </div>
                                        </div>
                                    </div>

                                    <button 
                                        onClick={onClose}
                                        className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/40 text-xs font-bold uppercase tracking-widest transition-all"
                                    >
                                        Dismiss Analysis
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default VoiceConsole;
