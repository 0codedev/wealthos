import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CategoryRule {
    id: string;
    pattern: string;   // "Swiggy", "Uber"
    category: string;  // "Food", "Transport"
    details?: string;  // Optional specific merchant name
    type: 'contains' | 'exact' | 'starts_with';
    matches: number;   // Track usage count
}

interface CategoryRulesState {
    rules: CategoryRule[];
    isAutoCategorizationEnabled: boolean;
    // Actions
    addRule: (rule: Omit<CategoryRule, 'id' | 'matches'>) => void;
    removeRule: (id: string) => void;
    updateRule: (id: string, updates: Partial<CategoryRule>) => void;
    toggleAutoCategorization: () => void;
    incrementMatchCount: (id: string) => void;
}

export const useCategoryRulesStore = create<CategoryRulesState>()(
    persist(
        (set) => ({
            rules: [],
            isAutoCategorizationEnabled: true,

            addRule: (rule) => set((state) => ({
                rules: [...state.rules, { ...rule, id: crypto.randomUUID(), matches: 0 }]
            })),

            removeRule: (id) => set((state) => ({
                rules: state.rules.filter(r => r.id !== id)
            })),

            updateRule: (id, updates) => set((state) => ({
                rules: state.rules.map(r => r.id === id ? { ...r, ...updates } : r)
            })),

            toggleAutoCategorization: () => set((state) => ({
                isAutoCategorizationEnabled: !state.isAutoCategorizationEnabled
            })),

            incrementMatchCount: (id) => set((state) => ({
                rules: state.rules.map(r => r.id === id ? { ...r, matches: r.matches + 1 } : r)
            }))
        }),
        {
            name: 'category-rules-storage',
        }
    )
);
