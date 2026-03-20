type TfModule = typeof import('@tensorflow/tfjs');

let _tf: TfModule | null = null;
let _loadPromise: Promise<TfModule | null> | null = null;

/**
 * Lazy-loads @tensorflow/tfjs on first call. Returns the cached module
 * on subsequent calls. Catches load errors so the caller can degrade
 * gracefully (e.g. show "Model unavailable" toast).
 */
export async function loadTf(): Promise<TfModule | null> {
  if (_tf) return _tf;
  if (_loadPromise) return _loadPromise;

  _loadPromise = import('@tensorflow/tfjs')
    .then(mod => {
      _tf = mod;
      return mod;
    })
    .catch(err => {
      console.error('[tensorflowLoader] Failed to load tfjs:', err);
      _loadPromise = null; // allow retry
      return null;
    });

  return _loadPromise;
}

export function isTfLoaded(): boolean {
  return _tf !== null;
}
