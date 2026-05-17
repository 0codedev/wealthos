if (window.performance && window.performance.mark) {
  window.performance.mark('frontend:reachable');
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { BrowserRouter } from 'react-router-dom';
import { bootCoordinator, BootLane } from './lib/bootCoordinator';

// Trigger P0 immediate boot tasks
bootCoordinator.executeLane(BootLane.P0_IMMEDIATE);
import { ToastProvider } from './components/shared/ToastProvider';
import { TransactionProvider } from './contexts/TransactionContext';
import { ErrorBoundary } from './components/ErrorBoundary';

// Official Meta Astryx Design System Stylesheets
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import './index.css';

// ──────────────────────────────────────────────────────────
// 1. MOUNT REACT FIRST (highest priority — never block this)
// ──────────────────────────────────────────────────────────
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Clear lock on boot just in case it got stuck from a failed restore
try {
  sessionStorage.removeItem('IS_RESTORING');
} catch (e) {
  console.warn("Could not clear session storage");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <TransactionProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </TransactionProvider>
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

// ──────────────────────────────────────────────────────────
// 2. NON-CRITICAL: Register PWA Service Worker (after mount)
// ──────────────────────────────────────────────────────────
try {
  if (!import.meta.env.DEV) {
    // @ts-ignore
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({
      onNeedRefresh() {
        console.log('New content available, click on reload button to update.');
      },
      onOfflineReady() {
        console.log('App is ready to work offline.');
      },
    });
  } else {
    console.log('PWA Service worker skipped in DEV mode');
  }
} catch (e) {
  console.warn('PWA registration skipped:', e);
}

// ──────────────────────────────────────────────────────────
// 3. DEV ONLY: Expose MOM Portfolio utilities to console
// ──────────────────────────────────────────────────────────
if (import.meta.env.DEV) {
  import('./utils/seedMomPortfolio').then(({ seedMomPortfolio, clearMomPortfolio, getMomPortfolioSummary }) => {
    (window as any).momPortfolio = {
      seed: seedMomPortfolio,
      clear: clearMomPortfolio,
      summary: getMomPortfolioSummary,
      help: () => console.log(`
        🏠 MOM Portfolio Import Functions
        ─────────────────────────────────
        window.momPortfolio.seed()    → Import Zerodha holdings for MOM
        window.momPortfolio.clear()   → Remove all MOM assets
        window.momPortfolio.summary() → View MOM portfolio summary
      `)
    };
  }).catch(() => { });
}