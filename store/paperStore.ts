
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PaperPosition {
  symbol: string;
  qty: number;
  avgPrice: number;
  type: 'LONG' | 'SHORT';
}

export interface PaperOrder {
  id: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  qty: number;
  price: number;
  status: 'EXECUTED' | 'PENDING' | 'CANCELLED';
  timestamp: string;
}

interface PaperState {
  capital: number;
  availableCash: number;
  positions: PaperPosition[];
  orders: PaperOrder[];

  // Actions
  placeOrder: (symbol: string, type: 'BUY' | 'SELL', qty: number, price: number) => void;
  resetAccount: () => void;
}

const INITIAL_CAPITAL = 1000000; // ₹10L Virtual Capital

export const usePaperStore = create<PaperState>()(
  persist(
    (set) => ({
      capital: INITIAL_CAPITAL,
      availableCash: INITIAL_CAPITAL,
      positions: [],
      orders: [],

      placeOrder: (symbol, type, qty, price) => {
        set((state) => {
          const orderValue = qty * price;

          // Basic Validation
          if (type === 'BUY' && state.availableCash < orderValue) {
            alert("Insufficient Buying Power");
            return state;
          }

          // Execute (Market Order Simulation)
          const newOrder: PaperOrder = {
            id: crypto.randomUUID(),
            symbol,
            type,
            qty,
            price,
            status: 'EXECUTED',
            timestamp: new Date().toISOString()
          };

          let newCash = state.availableCash;
          let newPositions = [...state.positions];

          const existingPosIndex = newPositions.findIndex(p => p.symbol === symbol);

          if (type === 'BUY') {
            newCash -= orderValue;
            if (existingPosIndex >= 0) {
              // Average Up/Down
              const pos = newPositions[existingPosIndex];
              if (pos) {
                const totalCost = (pos.avgPrice * pos.qty) + orderValue;
                const totalQty = pos.qty + qty;
                newPositions[existingPosIndex] = { ...pos, qty: totalQty, avgPrice: totalCost / totalQty };
              }
            } else {
              newPositions.push({ symbol, qty, avgPrice: price, type: 'LONG' });
            }
          } else {
            // SELL
            newCash += orderValue;
            if (existingPosIndex >= 0) {
              const pos = newPositions[existingPosIndex];
              if (pos) {
                if (pos.qty > qty) {
                  // Partial Sell
                  newPositions[existingPosIndex] = { ...pos, qty: pos.qty - qty };
                } else {
                  // Full Close
                  newPositions = newPositions.filter(p => p.symbol !== symbol);
                }
              }
            } else {
              // Short Selling Logic (Simplified: Just open SHORT position)
              newPositions.push({ symbol, qty, avgPrice: price, type: 'SHORT' });
            }
          }

          return {
            availableCash: newCash,
            orders: [newOrder, ...state.orders],
            positions: newPositions
          };
        });
      },

      resetAccount: () => {
        set({
          capital: INITIAL_CAPITAL,
          availableCash: INITIAL_CAPITAL,
          positions: [],
          orders: []
        });
      }
    }),
    {
      name: 'wealth-aggregator-paper-trader',
    }
  )
);
