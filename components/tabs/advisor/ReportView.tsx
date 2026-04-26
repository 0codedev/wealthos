import React from 'react';
import { Shield, TrendingUp, Award, PieChart, AlertTriangle, Lightbulb } from 'lucide-react';
import { type AdvisorData } from '../../ai';

// --- Sub Components ---

const GradeBadge = React.memo(({ grade, label, icon: Icon }: { grade: string, label: string, icon: any }) => {
    const getColor = (g: string) => {
        if (g.startsWith('A')) return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
        if (g.startsWith('B')) return 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20';
        if (g.startsWith('C')) return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
        return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
    };

    const colorClass = getColor(grade);

    return (
        <div className={`flex flex-col items-center justify-center p-4 rounded-2xl border ${colorClass} transition-all hover:scale-105`}>
            <div className="flex items-center gap-2 mb-2 opacity-80">
                <Icon size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
            </div>
            <span className="text-4xl font-black tracking-tighter">{grade}</span>
        </div>
    );
});

export const ReportCard = React.memo(({ data }: { data: AdvisorData }) => {
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 animate-in zoom-in duration-300">
            <GradeBadge grade={data.grades.diversification} label="Diversification" icon={PieChart} />
            <GradeBadge grade={data.grades.riskProfile} label="Risk Management" icon={Shield} />
            <GradeBadge grade={data.grades.assetQuality} label="Asset Quality" icon={Award} />
        </div>
    );
});

export const ActionList = React.memo(({ items, onNavigate, type }: { items: string[], onNavigate: (t: string) => void, type: 'RISK' | 'OPP' | 'ACTION' }) => {
    const config = {
        RISK: { color: 'rose', icon: AlertTriangle, title: 'Critical Risks' },
        OPP: { color: 'emerald', icon: Lightbulb, title: 'Opportunities' },
        ACTION: { color: 'indigo', icon: TrendingUp, title: 'Execution Plan' }
    }[type];

    if (!items || items.length === 0) return null;

    return (
        <div className={`bg-${config.color}-50 dark:bg-${config.color}-900/10 border border-${config.color}-100 dark:border-${config.color}-900/30 rounded-xl p-5 mb-4 animate-in slide-in-from-bottom-4`}>
            <h4 className={`flex items-center gap-2 text-${config.color}-700 dark:text-${config.color}-400 font-bold mb-4 uppercase tracking-wider text-sm`}>
                <config.icon size={18} /> {config.title}
            </h4>
            <div className="space-y-3">
                {items.map((item, idx) => (
                    <div key={idx} className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{item}</p>
                    </div>
                ))}
            </div>
        </div>
    );
});
