import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { aiRiskOfficerService, DailyDebriefAnswers, ProcessGradeReport, ExpectancyReport } from '../../services/journal/AIRiskOfficerService';
import { ShieldAlert, Award, CheckCircle2, XCircle, AlertTriangle, Clock, Activity, Zap, RefreshCw, X } from 'lucide-react';
import { useToast } from '../shared/ToastProvider';

export interface CRODebriefModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CRODebriefModal: React.FC<CRODebriefModalProps> = ({ isOpen, onClose }) => {
  const { toast } = useToast();

  const [answers, setAnswers] = useState<DailyDebriefAnswers>({
    date: new Date().toISOString().split('T')[0],
    goldenWindowAdherence: true,
    gexAlignmentVerified: true,
    untamperedStopLoss: true,
    notes: ''
  });

  const [history] = useState({
    totalTrades: 32,
    winningTrades: 19,
    losingTrades: 13,
    avgWinR: 2.1,
    avgLossR: 1.0,
    consecutiveLosses: 0
  });

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const expectancy: ExpectancyReport = aiRiskOfficerService.computeExpectancy(history);
  const gradeReport: ProcessGradeReport = aiRiskOfficerService.evaluateProcessGrade(answers, history);

  if (!isOpen || typeof document === 'undefined') return null;

  const handleSubmit = () => {
    if (gradeReport.isCoolOffTriggered) {
      toast.error(`⚠️ COOL-OFF ENFORCED: ${gradeReport.summary}`);
    } else {
      toast.success(`✓ Debrief Recorded: Process Grade ${gradeReport.grade} (${gradeReport.score}/100)`);
    }
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <div
        className="fixed inset-0 bg-black/60 -z-10"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200 relative z-10">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Award size={22} />
            </div>
            <div>
              <h3 className="text-base font-black text-white tracking-wide flex items-center gap-2">
                CHIEF RISK OFFICER (CRO) DAILY DEBRIEF
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-indigo-950 border border-indigo-700/50 text-indigo-300 font-bold">
                  DOMAIN 05
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Emotionless Process Grading • Mathematical Expectancy Engine
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* Expectancy Scorecard */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-mono block">Win Rate</span>
              <span className="text-base font-black text-emerald-400 font-mono">{expectancy.winRate}%</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-mono block">Avg Win / Loss</span>
              <span className="text-base font-black text-indigo-300 font-mono">{expectancy.avgWinR}R / {expectancy.avgLossR}R</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-mono block">Expectancy (E)</span>
              <span className="text-base font-black text-emerald-400 font-mono">+{expectancy.expectancyR}R</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-mono block">Process Grade</span>
              <span className={`text-base font-black font-mono ${
                gradeReport.grade === 'A' ? 'text-emerald-400' : gradeReport.grade === 'F' ? 'text-rose-500' : 'text-amber-400'
              }`}>
                GRADE {gradeReport.grade}
              </span>
            </div>
          </div>

          {/* 3 Questions */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              The 3-Question Post-Market Autopsy
            </h4>

            {/* Q1 */}
            <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800/80 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-bold text-white">
                  1. Golden Window Adherence (10:30 - 10:45 AM)
                </p>
                <p className="text-xs text-slate-400">
                  Did you wait out the 09:15-10:00 retail trap and execute strictly inside the 1-strike golden window?
                </p>
              </div>
              <div className="flex rounded-lg bg-slate-900 border border-slate-800 p-0.5 shrink-0">
                <button
                  onClick={() => setAnswers(prev => ({ ...prev, goldenWindowAdherence: true }))}
                  className={`px-3 py-1 text-xs font-bold rounded transition-all ${
                    answers.goldenWindowAdherence ? 'bg-emerald-600 text-white' : 'text-slate-400'
                  }`}
                >
                  YES
                </button>
                <button
                  onClick={() => setAnswers(prev => ({ ...prev, goldenWindowAdherence: false }))}
                  className={`px-3 py-1 text-xs font-bold rounded transition-all ${
                    !answers.goldenWindowAdherence ? 'bg-rose-600 text-white' : 'text-slate-400'
                  }`}
                >
                  NO
                </button>
              </div>
            </div>

            {/* Q2 */}
            <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800/80 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-bold text-white">
                  2. Dealer GEX Regime Alignment Verified
                </p>
                <p className="text-xs text-slate-400">
                  Did you verify the Zero-Gamma line ($S_0$) and ensure you were not fighting dealer pinning or gamma walls?
                </p>
              </div>
              <div className="flex rounded-lg bg-slate-900 border border-slate-800 p-0.5 shrink-0">
                <button
                  onClick={() => setAnswers(prev => ({ ...prev, gexAlignmentVerified: true }))}
                  className={`px-3 py-1 text-xs font-bold rounded transition-all ${
                    answers.gexAlignmentVerified ? 'bg-emerald-600 text-white' : 'text-slate-400'
                  }`}
                >
                  YES
                </button>
                <button
                  onClick={() => setAnswers(prev => ({ ...prev, gexAlignmentVerified: false }))}
                  className={`px-3 py-1 text-xs font-bold rounded transition-all ${
                    !answers.gexAlignmentVerified ? 'bg-rose-600 text-white' : 'text-slate-400'
                  }`}
                >
                  NO
                </button>
              </div>
            </div>

            {/* Q3 */}
            <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800/80 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-bold text-white">
                  3. Pre-Bracketed Stop Loss Untampered
                </p>
                <p className="text-xs text-slate-400">
                  Did you leave the stop loss untouched and let the automated system execute with zero widening?
                </p>
              </div>
              <div className="flex rounded-lg bg-slate-900 border border-slate-800 p-0.5 shrink-0">
                <button
                  onClick={() => setAnswers(prev => ({ ...prev, untamperedStopLoss: true }))}
                  className={`px-3 py-1 text-xs font-bold rounded transition-all ${
                    answers.untamperedStopLoss ? 'bg-emerald-600 text-white' : 'text-slate-400'
                  }`}
                >
                  YES
                </button>
                <button
                  onClick={() => setAnswers(prev => ({ ...prev, untamperedStopLoss: false }))}
                  className={`px-3 py-1 text-xs font-bold rounded transition-all ${
                    !answers.untamperedStopLoss ? 'bg-rose-600 text-white' : 'text-slate-400'
                  }`}
                >
                  NO
                </button>
              </div>
            </div>
          </div>

          {/* Verdict Card */}
          <div className={`p-4 rounded-xl border ${
            gradeReport.grade === 'A'
              ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-200'
              : gradeReport.grade === 'F'
              ? 'bg-rose-950/40 border-rose-800/60 text-rose-200'
              : 'bg-amber-950/30 border-amber-800/50 text-amber-200'
          }`}>
            <h5 className="font-bold text-sm flex items-center gap-2">
              {gradeReport.title}
            </h5>
            <p className="text-xs mt-1 text-slate-300">
              {gradeReport.summary}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <span className="text-xs font-mono text-slate-400">
            Debrief Score: {gradeReport.debriefScore}/3 criteria verified
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold rounded-xl text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              className="px-5 py-2.5 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
            >
              Submit Debrief & Lock Journal
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

