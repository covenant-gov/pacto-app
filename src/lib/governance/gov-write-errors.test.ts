import { describe, expect, it, vi } from 'vitest';

vi.mock('svelte-i18n', () => ({
  t: {
    subscribe: (fn: (v: (k: string, opts?: { values?: Record<string, string> }) => string) => void) => {
      fn((k, opts) => (opts?.values ? `${k}:${JSON.stringify(opts.values)}` : k));
      return () => {};
    },
  },
}));

import { govWriteErrorMessage, parseWalletErrorCode } from './gov-write-errors';

describe('parseWalletErrorCode', () => {
  it('reads code from stringified wallet_err_json', () => {
    expect(parseWalletErrorCode('{"code":"SPONSOR_POOL_LOW","message":"low"}')).toBe('SPONSOR_POOL_LOW');
  });

  it('reads code from object message', () => {
    expect(
      parseWalletErrorCode({ message: '{"code":"PAYMASTER_REJECTED","message":"no"}' }),
    ).toBe('PAYMASTER_REJECTED');
  });

  it('returns null when absent', () => {
    expect(parseWalletErrorCode('plain error')).toBeNull();
  });
});

describe('govWriteErrorMessage', () => {
  it('maps known sponsor/paymaster codes to i18n keys', () => {
    expect(govWriteErrorMessage('{"code":"SPONSOR_POOL_LOW","message":"x"}', 'Vote')).toBe(
      'governance.error.sponsorPoolLow',
    );
    expect(govWriteErrorMessage('{"code":"SPONSOR_INELIGIBLE","message":"x"}', 'Vote')).toBe(
      'governance.error.sponsorIneligible',
    );
    expect(govWriteErrorMessage('{"code":"PAYMASTER_REJECTED","message":"x"}', 'Vote')).toBe(
      'governance.error.paymasterRejected',
    );
  });

  it('falls back for unknown codes', () => {
    expect(govWriteErrorMessage('{"code":"OTHER","message":"backend said this"}', 'Vote')).toBe(
      'backend said this',
    );
  });
});
