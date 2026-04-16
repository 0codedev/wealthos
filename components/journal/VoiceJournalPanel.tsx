import React, { useState, useEffect } from 'react';
import { Mic, MicOff, Brain, Clock, ShieldCheck, Heart, Trash2, HelpCircle } from 'lucide-react';
import { voiceJournalService } from '../../services/VoiceJournalService';
import { VoiceSession } from '../../database';

export const VoiceJournalPanel: React.FC = () => {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>('');
  const [sessions, setSessions] = useState<VoiceSession[]>([]);
  const [activeSession, setActiveSession] = useState<VoiceSession | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const loadSessions = async () => {
    const list = await voiceJournalService.getSessions();
    setSessions(list.reverse()); // latest first
    if (list.length > 0 && !activeSession) {
      setActiveSession(list[0]);
    }
  };

  useEffect(() => {
    void loadSessions();
  }, []);

  const handleToggleRecord = async () => {
    if (isRecording) {
      setIsProcessing(true);
      const res = await voiceJournalService.stopRecording();
      setIsRecording(false);
      setIsProcessing(false);
      if (res) {
        setActiveSession(res);
        void loadSessions();
      }
    } else {
      setTranscript('');
      const started = voiceJournalService.startRecording(
        (text) => setTranscript(text),
        (status) => setIsRecording(status)
      );
      if (!started) {
        alert('Could not start microphone. Ensure browser permissions are enabled.');
      }
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm('Delete this voice journal session?')) {
      await voiceJournalService.deleteSession(id);
      if (activeSession?.id === id) {
        setActiveSession(null);
      }
      void loadSessions();
    }
  };

  const emotionColor = (emotion: string) => {
    switch (emotion?.toLowerCase()) {
      case 'confidence':
      case 'disciplined':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
      case 'uncertainty':
      case 'fomo':
      case 'greed':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'fear':
      case 'frustration':
        return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
      default:
        return 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30';
    }
  };

  return (
    <div className="bg-slate-900 rounded-2xl border border-indigo-500/20 p-6 text-white shadow-xl">
      <div className="flex items-center justify-between mb-6 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400 border border-indigo-500/20">
            <Mic size={22} />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight">Voice Biometric Trading Journal</h2>
            <p className="text-xs text-slate-400">Record post-session feedback to extract emotion profiles and cognitive biases.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Recorder Control */}
        <div className="space-y-6 lg:border-r lg:border-slate-800 lg:pr-6 flex flex-col justify-between">
          <div className="flex flex-col items-center justify-center p-8 bg-slate-950/40 border border-slate-850 rounded-2xl relative overflow-hidden">
            {/* Record button */}
            <button
              onClick={handleToggleRecord}
              disabled={isProcessing}
              className={`h-24 w-24 rounded-full flex items-center justify-center transition-all duration-300 relative z-10 ${
                isRecording
                  ? 'bg-rose-600 hover:bg-rose-500 shadow-lg shadow-rose-600/30 scale-105'
                  : 'bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-600/30'
              }`}
            >
              {isRecording ? <MicOff size={32} /> : <Mic size={32} />}
            </button>
            
            {isRecording && (
              <div className="absolute inset-0 bg-rose-600/5 flex items-center justify-center">
                <div className="animate-ping absolute h-32 w-32 rounded-full bg-rose-500/20" />
                <div className="animate-pulse absolute h-40 w-40 rounded-full bg-rose-500/10" />
              </div>
            )}

            <div className="text-center mt-6 z-10">
              <p className="text-sm font-bold">{isRecording ? 'Listening...' : 'Start Recording'}</p>
              <p className="text-xs text-slate-500 mt-1">
                {isRecording ? 'Click to stop & generate report' : 'Speak about your session, setups, and feelings'}
              </p>
            </div>
          </div>

          {/* Scrolling Transcript */}
          {(isRecording || transcript) && (
            <div className="bg-slate-950 border border-slate-850 rounded-xl p-4 h-36 overflow-y-auto text-xs text-slate-300 font-mono leading-relaxed">
              <span className="text-indigo-400 font-bold block mb-1">Live Transcript:</span>
              {transcript || 'Awaiting input...'}
            </div>
          )}

          {/* Past Sessions List */}
          <div className="space-y-2">
            <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Session History</span>
            {sessions.length === 0 ? (
              <p className="text-xs text-slate-500">No journal logs recorded yet.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {sessions.map((s) => {
                  const isActive = activeSession?.id === s.id;
                  return (
                    <div
                      key={s.id}
                      onClick={() => setActiveSession(s)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all flex justify-between items-center ${
                        isActive
                          ? 'bg-slate-850 border-indigo-500/50 text-white'
                          : 'bg-slate-950 border-slate-850 hover:bg-slate-900 text-slate-400'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Clock size={14} className="text-slate-500" />
                        <div>
                          <p className="text-xs font-bold font-mono">
                            {new Date(s.date).toLocaleDateString('en-IN', { month: 'short', day: '2-digit' })}
                          </p>
                          <span className={`text-[10px] uppercase font-bold tracking-wider px-1 py-0.5 rounded border inline-block mt-0.5 ${emotionColor(s.dominantEmotion)}`}>
                            {s.dominantEmotion}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (s.id) handleDelete(s.id);
                        }}
                        className="text-slate-600 hover:text-rose-400 p-1 transition-all"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Emotional Diagnostics Card */}
        <div className="lg:col-span-2 space-y-6">
          {isProcessing && (
            <div className="flex flex-col items-center justify-center py-32 text-slate-400 space-y-3">
              <Brain className="animate-spin text-indigo-500" size={32} />
              <p className="text-sm font-mono">Extracting cognitive biases and emotional spikes...</p>
            </div>
          )}

          {!isProcessing && !activeSession && (
            <div className="flex flex-col items-center justify-center py-32 text-slate-500 border border-dashed border-slate-800 rounded-xl">
              <HelpCircle className="mb-2 opacity-25" size={40} />
              <p>Record a voice log or select a past session to view diagnostics.</p>
            </div>
          )}

          {!isProcessing && activeSession && (
            <div className="space-y-6">
              {/* Emotion Header Card */}
              <div className="bg-slate-950 border border-slate-850 p-5 rounded-2xl flex flex-wrap justify-between items-center gap-4">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-400 uppercase tracking-wider">Dominant State Verdict</h3>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className={`px-3 py-1 rounded-full border text-sm font-black uppercase tracking-wider ${emotionColor(activeSession.dominantEmotion)}`}>
                      {activeSession.dominantEmotion}
                    </span>
                    <span className="text-xs text-slate-500 font-mono">
                      {activeSession.durationSeconds}s duration
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="block text-[10px] text-slate-500 uppercase font-black">Recorded At</span>
                  <span className="font-mono text-xs text-slate-300">
                    {new Date(activeSession.date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                </div>
              </div>

              {/* AI Psychology Commentary */}
              <div className="bg-slate-950 border border-slate-850 p-5 rounded-xl flex items-start gap-4">
                <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400 border border-indigo-500/20 shrink-0">
                  <Brain size={18} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">AI Cognitive Analyst</h4>
                  <p className="text-sm text-slate-200 leading-relaxed font-medium">
                    {activeSession.aiCommentary}
                  </p>
                </div>
              </div>

              {/* Transcript details */}
              <div className="bg-slate-950 border border-slate-850 p-5 rounded-xl space-y-3">
                <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Voice Transcript</span>
                <p className="text-sm text-slate-300 leading-relaxed font-mono">
                  "{activeSession.transcript}"
                </p>
              </div>

              {/* Metadatas: Tickers and Ideas */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-slate-950 border border-slate-850 p-4 rounded-xl">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Heart size={14} className="text-rose-400" /> Tickers Mentioned
                  </h4>
                  {activeSession.instruments.length === 0 ? (
                    <p className="text-xs text-slate-500">No instruments parsed in this session.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {activeSession.instruments.map((ticker) => (
                        <span key={ticker} className="bg-slate-900 border border-slate-800 text-slate-300 text-xs px-2.5 py-1 rounded font-mono font-bold">
                          {ticker}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-slate-950 border border-slate-850 p-4 rounded-xl">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <ShieldCheck size={14} className="text-indigo-400" /> Key Takeaways
                  </h4>
                  <ul className="list-disc list-inside text-xs text-slate-300 space-y-1.5">
                    {activeSession.keyIdeas.map((idea, idx) => (
                      <li key={idx} className="leading-relaxed">{idea}</li>
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

export default VoiceJournalPanel;
