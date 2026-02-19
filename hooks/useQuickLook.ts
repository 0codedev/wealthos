import { create } from 'zustand';

export type QuickLookType = 'STOCK' | 'TRANSACTION' | 'INVESTMENT' | 'IPO';

export interface QuickLookStockData {
    symbol: string;
    companyName?: string;
    sector?: string;
    ltp: number;
    pctChange: number;
    rFactor?: number;
    high?: number;
    low?: number;
    volume?: string | number;
    sparkline?: number[];
}

export interface QuickLookTxnData {
    id: string;
    description: string;
    amount: number;
    category: string;
    type: 'debit' | 'credit';
    date: string;
    bankName?: string;
    notes?: string;
    merchant?: string;
}

export interface QuickLookInvestmentData {
    id?: string;
    name: string;
    type: string;
    platform?: string;
    investedAmount: number;
    currentValue: number;
    returnsPct?: number;
    sector?: string;
    tags?: string[];
}

export interface QuickLookIpoData {
    companyName: string;
    symbol?: string;
    issuePrice: number | string;
    gmp?: number | string;
    gmpPct?: number;
    subscription?: string | number;
    status?: string;
    listingDate?: string;
}

export type QuickLookData = 
    | { type: 'STOCK'; data: QuickLookStockData }
    | { type: 'TRANSACTION'; data: QuickLookTxnData }
    | { type: 'INVESTMENT'; data: QuickLookInvestmentData }
    | { type: 'IPO'; data: QuickLookIpoData };

interface QuickLookState {
    isOpen: boolean;
    current: QuickLookData | null;
    openQuickLook: (payload: QuickLookData) => void;
    closeQuickLook: () => void;
    toggleQuickLook: (payload?: QuickLookData) => void;
}

export const useQuickLookStore = create<QuickLookState>((set, get) => ({
    isOpen: false,
    current: null,
    openQuickLook: (payload) => set({ isOpen: true, current: payload }),
    closeQuickLook: () => set({ isOpen: false, current: null }),
    toggleQuickLook: (payload) => {
        const state = get();
        if (state.isOpen) {
            set({ isOpen: false, current: null });
        } else if (payload) {
            set({ isOpen: true, current: payload });
        }
    }
}));
