import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('./squad-member-evm-share', () => ({
  publishSquadMemberEvmShare: vi.fn().mockResolvedValue(true),
}));

vi.mock('../wallet/evm-accounts', () => ({
  addEvmAccountRow: vi.fn(),
  getActiveSquadEvmSignerAddress: vi.fn(),
  isSquadPurposeAccount: (r: { purpose: string }) => r.purpose === 'squad',
  listEvmAccounts: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { addEvmAccountRow, listEvmAccounts } from '../wallet/evm-accounts';
import { publishSquadMemberEvmShare } from './squad-member-evm-share';
import { bindDefaultSquadSigner, bindNewSquadKey } from './squad-roster-binding';

describe('squad-roster-binding', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(publishSquadMemberEvmShare).mockClear();
    vi.mocked(addEvmAccountRow).mockReset();
    vi.mocked(listEvmAccounts).mockReset();
  });

  it('bindDefaultSquadSigner upserts account binding and publishes share', async () => {
    vi.mocked(listEvmAccounts).mockResolvedValue([
      {
        id: 'acct-1',
        scheme: 'bip44_v1',
        hdIndex: 0,
        address: '0xabc',
        label: '',
        purpose: 'squad',
        isActive: true,
        isDefaultShared: true,
        isActiveAdvanced: false,
      },
    ]);
    vi.mocked(invoke).mockResolvedValue(undefined);

    const ok = await bindDefaultSquadSigner('parent-mls');
    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith('upsert_squad_member_evm_account', {
      parentId: 'parent-mls',
      evmAccountId: 'acct-1',
    });
    expect(publishSquadMemberEvmShare).toHaveBeenCalledWith('parent-mls', { evmAddress: '0xabc' });
  });

  it('bindNewSquadKey creates account without active signer and publishes new address', async () => {
    vi.mocked(addEvmAccountRow).mockResolvedValue({
      id: 'acct-new',
      scheme: 'bip44_v1',
      hdIndex: 2,
      address: '0xnew',
      label: 'Squad key',
      purpose: 'squad',
      isActive: false,
      isDefaultShared: false,
      isActiveAdvanced: false,
    });
    vi.mocked(invoke).mockResolvedValue(undefined);

    const ok = await bindNewSquadKey('parent-mls');
    expect(ok).toBe(true);
    expect(addEvmAccountRow).toHaveBeenCalledWith({
      label: 'Squad key',
      setActiveSigner: false,
      setDefaultShared: false,
      purpose: 'squad',
    });
    expect(publishSquadMemberEvmShare).toHaveBeenCalledWith('parent-mls', { evmAddress: '0xnew' });
  });
});
