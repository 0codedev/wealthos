import { describe, expect, it, vi } from 'vitest';
import { ProvenanceGuard } from '../services/alpha/provenance_guard';
import { useSettingsStore } from '../store/settingsStore';

describe('ProvenanceGuard', () => {
  it('passes valid data payloads successfully', () => {
    const payload = {
      status: 'ok',
      data: { roe: 18.5, roce: 22.0 }
    };
    
    const result = ProvenanceGuard.guard<any>(payload);
    expect(result).toEqual({ roe: 18.5, roce: 22.0 });
  });

  it('passes simple raw values if no status is specified', () => {
    const rawVal = { hello: 'world' };
    const result = ProvenanceGuard.guard<any>(rawVal);
    expect(result).toEqual({ hello: 'world' });
  });

  it('throws an error if status is unavailable', () => {
    const payload = {
      status: 'unavailable',
      data: null,
      message: 'Failed to connect to Upstox'
    };

    expect(() => ProvenanceGuard.guard(payload)).toThrowError(/unavailable/);
  });

  it('throws an error if status is degraded in LIVE mode', () => {
    // Set dataMode to LIVE
    vi.spyOn(useSettingsStore, 'getState').mockReturnValue({
      dataMode: 'LIVE',
      isUpstoxEnabled: true,
      setDataMode: () => {}
    } as any);

    const payload = {
      status: 'degraded',
      data: { last_price: 100 }
    };

    expect(() => ProvenanceGuard.guard(payload)).toThrowError(/degraded/);
  });

  it('does not throw an error if status is degraded or demo_only in SIMULATION mode', () => {
    // Set dataMode to SIMULATION
    vi.spyOn(useSettingsStore, 'getState').mockReturnValue({
      dataMode: 'SIMULATION',
      isUpstoxEnabled: true,
      setDataMode: () => {}
    } as any);

    const payloadDemo = {
      status: 'demo_only',
      data: { score: 75 }
    };

    const payloadDegraded = {
      status: 'degraded',
      data: { price: 150 }
    };

    expect(ProvenanceGuard.guard(payloadDemo)).toEqual({ score: 75 });
    expect(ProvenanceGuard.guard(payloadDegraded)).toEqual({ price: 150 });
  });

  it('throws an error if status is demo_only in LIVE mode', () => {
    // Set dataMode to LIVE
    vi.spyOn(useSettingsStore, 'getState').mockReturnValue({
      dataMode: 'LIVE',
      isUpstoxEnabled: true,
      setDataMode: () => {}
    } as any);

    const payload = {
      status: 'demo_only',
      data: { score: 99 }
    };

    expect(() => ProvenanceGuard.guard(payload)).toThrowError(/demo/i);
  });
});
