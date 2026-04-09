import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
    Zap, Sunrise, Sunset, ClipboardList, 
    Send, Loader2, CheckCircle2, AlertCircle
} from 'lucide-react';
import { notificationService } from '../../../services/NotificationService';

const MissionControlWidget: React.FC = () => {
    const [runningFlow, setRunningFlow] = useState<string | null>(null);
    const [status, setStatus] = useState<Record<string, 'idle' | 'success' | 'error'>>({});

    const runFlow = async (flowId: string, eventName: string) => {
        setRunningFlow(flowId);
        setStatus(prev => ({ ...prev, [flowId]: 'idle' }));
        
        try {
            const success = await notificationService.sendToNervousSystem(eventName, {
                source: 'MissionControl',
                timestamp: new Date().toISOString()
            });

            setStatus(prev => ({ ...prev, [flowId]: success ? 'success' : 'error' }));
            
            // Reset success state after 3 seconds
            if (success) {
                setTimeout(() => {
                    setStatus(prev => ({ ...prev, [flowId]: 'idle' }));
                }, 3000);
            }
        } catch (err) {
            setStatus(prev => ({ ...prev, [flowId]: 'error' }));
        } finally {
            setRunningFlow(null);
        }
    };

    const flows = [
        {
            id: 'pre-market',
            name: 'Pre-Market Pulse',
            event: 'FLOW_PRE_MARKET',
            icon: <Sunrise className="text-amber-400" size={18} />,
            desc: 'Fetch Global cues, News & Bias (8:45 AM)'
        },
        {
            id: 'post-session',
            name: 'Post-Session Audit',
            event: 'FLOW_POST_SESSION',
            icon: <Sunset className="text-indigo-400" size={18} />,
            desc: 'Analyze trades, PnL & Emotions (3:45 PM)'
        },
        {
            id: 'idea-sync',
            name: 'Sync Mission Queue',
            event: 'FLOW_IDEA_SYNC',
            icon: <ClipboardList className="text-emerald-400" size={18} />,
            desc: 'Import signals from Telegram Lab'
        }
    ];

    return (
        <div className="h-full flex flex-col bg-slate-900/50 rounded-2xl border border-slate-800 p-5 overflow-hidden relative">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-indigo-500/10 rounded-xl">
                    <Zap className="text-indigo-400" size={20} />
                </div>
                <div>
                    <h3 className="text-sm font-black text-slate-100 uppercase tracking-wider">Mission Control</h3>
                    <p className="text-[10px] font-bold text-slate-500 uppercase">Automation Nervous System</p>
                </div>
            </div>

            {/* Flow List */}
            <div className="flex-1 space-y-3">
                {flows.map((flow) => (
                    <button
                        key={flow.id}
                        onClick={() => runFlow(flow.id, flow.event)}
                        disabled={runningFlow !== null}
                        className={`w-full group relative flex items-center gap-4 p-4 rounded-2xl border transition-all duration-300 ${
                            status[flow.id] === 'success' ? 'bg-emerald-500/10 border-emerald-500/30' :
                            status[flow.id] === 'error' ? 'bg-rose-500/10 border-rose-500/30' :
                            'bg-slate-800/40 border-slate-700/50 hover:border-slate-600 hover:bg-slate-800/60'
                        }`}
                    >
                        <div className="p-2.5 bg-slate-900/50 rounded-xl border border-slate-700/50 group-hover:border-slate-600 transition-colors">
                            {flow.icon}
                        </div>
                        
                        <div className="flex-1 text-left">
                            <h4 className="text-[11px] font-black text-slate-200 uppercase tracking-tight">{flow.name}</h4>
                            <p className="text-[9px] font-bold text-slate-500 leading-tight">{flow.desc}</p>
                        </div>

                        <div className="flex items-center justify-center">
                            {runningFlow === flow.id ? (
                                <Loader2 className="animate-spin text-indigo-400" size={16} />
                            ) : status[flow.id] === 'success' ? (
                                <CheckCircle2 className="text-emerald-400" size={16} />
                            ) : status[flow.id] === 'error' ? (
                                <AlertCircle className="text-rose-400" size={16} />
                            ) : (
                                <Send className="text-slate-600 group-hover:text-slate-400 transition-colors" size={14} />
                            )}
                        </div>

                        {/* Progress Bar (Visual Only for idle) */}
                        {runningFlow === flow.id && (
                            <motion.div 
                                className="absolute bottom-0 left-0 h-0.5 bg-indigo-500"
                                initial={{ width: 0 }}
                                animate={{ width: '100%' }}
                                transition={{ duration: 2 }}
                            />
                        )}
                    </button>
                ))}
            </div>

            {/* Footer Status */}
            <div className="mt-6 pt-4 border-t border-slate-800/50 flex items-center justify-between">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    System Live
                </span>
                <span className="text-[9px] font-bold text-slate-600">n8n Node: {notificationService.isN8NConfigured() ? 'Connected' : 'Offline'}</span>
            </div>
        </div>
    );
};

export default MissionControlWidget;
