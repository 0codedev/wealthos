import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface TimeCapsule {
    id: string;
    createdAt: string;          // ISO date
    openDate: string;           // ISO date — can only open after this
    prediction: {
        targetValue: number;
        note: string;
        confidence: number;     // 1-100
        topHolding: string;
        marketOutlook: 'bull' | 'bear' | 'sideways';
    };
    snapshotAtCreation: {
        totalValue: number;
        totalInvested: number;
        topHoldings: { name: string; value: number }[];
    };
    isOpened: boolean;
    openedAt?: string;
    actualValueAtOpen?: number;
}

interface TimeCapsuleState {
    capsules: TimeCapsule[];
    createCapsule: (capsule: Omit<TimeCapsule, 'id' | 'createdAt' | 'isOpened'>) => void;
    openCapsule: (id: string, actualValue: number) => void;
    deleteCapsule: (id: string) => void;
}

export const useTimeCapsuleStore = create<TimeCapsuleState>()(
    persist(
        (set) => ({
            capsules: [],

            createCapsule: (capsule) => {
                const newCapsule: TimeCapsule = {
                    ...capsule,
                    id: `capsule_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                    createdAt: new Date().toISOString(),
                    isOpened: false,
                };
                set((state) => ({
                    capsules: [newCapsule, ...state.capsules],
                }));
            },

            openCapsule: (id, actualValue) => {
                set((state) => ({
                    capsules: state.capsules.map(c =>
                        c.id === id
                            ? {
                                ...c,
                                isOpened: true,
                                openedAt: new Date().toISOString(),
                                actualValueAtOpen: actualValue,
                            }
                            : c
                    ),
                }));
            },

            deleteCapsule: (id) => {
                set((state) => ({
                    capsules: state.capsules.filter(c => c.id !== id),
                }));
            },
        }),
        {
            name: 'wealth-time-capsules',
        }
    )
);
