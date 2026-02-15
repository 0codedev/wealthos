import { create } from 'zustand';

export interface RefreshStep {
  label: string;
  status: 'pending' | 'active' | 'done';
}

export interface RefreshProgressState {
  // State
  activeRefresh: { widgetId: string; label: string } | null;
  progress: number; // 0-100
  statusText: string;
  steps: RefreshStep[];
  estDurationMs: number;
  timeRemaining: number; // in seconds
  isCache: boolean;

  // Actions
  startRefresh: (
    widgetId: string,
    label: string,
    steps: string[],
    expectedDurationMs?: number,
    isCache?: boolean
  ) => void;
  updateStep: (index: number, statusText?: string) => void;
  completeRefresh: (successMessage?: string) => Promise<void>;
  cancelRefresh: () => void;
}

let progressInterval: ReturnType<typeof setInterval> | null = null;
let startTime = 0;

export const useRefreshProgressStore = create<RefreshProgressState>((set, get) => ({
  activeRefresh: null,
  progress: 0,
  statusText: '',
  steps: [],
  estDurationMs: 2000,
  timeRemaining: 2,
  isCache: false,

  startRefresh: (widgetId, label, stepLabels, expectedDurationMs = 2000, isCache = false) => {
    // Clear any existing progress intervals
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }

    const steps: RefreshStep[] = stepLabels.map((lbl, idx) => ({
      label: lbl,
      status: idx === 0 ? 'active' : 'pending',
    }));

    startTime = Date.now();

    set({
      activeRefresh: { widgetId, label },
      progress: 5,
      statusText: stepLabels[0] || 'Initializing reload...',
      steps,
      estDurationMs: expectedDurationMs,
      timeRemaining: Math.ceil(expectedDurationMs / 1000),
      isCache,
    });

    // Start a smooth progress simulation interval
    const updateFreqMs = 100;
    progressInterval = setInterval(() => {
      const state = get();
      if (!state.activeRefresh) {
        if (progressInterval) clearInterval(progressInterval);
        return;
      }

      const elapsed = Date.now() - startTime;
      const duration = state.estDurationMs;
      
      // Calculate remaining time
      const remainingSec = Math.max(0, Math.ceil((duration - elapsed) / 1000));

      // Calculate progress with a logarithmic deceleration curve (reaches ~90% at duration)
      let newProgress = Math.round(92 * (1 - Math.exp(-2.2 * (elapsed / duration))));
      newProgress = Math.max(state.progress, Math.min(94, newProgress));

      // Auto advance steps based on progress thresholds if not manually driven
      const updatedSteps = [...state.steps];
      const stepCount = updatedSteps.length;
      if (stepCount > 1) {
        const activeIdx = updatedSteps.findIndex(s => s.status === 'active');
        if (activeIdx !== -1) {
          const stepThreshold = ((activeIdx + 1) / stepCount) * 85;
          if (newProgress >= stepThreshold && activeIdx < stepCount - 1) {
            updatedSteps[activeIdx].status = 'done';
            updatedSteps[activeIdx + 1].status = 'active';
            set({
              steps: updatedSteps,
              statusText: updatedSteps[activeIdx + 1].label
            });
          }
        }
      }

      set({
        progress: newProgress,
        timeRemaining: remainingSec,
      });
    }, updateFreqMs);
  },

  updateStep: (index, newStatusText) => {
    const { steps } = get();
    if (!steps.length || index < 0 || index >= steps.length) return;

    const updatedSteps = steps.map((s, idx) => {
      if (idx < index) return { ...s, status: 'done' as const };
      if (idx === index) return { ...s, status: 'active' as const };
      return { ...s, status: 'pending' as const };
    });

    set({
      steps: updatedSteps,
      statusText: newStatusText || updatedSteps[index].label,
      progress: Math.min(94, Math.round(((index + 1) / steps.length) * 85))
    });
  },

  completeRefresh: async (successMessage = 'Data Sync Completed!') => {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }

    const { steps } = get();
    const completedSteps = steps.map(s => ({ ...s, status: 'done' as const }));

    set({
      progress: 100,
      statusText: successMessage,
      steps: completedSteps,
      timeRemaining: 0,
    });

    await new Promise(resolve => setTimeout(resolve, 600));

    set({
      activeRefresh: null,
      progress: 0,
      statusText: '',
      steps: [],
    });
  },

  cancelRefresh: () => {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
    set({
      activeRefresh: null,
      progress: 0,
      statusText: '',
      steps: [],
    });
  }
}));
