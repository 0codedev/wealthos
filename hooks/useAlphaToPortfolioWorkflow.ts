import { useNavigationIntentStore } from '../store/navigationIntentStore';

export function useAlphaToPortfolioWorkflow() {
  const sendToPortfolioWatchlist = (symbol: string, price: number, signal: string) => {
    useNavigationIntentStore.getState().setIntent({
      target: 'portfolio',
      action: 'add-from-alpha',
      payload: { symbol, price, signal },
      createdAt: Date.now()
    });
  };
  return { sendToPortfolioWatchlist };
}
