import { describe, expect, it } from 'vitest';
import { buildSensitiveFieldSummary, maskSecret } from '../services/SecurityPrivacyService';

describe('security privacy helpers', () => {
  it('summarizes configured sensitive fields', () => {
    const summary = buildSensitiveFieldSummary({
      dhanClientId: '1234567890',
      dhanAccessToken: 'token-1234',
      geminiApiKey: 'gem-9999',
      apiKeys: {
        rapidApi: 'rapid-1',
        fmp: 'fmp-2',
      },
    });

    expect(summary.configuredCount).toBe(5);
    expect(summary.fields.find((field) => field.label === 'Dhan Access Token')?.configured).toBe(true);
    expect(summary.fields.find((field) => field.label === 'Groq API Key')?.configured).toBe(false);
  });

  it('masks secrets without leaking raw values', () => {
    expect(maskSecret('abcd1234')).toBe('ab••••34');
    expect(maskSecret('123')).toBe('••••');
    expect(maskSecret('')).toBe('Not set');
  });
});
