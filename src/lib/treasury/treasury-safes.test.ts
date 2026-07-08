import { describe, expect, it } from 'vitest';
import { vaultTreasurySafesForParent, type TreasurySafeEntry } from './treasury-safes';

const govTreasuryId = (parentId: string) => `pacto-gov-treasury-${parentId}`;

function row(id: string, parentId = 'squad-a'): TreasurySafeEntry {
  return {
    id,
    parentId,
    safeAddress: '0x1111111111111111111111111111111111111111',
    chain: 'sepolia',
    label: '',
    createdAtMs: 1,
  };
}

describe('vaultTreasurySafesForParent', () => {
  it('drops the pacto-gov treasury row for the parent', () => {
    const safes = [row(govTreasuryId('squad-a')), row('vault-1')];
    expect(vaultTreasurySafesForParent(safes, 'squad-a', govTreasuryId)).toEqual([row('vault-1')]);
  });

  it('keeps all rows when parent id is empty', () => {
    const safes = [row(govTreasuryId('squad-a')), row('vault-1')];
    expect(vaultTreasurySafesForParent(safes, '', govTreasuryId)).toEqual(safes);
  });
});
