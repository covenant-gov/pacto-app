import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { invoke, getSquadAdminExecutorRoles } = vi.hoisted(() => ({
  invoke: vi.fn(),
  getSquadAdminExecutorRoles: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('./api/squad-admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/squad-admin')>();
  return {
    ...actual,
    getSquadAdminExecutorRoles,
  };
});

import { currentUser } from '../../stores/auth-session';
import { squadInfraByParentId } from '../../stores/squads';
import {
  FLAG_BROADCAST,
  FLAG_INVITE_ACCEPT,
  encodePrivilegeRoleId,
} from './privilege-role-id';
import {
  decideSquadPrivilege,
  requireMySquadPrivilege,
} from './squad-privilege-enforce';

const mockedInvoke = invoke;
const mockedRoles = getSquadAdminExecutorRoles;

describe('squad-privilege-enforce', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedRoles.mockReset();
    squadInfraByParentId.set({});
    currentUser.set({ npub: 'npub1me' } as never);
  });

  it('allows when SquadAdmin is not deployed', async () => {
    const d = await decideSquadPrivilege({
      parentId: 'parent-1',
      memberNpub: 'npub1alice',
      action: 'inviteAccept',
    });
    expect(d).toEqual({ ok: true, active: false, flags: null });
  });

  it('denies unbound when SquadAdmin is live', async () => {
    squadInfraByParentId.set({
      'parent-1': [
        {
          id: '1',
          parentId: 'parent-1',
          infraType: 'squad_admin',
          canonicalRef: '0xadmin',
          chain: 'sepolia',
          providerPayload: JSON.stringify({ squadAdminProxy: '0xadmin' }),
        } as never,
      ],
    });
    mockedInvoke.mockResolvedValueOnce([]);
    const d = await decideSquadPrivilege({
      parentId: 'parent-1',
      memberNpub: 'npub1alice',
      action: 'inviteAccept',
    });
    expect(d).toEqual({ ok: false, reason: 'unbound', active: true });
  });

  it('grants invite when role flag present', async () => {
    squadInfraByParentId.set({
      'parent-1': [
        {
          id: '1',
          parentId: 'parent-1',
          infraType: 'squad_admin',
          canonicalRef: '0xadmin',
          chain: 'sepolia',
          providerPayload: JSON.stringify({ squadAdminProxy: '0xadmin' }),
        } as never,
      ],
    });
    const roleId = encodePrivilegeRoleId({ name: 'Mod', flags: FLAG_INVITE_ACCEPT });
    mockedRoles.mockResolvedValueOnce({
      address: '0xabc',
      fullPermission: false,
      paused: false,
      roles: [{ role: roleId, enabled: true }],
    });
    const d = await decideSquadPrivilege({
      parentId: 'parent-1',
      memberNpub: 'npub1alice',
      action: 'inviteAccept',
      evmAddress: '0xabc',
    });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.active).toBe(true);
    expect(mockedRoles).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'parent-1', trustedRpc: true }),
    );
  });

  it('denies broadcast when only invite flag held', async () => {
    squadInfraByParentId.set({
      'parent-1': [
        {
          id: '1',
          parentId: 'parent-1',
          infraType: 'squad_admin',
          canonicalRef: '0xadmin',
          chain: 'sepolia',
          providerPayload: JSON.stringify({ squadAdminProxy: '0xadmin' }),
        } as never,
      ],
    });
    const roleId = encodePrivilegeRoleId({ name: 'Mod', flags: FLAG_INVITE_ACCEPT });
    mockedRoles.mockResolvedValueOnce({
      address: '0xabc',
      fullPermission: false,
      paused: false,
      roles: [{ role: roleId, enabled: true }],
    });
    const d = await decideSquadPrivilege({
      parentId: 'parent-1',
      memberNpub: 'npub1alice',
      action: 'broadcast',
      evmAddress: '0xabc',
    });
    expect(d).toEqual({ ok: false, reason: 'denied', active: true });
  });

  it('FULL grants broadcast; PAUSE overrides', async () => {
    squadInfraByParentId.set({
      'parent-1': [
        {
          id: '1',
          parentId: 'parent-1',
          infraType: 'squad_admin',
          canonicalRef: '0xadmin',
          chain: 'sepolia',
          providerPayload: JSON.stringify({ squadAdminProxy: '0xadmin' }),
        } as never,
      ],
    });
    mockedRoles.mockResolvedValueOnce({
      address: '0xabc',
      fullPermission: true,
      paused: false,
      roles: [],
    });
    const ok = await decideSquadPrivilege({
      parentId: 'parent-1',
      memberNpub: 'npub1alice',
      action: 'broadcast',
      evmAddress: '0xabc',
    });
    expect(ok.ok).toBe(true);

    mockedRoles.mockResolvedValueOnce({
      address: '0xabc',
      fullPermission: true,
      paused: true,
      roles: [
        {
          role: encodePrivilegeRoleId({ name: 'X', flags: FLAG_BROADCAST }),
          enabled: true,
        },
      ],
    });
    const paused = await decideSquadPrivilege({
      parentId: 'parent-1',
      memberNpub: 'npub1alice',
      action: 'broadcast',
      evmAddress: '0xabc',
    });
    expect(paused).toEqual({ ok: false, reason: 'paused', active: true });
  });

  it('requireMySquadPrivilege uses current user', async () => {
    expect(get(currentUser)?.npub).toBe('npub1me');
    const d = await requireMySquadPrivilege('parent-1', 'manageNetwork');
    expect(d).toEqual({ ok: true, active: false, flags: null });
  });
});
