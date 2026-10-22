import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/nostr', () => ({
  getMlsGroupMembers: vi.fn(),
  inviteMemberToGroup: vi.fn(),
  sendDmMessage: vi.fn(),
  formatChannelInSquadMessage: (payload: unknown) => JSON.stringify(payload),
}));

vi.mock('../../stores/mls-chat', () => ({ bumpMembershipVersion: vi.fn() }));
vi.mock('../../stores/mls-group-members', () => ({ refreshMlsGroupMembers: vi.fn() }));

vi.mock('../../stores/auth-session', async () => {
  const { writable } = await import('svelte/store');
  return { currentUser: writable({ npub: 'npub1admin' }) };
});

vi.mock('../../stores/squads', async () => {
  const { writable } = await import('svelte/store');
  return { squads: writable([]) };
});

import { getMlsGroupMembers, inviteMemberToGroup, sendDmMessage } from '../api/nostr';
import { bumpMembershipVersion } from '../../stores/mls-chat';
import { refreshMlsGroupMembers } from '../../stores/mls-group-members';
import {
  planSquadMemberRestore,
  resetRestoreSquadAccessState,
  restoreMemberToSquad,
  squadForAnnouncementsGroup,
  type GroupMembershipSnapshot,
} from './restore-squad-access';
import type { Channel, Squad } from '../../stores/squads';

function channel(partial: Partial<Channel> & Pick<Channel, 'name' | 'groupId'>): Channel {
  return { order: 0, ...partial };
}

const channels: Channel[] = [
  channel({ name: 'announcements', groupId: 'g-ann', order: 0 }),
  channel({ name: 'polls', groupId: 'g-ann', order: 1 }),
  channel({ name: 'ops', groupId: 'g-ops', order: 2, access: 'open' }),
  channel({ name: 'secret', groupId: 'g-sec', order: 3, access: 'closed' }),
  channel({ name: 'settings', groupId: '__settings', order: 4 }),
];

function membership(members: string[], admins: string[]): GroupMembershipSnapshot {
  return { members, admins };
}

describe('squadForAnnouncementsGroup', () => {
  const squad: Squad = {
    id: 'g-ann',
    name: 'Alpha',
    channels,
    kind: 'squad',
    createdAt: 1,
    updatedAt: 1,
  };

  it('matches the announcements group id only', () => {
    expect(squadForAnnouncementsGroup([squad], 'g-ann')?.id).toBe('g-ann');
    expect(squadForAnnouncementsGroup([squad], ' G-ANN ')?.id).toBe('g-ann');
  });

  it('does not match a channel group, a bare MLS group, or an empty id', () => {
    expect(squadForAnnouncementsGroup([squad], 'g-sec')).toBeUndefined();
    expect(squadForAnnouncementsGroup([squad], 'g-other')).toBeUndefined();
    expect(squadForAnnouncementsGroup([squad], '  ')).toBeUndefined();
  });
});

describe('planSquadMemberRestore', () => {
  const base = {
    channels,
    announcementsGroupId: 'g-ann',
    memberNpub: 'npub1bob',
    selfNpub: 'npub1admin',
  };

  it('restores channels the member still belongs to when this device is admin', () => {
    const plan = planSquadMemberRestore({
      ...base,
      membershipByGroupId: new Map([
        ['g-ops', membership(['npub1bob', 'npub1admin'], ['npub1admin'])],
        ['g-sec', membership(['npub1bob'], ['npub1admin'])],
      ]),
    });
    expect(plan.restoreGroupIds).toEqual(['g-ops', 'g-sec']);
    expect(plan.admitOpen).toEqual([]);
  });

  it('admits missing open channels and skips closed channels and groups this device is not in', () => {
    const plan = planSquadMemberRestore({
      ...base,
      membershipByGroupId: new Map<string, GroupMembershipSnapshot | null>([
        ['g-ops', membership(['npub1admin'], ['npub1admin'])],
        ['g-sec', null],
      ]),
    });
    expect(plan.restoreGroupIds).toEqual([]);
    expect(plan.admitOpen).toEqual([{ groupId: 'g-ops', name: 'ops' }]);
  });

  it('skips an existing leaf when this device is not an admin of that channel', () => {
    const plan = planSquadMemberRestore({
      ...base,
      membershipByGroupId: new Map([
        ['g-sec', membership(['npub1bob', 'npub1admin'], ['npub1other'])],
        ['g-ops', membership(['npub1bob'], [])],
      ]),
    });
    expect(plan.restoreGroupIds).toEqual([]);
    expect(plan.admitOpen).toEqual([]);
  });
});

describe('restoreMemberToSquad', () => {
  const squad: Squad = {
    id: 'g-ann',
    name: 'Alpha',
    channels,
    kind: 'squad',
    createdAt: 1,
    updatedAt: 1,
  };

  beforeEach(() => {
    resetRestoreSquadAccessState();
    vi.mocked(inviteMemberToGroup).mockReset().mockResolvedValue(undefined);
    vi.mocked(sendDmMessage).mockReset().mockResolvedValue(true);
    vi.mocked(getMlsGroupMembers).mockReset().mockResolvedValue({
      group_id: 'g-ops',
      members: [],
      admins: [],
      pending_welcomes: [],
    });
    vi.mocked(bumpMembershipVersion).mockReset();
    vi.mocked(refreshMlsGroupMembers).mockReset().mockResolvedValue([]);
  });

  it('repaints the members panel after the announcements re-add', async () => {
    const result = await restoreMemberToSquad({ parent: squad, memberNpub: 'npub1bob' });
    expect(result).toEqual({ ok: true });
    expect(inviteMemberToGroup).toHaveBeenCalledWith('g-ann', 'npub1bob');
    expect(bumpMembershipVersion).toHaveBeenCalledWith('g-ann');
    expect(refreshMlsGroupMembers).toHaveBeenCalledWith('g-ann');
  });

  it('does not repaint when the re-add fails', async () => {
    vi.mocked(inviteMemberToGroup).mockRejectedValueOnce(new Error('no admin rights'));
    const result = await restoreMemberToSquad({ parent: squad, memberNpub: 'npub1bob' });
    expect(result.ok).toBe(false);
    expect(bumpMembershipVersion).not.toHaveBeenCalled();
    expect(refreshMlsGroupMembers).not.toHaveBeenCalled();
  });

  it('drops the restore cooldown when the account changes', async () => {
    await restoreMemberToSquad({ parent: squad, memberNpub: 'npub1bob' });
    await vi.waitFor(() => expect(inviteMemberToGroup).toHaveBeenCalledWith('g-ops', 'npub1bob'));
    expect(await restoreMemberToSquad({ parent: squad, memberNpub: 'npub1bob' })).toEqual({
      ok: true,
      skipped: 'cooldown',
    });
    resetRestoreSquadAccessState();
    expect(await restoreMemberToSquad({ parent: squad, memberNpub: 'npub1bob' })).toEqual({
      ok: true,
    });
  });
});
