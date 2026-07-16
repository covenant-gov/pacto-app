import { describe, expect, it } from 'vitest';
import { governanceTreasuryHeading, treasuryVaultHeading } from './treasury-vault-labels';

describe('treasury vault labels', () => {
  const entry = {
    id: '1',
    parentId: 'p1',
    safeAddress: '0xabc',
    chain: 'sepolia',
    label: '',
    createdAtMs: 1,
  };

  it('labels standalone vault with name', () => {
    expect(treasuryVaultHeading({ ...entry, label: 'Ops' })).toBe('Vault: Ops');
  });

  it('falls back to generic multisig label', () => {
    expect(treasuryVaultHeading(entry)).toBe('Vault: Multisig');
  });

  it('uses dedicated governance treasury heading', () => {
    expect(governanceTreasuryHeading()).toBe('Squad governance treasury (Pacto Gov Safe)');
  });
});
