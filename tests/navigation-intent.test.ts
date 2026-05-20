import { describe, expect, it } from 'vitest';
import { useNavigationIntentStore } from '../store/navigationIntentStore';

describe('navigation intent store', () => {
  it('stores and clears navigation intent', () => {
    useNavigationIntentStore.getState().setIntent({
      target: 'portfolio',
      action: 'broker-sync',
      createdAt: 1,
    });

    expect(useNavigationIntentStore.getState().intent).toEqual({
      target: 'portfolio',
      action: 'broker-sync',
      createdAt: 1,
    });

    useNavigationIntentStore.getState().clearIntent();
    expect(useNavigationIntentStore.getState().intent).toBeNull();
  });
});
