import { describe, expect, it } from 'vitest';
import {
  buildStandaloneSafeProviderPayload,
  isPactoGovTreasurySafe,
  pactoGovPayloadFromInfra,
  parseStandaloneSafeProviderPayload,
  standaloneSafeInfraRows,
} from './standalone-safe-payload';
import type { SquadInfraDto } from './api';

const PARENT = 'test-parent';

function makeSquadInfra(overrides: Partial<SquadInfraDto> = {}): SquadInfraDto {
  return {
    id: 'id-1',
    parentId: PARENT,
    infraType: 'pacto_gov',
    chain: 'sepolia',
    canonicalRef: '0x1234567890123456789012345678901234567890',
    createdAtMs: 1,
    updatedAtMs: 2,
    ...overrides,
  };
}

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

  it('returns false when pacto payload is null', () => {
    expect(isPactoGovTreasurySafe('0x1234567890123456789012345678901234567890', null)).toBe(false);
  });

  it('returns false when safe addresses do not match', () => {
    expect(
      isPactoGovTreasurySafe('0x1111111111111111111111111111111111111111', {
        safe: '0x2222222222222222222222222222222222222222',
      }),
    ).toBe(false);
  });

  it('trims whitespace from both addresses before comparing', () => {
    expect(
      isPactoGovTreasurySafe('  0xabcdef0123456789012345678901234567890abcd  ', {
        safe: '  0xAbCdEf0123456789012345678901234567890AbCd  ',
      }),
    ).toBe(true);
  });

  it('returns false when safe is whitespace-only', () => {
    expect(
      isPactoGovTreasurySafe('0x1234567890123456789012345678901234567890', {
        safe: '  ',
      }),
    ).toBe(false);
  });
});

describe('standaloneSafeInfraRows', () => {
  it('returns only standalone_safe rows', () => {
    const rows = [
      makeSquadInfra({ infraType: 'standalone_safe', id: 's1' }),
      makeSquadInfra({ infraType: 'pacto_gov', id: 'p1' }),
      makeSquadInfra({ infraType: 'standalone_safe', id: 's2' }),
    ];
    const result = standaloneSafeInfraRows(rows);
    expect(result.map((r) => r.id)).toEqual(['s1', 's2']);
  });

  it('returns empty array for undefined rows', () => {
    expect(standaloneSafeInfraRows(undefined)).toEqual([]);
  });

  it('returns empty array when no standalone rows exist', () => {
    expect(standaloneSafeInfraRows([makeSquadInfra({ infraType: 'pacto_gov' })])).toEqual([]);
  });
});

describe('pactoGovPayloadFromInfra', () => {
  it('parses provider payload from pacto_gov row', () => {
    const payload = { safe: '0x1234', v: 1 };
    const rows = [
      makeSquadInfra({ infraType: 'pacto_gov', providerPayload: JSON.stringify(payload) }),
    ];
    expect(pactoGovPayloadFromInfra(rows)).toEqual(payload);
  });

  it('returns null when no pacto_gov row exists', () => {
    expect(pactoGovPayloadFromInfra([makeSquadInfra({ infraType: 'sponsor' })])).toBeNull();
  });

  it('returns null when payload is invalid JSON', () => {
    const rows = [
      makeSquadInfra({ infraType: 'pacto_gov', providerPayload: 'not-json' }),
    ];
    expect(pactoGovPayloadFromInfra(rows)).toBeNull();
  });

  it('returns null when payload is empty', () => {
    const rows = [
      makeSquadInfra({ infraType: 'pacto_gov', providerPayload: '  ' }),
    ];
    expect(pactoGovPayloadFromInfra(rows)).toBeNull();
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

  it('omits optional label and txHash when blank', () => {
    const raw = buildStandaloneSafeProviderPayload({
      treasuryEntryId: 'vault-1',
      safeAddress: '0x1234567890123456789012345678901234567890',
      label: '  ',
      txHash: '',
    });
    const parsed = parseStandaloneSafeProviderPayload(raw);
    expect(parsed).toEqual({ v: 1, treasuryEntryId: 'vault-1', safe_address: '0x1234567890123456789012345678901234567890' });
  });

  it('parseStandaloneSafeProviderPayload returns null for empty or malformed input', () => {
    expect(parseStandaloneSafeProviderPayload(null)).toBeNull();
    expect(parseStandaloneSafeProviderPayload('')).toBeNull();
    expect(parseStandaloneSafeProviderPayload('  ')).toBeNull();
    expect(parseStandaloneSafeProviderPayload('not-json')).toBeNull();
  });
});
