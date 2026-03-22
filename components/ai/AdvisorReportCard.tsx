import React from 'react';
import { PieChart, Shield, Award } from 'lucide-react';

export interface AdvisorData {
    grades: {
        diversification: string;
        riskProfile: string;
        assetQuality: string;
    };
    summary: string;
    risks: string[];
    opportunities: string[];
    actions: string[];
}

interface GradeBadgeProps {
    grade: string;
    label: string;
    icon: React.FC<{ size?: number }>;
}

const GradeBadge: React.FC<GradeBadgeProps> = React.memo(({ grade, label, icon: Icon }) => {
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

GradeBadge.displayName = 'GradeBadge';

export const AdvisorReportCard: React.FC<{ data: AdvisorData }> = React.memo(({ data }) => {
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 animate-in zoom-in duration-300">
            <GradeBadge grade={data.grades.diversification} label="Diversification" icon={PieChart} />
            <GradeBadge grade={data.grades.riskProfile} label="Risk Management" icon={Shield} />
            <GradeBadge grade={data.grades.assetQuality} label="Asset Quality" icon={Award} />
        </div>
    );
});

AdvisorReportCard.displayName = 'AdvisorReportCard';
