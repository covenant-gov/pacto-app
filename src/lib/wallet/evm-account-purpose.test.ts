import { describe, expect, it } from 'vitest';
import {
  advancedEvmAccounts,
  isAdvancedPurposeAccount,
  isSquadPurposeAccount,
  squadEvmAccounts,
  type EvmAccountRow,
} from './evm-accounts';

const rows: EvmAccountRow[] = [
  {
    id: 's1',
    scheme: 'bip44_v1',
    hdIndex: 0,
    address: '0x1111111111111111111111111111111111111111',
    label: 'Squad',
    purpose: 'squad',
    isActive: true,
    isDefaultShared: true,
    isActiveAdvanced: false,
  },
  {
    id: 'a1',
    scheme: 'imported_private_key',
    hdIndex: null,
    address: '0x2222222222222222222222222222222222222222',
    label: '',
    purpose: 'advanced',
    isActive: false,
    isDefaultShared: false,
    isActiveAdvanced: true,
  },
];

describe('evm account purpose helpers', () => {
  it('filters squad and advanced lists', () => {
    expect(squadEvmAccounts(rows)).toHaveLength(1);
    expect(advancedEvmAccounts(rows)).toHaveLength(1);
  });

  it('classifies purpose flags', () => {
    expect(isSquadPurposeAccount(rows[0])).toBe(true);
    expect(isAdvancedPurposeAccount(rows[1])).toBe(true);
  });
});
