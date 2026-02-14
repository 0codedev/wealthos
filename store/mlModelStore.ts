import { create } from 'zustand';
import { ModelVersion, db } from '../database';

export interface MLModelState {
  currentVersion: number;
  accuracy: number;
  loss: number;
  totalTrainingSteps: number;
  lastTrainedAt: number | null;
  versionsHistory: ModelVersion[];
  isTraining: boolean;
  rlBufferSize: number;
  
  updateMetrics: (metrics: Partial<Omit<MLModelState, 'updateMetrics' | 'fetchHistory'>>) => void;
  fetchHistory: () => Promise<void>;
}

export const useMLModelStore = create<MLModelState>((set) => ({
  currentVersion: 1,
  accuracy: 0.75, // initial dummy or default
  loss: 0.25,
  totalTrainingSteps: 0,
  lastTrainedAt: null,
  versionsHistory: [],
  isTraining: false,
  rlBufferSize: 0,

  updateMetrics: (metrics) => set((state) => ({ ...state, ...metrics })),
  
  fetchHistory: async () => {
    try {
      const history = await db.model_versions.orderBy('version').reverse().toArray();
      const current = history.find(v => v.isCurrent === 1);
      const rlBufferSize = await db.rl_experiences.count();

      set({
        versionsHistory: history,
        currentVersion: current ? current.version : 1,
        accuracy: current ? current.accuracy : 0.75,
        loss: current ? current.loss : 0.25,
        rlBufferSize
      });
    } catch (err) {
      console.error('Failed to fetch ML model version history', err);
    }
  }
}));
export default useMLModelStore;
