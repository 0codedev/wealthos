import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { secureZustandStorage } from '../utils/Encryption';
import { MacroRegime } from '../types';
import { MacroIndicator } from '../services/RealDataService';
import { macroRegimeService } from '../services/MacroRegimeService';

export interface MacroRegimeState {
  currentRegime: MacroRegime;
  lastUpdated: string;
  filterEnabled: boolean;
  updateRegime: (indicators: MacroIndicator[], fiiDiiNet?: number) => void;
  toggleFilter: () => void;
  setFilterEnabled: (enabled: boolean) => void;
}

const DEFAULTS = {
  currentRegime: MacroRegime.REFLATION,
  lastUpdated: new Date().toISOString(),
  filterEnabled: false,
};

export const useMacroRegimeStore = create<MacroRegimeState>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      updateRegime: (indicators, fiiDiiNet = 0) => {
        const regime = macroRegimeService.classifyRegime(indicators, fiiDiiNet);
        set({
          currentRegime: regime as unknown as MacroRegime,
          lastUpdated: new Date().toISOString(),
        });
      },

      toggleFilter: () => set((state) => ({ filterEnabled: !state.filterEnabled })),
      setFilterEnabled: (enabled) => set({ filterEnabled: enabled }),
    }),
    {
      name: 'wealth-macro-regime',
      storage: createJSONStorage(() => secureZustandStorage),
    }
  )
);
export default useMacroRegimeStore;
