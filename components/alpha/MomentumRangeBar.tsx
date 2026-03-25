import React from 'react';

interface MomentumRangeBarProps {
  low: number;
  high: number;
  current: number;
}

const MomentumRangeBar = React.memo<MomentumRangeBarProps>(({ low, high, current }) => {
  const range = high - low;
  const progress = range === 0 ? 0 : ((current - low) / range) * 100;
  
  // Constrain progress between 0 and 100
  const constrainedProgress = Math.max(0, Math.min(100, progress));

  return (
    <div className="flex flex-col gap-0.5 w-[60%] mx-auto">
      <div className="flex justify-between text-[8px] font-bold text-slate-500 uppercase tracking-tighter">
        <span>{low.toFixed(1)}</span>
        <span>{high.toFixed(1)}</span>
      </div>
      <div 
        className="relative w-full rounded-full border border-white/5"
        style={{ height: '3px', backgroundColor: 'rgba(167, 139, 250, 0.15)' }}
      >
        <div 
          className="absolute top-0 bottom-0 left-0 rounded-full transition-all duration-700 ease-out"
          style={{ 
            width: `${constrainedProgress}%`, 
            background: 'linear-gradient(90deg, #c084fc, #a78bfa)' 
          }}
        />
        <div 
          className="absolute top-1/2 -translate-y-1/2 rounded-full shadow-[0_0_4px_#c084fc] transition-all duration-700 ease-out z-10"
          style={{ 
            left: `calc(${constrainedProgress}% - 2px)`,
            width: '4px',
            height: '4px',
            backgroundColor: '#ffffff'
          }}
        />
      </div>
    </div>
  );
});

export default MomentumRangeBar;
