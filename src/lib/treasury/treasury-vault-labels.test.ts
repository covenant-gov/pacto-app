import { describe, expect, it } from 'vitest';
import { treasuryVaultHeading } from './treasury-vault-labels';

describe('treasuryVaultHeading', () => {
  const entry = {
    id: '1',
    parentId: 'p1',
    safeAddress: '0xabc',
    chain: 'sepolia',
    label: '',
    createdAtMs: 1,
  };

  it('labels pacto-gov treasury safe', () => {
    expect(
      treasuryVaultHeading(entry, { safe: '0xAbC' }),
    ).toBe('Governance: Treasury');
  });

  it('labels standalone vault with name', () => {
    expect(
      treasuryVaultHeading({ ...entry, safeAddress: '0xdef', label: 'Ops' }, { safe: '0xabc' }),
    ).toBe('Vault: Ops');
  });

  it('falls back to generic multisig label', () => {
    expect(treasuryVaultHeading({ ...entry, safeAddress: '0xdef' }, null)).toBe('Vault: Multisig');
  });
});
