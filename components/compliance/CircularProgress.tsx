import React from 'react';
import { CheckCircle2 } from 'lucide-react';

export const CircularProgress = React.memo(({ value, max, size = 60, strokeWidth = 4, color = "text-indigo-500" }: any) => {
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const offset = circumference - (Math.min(value / max, 1) * circumference);

    return (
        <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
            <svg className="transform -rotate-90 w-full h-full">
                <circle
                    className="text-slate-200 dark:text-slate-800"
                    strokeWidth={strokeWidth}
                    stroke="currentColor"
                    fill="transparent"
                    r={radius}
                    cx={size / 2}
                    cy={size / 2}
                />
                <circle
                    className={`${color} transition-all duration-1000 ease-out`}
                    strokeWidth={strokeWidth}
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="transparent"
                    r={radius}
                    cx={size / 2}
                    cy={size / 2}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-[10px] font-bold">
                {value >= max ? <CheckCircle2 size={16} className={color} /> : <span>{Math.round((value / max) * 100)}%</span>}
            </div>
        </div>
    );
});

CircularProgress.displayName = 'CircularProgress';
