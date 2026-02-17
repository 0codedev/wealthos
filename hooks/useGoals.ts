import { useCallback, useMemo, useState, useEffect } from 'react';
import { liveQuery } from 'dexie';
import { db, Goal } from '../database';

export interface UseGoalsReturn {
    goals: Goal[];
    addGoal: (goal: Omit<Goal, 'id' | 'createdAt'>) => Promise<number>;
    updateGoal: (id: number, updates: Partial<Goal>) => Promise<void>;
    deleteGoal: (id: number) => Promise<void>;
    completeGoal: (id: number) => Promise<void>;
    getGoalProgress: (goal: Goal) => number;
    getTotalProgress: () => number;
    getGoalsByPriority: () => { critical: Goal[]; important: Goal[]; niceToHave: Goal[] };
}

const GOAL_COLORS = [
    '#6366f1', // Indigo
    '#ec4899', // Pink
    '#10b981', // Emerald
    '#f59e0b', // Amber
    '#8b5cf6', // Purple
    '#06b6d4', // Cyan
    '#ef4444', // Red
    '#84cc16', // Lime
];

export function useGoals(): UseGoalsReturn {
    // Fetch all goals, sorted by priority and target date
    const [goals, setGoals] = useState<Goal[]>([]);

    useEffect(() => {
        const subscription = liveQuery(async () => {
            const allGoals = await db.goals.toArray();
            return allGoals.sort((a, b) => {
                const priorityOrder = { 'Critical': 0, 'Important': 1, 'Nice-to-Have': 2 };
                const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
                if (pDiff !== 0) return pDiff;
                return new Date(a.targetDate).getTime() - new Date(b.targetDate).getTime();
            });
        }).subscribe(setGoals);

        return () => subscription.unsubscribe();
    }, []);

    // Add a new goal
    const addGoal = useCallback(async (goal: Omit<Goal, 'id' | 'createdAt'>): Promise<number> => {
        const colorIndex = (await db.goals.count()) % GOAL_COLORS.length;
        const id = await db.goals.add({
            ...goal,
            color: goal.color || GOAL_COLORS[colorIndex],
            createdAt: new Date().toISOString(),
        });
        return id as number;
    }, []);

    // Update an existing goal
    const updateGoal = useCallback(async (id: number, updates: Partial<Goal>): Promise<void> => {
        await db.goals.update(id, updates);
    }, []);

    // Delete a goal
    const deleteGoal = useCallback(async (id: number): Promise<void> => {
        await db.goals.delete(id);
    }, []);

    // Mark goal as completed
    const completeGoal = useCallback(async (id: number): Promise<void> => {
        await db.goals.update(id, {
            completedAt: new Date().toISOString(),
        });
    }, []);

    // Calculate progress for a single goal (0-100)
    const getGoalProgress = useCallback((goal: Goal): number => {
        if (!goal.targetAmount || goal.targetAmount <= 0) return 0;
        return Math.min((goal.currentAmount / goal.targetAmount) * 100, 100);
    }, []);

    // Calculate overall progress across all goals
    const getTotalProgress = useCallback((): number => {
        if (goals.length === 0) return 0;
        const totalTarget = goals.reduce((sum, g) => sum + g.targetAmount, 0);
        const totalCurrent = goals.reduce((sum, g) => sum + g.currentAmount, 0);
        if (totalTarget <= 0) return 0;
        return Math.min((totalCurrent / totalTarget) * 100, 100);
    }, [goals]);

    // Group goals by priority
    const getGoalsByPriority = useCallback(() => {
        return {
            critical: goals.filter(g => g.priority === 'Critical'),
            important: goals.filter(g => g.priority === 'Important'),
            niceToHave: goals.filter(g => g.priority === 'Nice-to-Have'),
        };
    }, [goals]);

    return {
        goals,
        addGoal,
        updateGoal,
        deleteGoal,
        completeGoal,
        getGoalProgress,
        getTotalProgress,
        getGoalsByPriority,
    };
}

export default useGoals;
