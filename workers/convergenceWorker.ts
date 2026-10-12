import { ConvergenceEngine } from '../services/alpha/ConvergenceEngine';

// Handle incoming messages from the main thread
self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  try {
    if (type === 'RUN_CONVERGENCE') {
      const { direction, mode, caches } = payload;
      
      const results = ConvergenceEngine.runConvergenceScan(direction, mode, caches);

      self.postMessage({
        type: 'CONVERGENCE_COMPLETE',
        payload: {
          results
        }
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({
      type: 'CONVERGENCE_ERROR',
      payload: message || 'Unknown error during convergence scanning'
    });
  }
};
