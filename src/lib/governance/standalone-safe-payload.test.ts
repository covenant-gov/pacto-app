import { describe, expect, it } from 'vitest';
import {
  buildStandaloneSafeProviderPayload,
  isPactoGovTreasurySafe,
  parseStandaloneSafeProviderPayload,
} from './standalone-safe-payload';

describe('isPactoGovTreasurySafe', () => {
  it('matches pacto-gov treasury safe case-insensitively', () => {
    expect(
      isPactoGovTreasurySafe('0xAbCdEf0123456789012345678901234567890AbCd', {
        safe: '0xabcdef0123456789012345678901234567890abcd',
      }),
    ).toBe(true);
  });

  it('returns false when pacto payload has no safe', () => {
    expect(isPactoGovTreasurySafe('0x1234567890123456789012345678901234567890', {})).toBe(false);
  });
});

describe('standalone safe provider payload', () => {
  it('round-trips v1 fields', () => {
    const raw = buildStandaloneSafeProviderPayload({
      treasuryEntryId: 'vault-1',
      safeAddress: '0x1234567890123456789012345678901234567890',
      label: 'Ops',
      txHash: '0xabc',
    });
    const parsed = parseStandaloneSafeProviderPayload(raw);
    expect(parsed?.treasuryEntryId).toBe('vault-1');
    expect(parsed?.label).toBe('Ops');
    expect(parsed?.tx_hash).toBe('0xabc');
  });
});
