
import React, { useState } from 'react';
import { X, Save, Target } from 'lucide-react';
import { useSettingsStore } from '../store/settingsStore';

import { useShallow } from 'zustand/react/shallow';
interface TargetConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TargetConfigModal: React.FC<TargetConfigModalProps> = ({ isOpen, onClose }) => {
  const allocationTargets = useSettingsStore(useShallow(state => state.allocationTargets));
  const updateSetting = useSettingsStore(useShallow(state => state.updateSetting));
  const [targets, setTargets] = useState<Record<string, number>>(allocationTargets);

  if (!isOpen) return null;

  const handleChange = (key: string, val: string) => {
      const num = parseFloat(val) || 0;
      setTargets(prev => ({ ...prev, [key]: num }));
  };

  const handleSave = () => {
      updateSetting('allocationTargets', targets);
      onClose();
  };

  const total = Object.values(targets).reduce((a: number, b: number) => a + b, 0);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
           <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
               <Target size={20} className="text-indigo-500"/> Strategy Targets
           </h2>
           <button onClick={onClose} aria-label="Close strategy targets" className="text-slate-400 hover:text-slate-600 dark:hover:text-white"><X size={20} /></button>
        </div>
        
        <div className="p-6 space-y-4">
            {Object.entries(targets).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{key}</label>
                    <div className="flex items-center gap-2">
                        <input 
                            type="number" 
                            value={value} 
                            onChange={(e) => handleChange(key, e.target.value)}
                            className="w-20 p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-right outline-none focus:border-indigo-500"
                        />
                        <span className="text-slate-500">%</span>
                    </div>
                </div>
            ))}
            
            <div className={`mt-4 p-3 rounded-lg flex justify-between items-center ${total === 100 ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400'}`}>
                <span className="text-xs font-bold uppercase">Total Allocation</span>
                <span className="font-bold">{total}%</span>
            </div>
        </div>

        <div className="p-6 border-t border-slate-200 dark:border-slate-800">
            <button 
                onClick={handleSave}
                disabled={total !== 100}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg shadow-indigo-500/30 flex items-center justify-center gap-2"
            >
                <Save size={18}/> Save Configuration
            </button>
        </div>
      </div>
    </div>
  );
};

export default TargetConfigModal;
