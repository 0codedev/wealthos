
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface DayProgress {
  day: number;
  unlocked: boolean;
  completed: boolean;
  tasks?: any; // For Phase 2 logs or specific checkboxes
}

interface GamificationState {
  xp: number;
  level: string;
  sprintProgress: Record<number, DayProgress>;
  streak: number;
  lastVisitDate: string | null;
  
  // Actions
  addXp: (amount: number) => void;
  completeDay: (day: number) => void;
  unlockDay: (day: number) => void;
  initializeSprint: () => void;
  checkStreak: () => void;
}

const LEVELS = [
  { name: 'Novice', threshold: 0 },
  { name: 'Observer', threshold: 100 },
  { name: 'Chartist', threshold: 300 },
  { name: 'Analyst', threshold: 600 },
  { name: 'Strategist', threshold: 1000 },
  { name: 'Operator', threshold: 1500 },
  { name: 'Fund Manager', threshold: 2500 },
];

const getLevelName = (xp: number) => {
  const level = LEVELS.slice().reverse().find(l => xp >= l.threshold);
  return level ? level.name : 'Novice';
};

export const useGamificationStore = create<GamificationState>()(
  persist(
    (set, get) => ({
      xp: 0,
      level: 'Novice',
      sprintProgress: {},
      streak: 0,
      lastVisitDate: null,

      initializeSprint: () => {
        const { sprintProgress } = get();
        // Check if day 20 exists to ensure update for existing users
        if (Object.keys(sprintProgress).length < 20) {
          const initial: Record<number, DayProgress> = { ...sprintProgress };
          
          for (let i = 1; i <= 20; i++) {
            if (!initial[i]) {
                initial[i] = { 
                  day: i, 
                  unlocked: i === 1, 
                  completed: false 
                };
            }
          }
          set({ sprintProgress: initial });
        }
      },

      checkStreak: () => {
        const { lastVisitDate, streak } = get();
        const todayParts = new Date().toISOString().split('T');
        const today = todayParts[0];
        if (today === undefined) return;
        
        if (lastVisitDate === today) return; // Already logged today

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayParts = yesterday.toISOString().split('T');
        const yesterdayStr = yesterdayParts[0];
        if (yesterdayStr === undefined) return;

        if (lastVisitDate === yesterdayStr) {
            // Consecutive login
            set({ streak: streak + 1, lastVisitDate: today });
        } else {
            // Broken streak or first visit
            set({ streak: 1, lastVisitDate: today });
        }
      },

      addXp: (amount) => {
        set((state) => {
          // Apply Streak Multiplier
          // Streak > 3 days = 1.5x Multiplier
          const multiplier = state.streak >= 3 ? 1.5 : 1;
          const finalAmount = Math.round(amount * multiplier);

          const newXp = state.xp + finalAmount;
          return {
            xp: newXp,
            level: getLevelName(newXp)
          };
        });
      },

      completeDay: (day) => {
        set((state) => {
          const updated = { ...state.sprintProgress };
          const dayProgress = updated[day];
          if (dayProgress) {
            dayProgress.completed = true;
          }
          // Unlock next day
          if (day < 20) {
            const nextDay = updated[day + 1];
            if (nextDay) {
              nextDay.unlocked = true;
            }
          }
          return { sprintProgress: updated };
        });
      },

      unlockDay: (day) => {
        set((state) => {
          const updated = { ...state.sprintProgress };
          const dayProgress = updated[day];
          if (dayProgress) {
            dayProgress.unlocked = true;
          }
          return { sprintProgress: updated };
        });
      }
    }),
    {
      name: 'wealth-aggregator-xp',
    }
  )
);
