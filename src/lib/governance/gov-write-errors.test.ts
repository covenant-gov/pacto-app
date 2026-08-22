import { describe, expect, it, vi } from 'vitest';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock('svelte-i18n', () => ({
  t: {
    subscribe: (fn: (v: (k: string, opts?: { values?: Record<string, string> }) => string) => void) => {
      fn((k, opts) => (opts?.values ? `${k}:${JSON.stringify(opts.values)}` : k));
      return () => {};
    },
  },
}));

vi.mock('../../stores/toast', () => ({ showToast }));

import {
  govWriteErrorMessage,
  parseWalletErrorCode,
  revertCodeFromError,
  showGovWriteErrorToast,
} from './gov-write-errors';

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
  it('maps known sponsor/paymaster/ACL codes to i18n keys', () => {
    expect(govWriteErrorMessage('{"code":"SPONSOR_POOL_LOW","message":"x"}', 'Vote')).toBe(
      'governance.error.sponsorPoolLow',
    );
    expect(govWriteErrorMessage('{"code":"SPONSOR_INELIGIBLE","message":"x"}', 'Vote')).toBe(
      'governance.error.sponsorIneligible',
    );
    expect(govWriteErrorMessage('{"code":"PAYMASTER_REJECTED","message":"x"}', 'Vote')).toBe(
      'governance.error.paymasterRejected',
    );
    expect(govWriteErrorMessage('{"code":"ACL_UNBOUND","message":"x"}', 'Vote')).toBe(
      'governance.error.aclUnbound',
    );
    expect(govWriteErrorMessage('{"code":"ACL_DENIED","message":"x"}', 'Vote')).toBe(
      'governance.error.aclDenied',
    );
    expect(govWriteErrorMessage('{"code":"USEROP_CALL_GAS","message":"x"}', 'Vote')).toBe(
      'governance.error.useropCallGas',
    );
    expect(govWriteErrorMessage('{"code":"USEROP_CALL_REVERTED","message":"x"}', 'Vote')).toBe(
      'governance.error.useropCallReverted',
    );
    expect(govWriteErrorMessage('{"code":"PAYMASTER_VALIDATION","message":"x"}', 'Vote')).toBe(
      'governance.error.paymasterValidation',
    );
  });

  it('shows mapped errors with error toast styling', () => {
    showGovWriteErrorToast('{"code":"USEROP_CALL_GAS","message":"x"}', 'Execute mutiny');
    expect(showToast).toHaveBeenCalledWith(
      'governance.error.useropCallGas',
      undefined,
      undefined,
      { error: true },
    );
  });

  it('falls back for unknown codes', () => {
    expect(govWriteErrorMessage('{"code":"OTHER","message":"backend said this"}', 'Vote')).toBe(
      'backend said this',
    );
  });

  it('maps mutiny revert selectors and does not leak raw RPC', () => {
    const raw =
      '{"code":"SEND_FAILED","message":"server returned an error response: error code 3: execution reverted, data: \'0xc4aedfdd\'"}';
    expect(revertCodeFromError(raw)).toBe('MUTINY_NOT_ACTIVE');
    const msg = govWriteErrorMessage(raw, 'Expire mutiny');
    expect(msg).toBe('governance.error.mutinyNotActive');
    expect(msg).not.toContain('0xc4aedfdd');
    expect(msg).not.toContain('execution reverted');
    expect(govWriteErrorMessage('{"code":"MUTINY_NOT_EXPIRED","message":"x"}', 'Expire mutiny')).toBe(
      'governance.error.mutinyNotExpired',
    );
    expect(govWriteErrorMessage('{"code":"MUTINY_EXPIRED","message":"x"}', 'Execute mutiny')).toBe(
      'governance.error.mutinyExpired',
    );
    expect(govWriteErrorMessage('{"code":"GOV_CALL_REVERTED","message":"x"}', 'Vote')).toBe(
      'governance.error.govCallReverted',
    );
    expect(govWriteErrorMessage('{"code":"SEND_FAILED","message":"nonce too low"}', 'Vote')).toBe(
      'governance.error.govCallReverted',
    );
    expect(govWriteErrorMessage('{"code":"TX_REVERTED","message":"mined but reverted"}', 'Vote')).toBe(
      'governance.error.govCallReverted',
    );
  });
});
