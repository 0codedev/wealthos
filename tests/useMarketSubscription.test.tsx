import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMarketSubscription } from '../hooks/useMarketSubscription';
import { upstoxWebSocketService } from '../services/UpstoxWebSocketService';

// Mock UpstoxWebSocketService
vi.mock('../services/UpstoxWebSocketService', () => {
  return {
    upstoxWebSocketService: {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    },
  };
});

describe('useMarketSubscription hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should subscribe to keys on mount and unsubscribe on unmount', () => {
    const keys = ['key2', 'key1'];
    const callback = vi.fn();
    const mode = 'full_d30';

    const { unmount } = renderHook(() => 
      useMarketSubscription(keys, callback, mode)
    );

    // Should sort keys before subscribing
    expect(upstoxWebSocketService.subscribe).toHaveBeenCalledWith(
      ['key1', 'key2'],
      callback,
      mode
    );

    unmount();

    expect(upstoxWebSocketService.unsubscribe).toHaveBeenCalledWith(
      ['key1', 'key2'],
      callback
    );
  });

  it('should handle empty or null keys list gracefully', () => {
    const callback = vi.fn();
    
    renderHook(() => useMarketSubscription([], callback));
    expect(upstoxWebSocketService.subscribe).not.toHaveBeenCalled();
  });

  it('should resubscribe when keys change', () => {
    let keys = ['key1'];
    const callback = vi.fn();

    const { rerender } = renderHook(
      ({ k }) => useMarketSubscription(k, callback),
      { initialProps: { k: keys } }
    );

    expect(upstoxWebSocketService.subscribe).toHaveBeenCalledTimes(1);
    expect(upstoxWebSocketService.subscribe).toHaveBeenLastCalledWith(['key1'], callback, 'full');

    // Rerender with different keys
    rerender({ k: ['key2', 'key3'] });

    // Should unsubscribe from old keys first
    expect(upstoxWebSocketService.unsubscribe).toHaveBeenCalledWith(['key1'], callback);
    // Should subscribe to new keys
    expect(upstoxWebSocketService.subscribe).toHaveBeenCalledTimes(2);
    expect(upstoxWebSocketService.subscribe).toHaveBeenLastCalledWith(['key2', 'key3'], callback, 'full');
  });
});
