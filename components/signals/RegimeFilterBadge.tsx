import React from 'react';
import { Globe, ToggleLeft, ToggleRight } from 'lucide-react';
import { useMacroRegimeStore } from '../../store/macroRegimeStore';
import { useShallow } from 'zustand/react/shallow';
import { macroRegimeService } from '../../services/MacroRegimeService';

export const RegimeFilterBadge: React.FC = () => {
  // P0#3: useShallow
  const { currentRegime, filterEnabled, toggleFilter } = useMacroRegimeStore(
    useShallow(state => ({
      currentRegime: state.currentRegime,
      filterEnabled: state.filterEnabled,
      toggleFilter: state.toggleFilter,
    }))
  );
  const config = macroRegimeService.getRegimeConfig(currentRegime);

  return (
    <div className={`inline-flex items-center gap-3 px-4 py-2 rounded-2xl border transition-all duration-300 shadow-xl backdrop-blur-md relative z-10 ${
      filterEnabled 
        ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300' 
        : 'bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-700'
    }`}>
      <Globe className={`w-4 h-4 shrink-0 ${filterEnabled ? 'animate-spin text-indigo-400' : 'text-slate-400'}`} style={{ animationDuration: '3s' }} />
      
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-xs">
        <span className="text-slate-300">
          Regime Mode: <strong className="text-white font-bold">{config.name}</strong>
        </span>
        <div className="hidden sm:block w-px h-3 bg-slate-800" />
        <span className="text-xs text-slate-400 font-medium">
          {filterEnabled ? 'Preferring high-prob setups' : 'Filter setups by active regime'}
        </span>
      </div>

      <button
        onClick={() => toggleFilter()}
        className={`p-0.5 rounded-lg transition-colors flex items-center justify-center cursor-pointer ${
          filterEnabled ? 'text-indigo-400 hover:text-indigo-300' : 'text-slate-400 hover:text-white'
        }`}
        title={filterEnabled ? "Disable Regime Filtering" : "Enable Regime Filtering"}
      >
        {filterEnabled ? (
          <ToggleRight className="w-6 h-6" />
        ) : (
          <ToggleLeft className="w-6 h-6" />
        )}
      </button>
    </div>
  );
};

export default RegimeFilterBadge;
