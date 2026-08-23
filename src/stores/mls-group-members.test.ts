import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import * as nostrApi from '../lib/api/nostr';
import {
  ensureMlsGroupMembers,
  membersByGroupId,
  adminsByGroupId,
  pendingWelcomesByGroupId,
  refreshMlsGroupMembers,
  resetMlsGroupMembersStores,
} from './mls-group-members';

describe('mls group members store', () => {
  beforeEach(() => {
    resetMlsGroupMembersStores();
    vi.restoreAllMocks();
  });

  it('ensureMlsGroupMembers fetches once per group', async () => {
    vi.spyOn(nostrApi, 'getMlsGroupMembers').mockResolvedValue({
      group_id: 'group-1',
      members: ['npub-a'],
      admins: ['npub-admin'],
      pending_welcomes: [],
    });
    await ensureMlsGroupMembers('group-1');
    await ensureMlsGroupMembers('group-1');
    expect(nostrApi.getMlsGroupMembers).toHaveBeenCalledTimes(1);
    expect(get(membersByGroupId)['group-1']).toEqual(['npub-a']);
    expect(get(adminsByGroupId)['group-1']).toEqual(['npub-admin']);
    expect(get(pendingWelcomesByGroupId)['group-1']).toEqual([]);
  });

  it('stores pending_welcomes and replaces them on refresh', async () => {
    vi.spyOn(nostrApi, 'syncMlsGroupsNow').mockResolvedValue({ synced: 1, total: 1 });
    vi.spyOn(nostrApi, 'getMlsGroupMembers')
      .mockResolvedValueOnce({
        group_id: 'group-1',
        members: ['npub-a'],
        admins: ['npub-admin'],
        pending_welcomes: ['npub-b'],
      })
      .mockResolvedValueOnce({
        group_id: 'group-1',
        members: ['npub-a', 'npub-b'],
        admins: ['npub-admin'],
        pending_welcomes: [],
      });
    await ensureMlsGroupMembers('group-1');
    expect(get(pendingWelcomesByGroupId)['group-1']).toEqual(['npub-b']);
    await refreshMlsGroupMembers('group-1');
    expect(get(pendingWelcomesByGroupId)['group-1']).toEqual([]);
    resetMlsGroupMembersStores();
    expect(get(pendingWelcomesByGroupId)).toEqual({});
  });

  it('refreshMlsGroupMembers syncs and replaces cached list', async () => {
    vi.spyOn(nostrApi, 'syncMlsGroupsNow').mockResolvedValue({ synced: 1, total: 1 });
    vi.spyOn(nostrApi, 'getMlsGroupMembers')
      .mockResolvedValueOnce({
        group_id: 'group-1',
        members: ['npub-a'],
        admins: ['npub-admin'],
        pending_welcomes: [],
      })
      .mockResolvedValueOnce({
        group_id: 'group-1',
        members: ['npub-a', 'npub-b'],
        admins: ['npub-admin'],
        pending_welcomes: [],
      });
    await ensureMlsGroupMembers('group-1');
    await refreshMlsGroupMembers('group-1');
    expect(nostrApi.syncMlsGroupsNow).toHaveBeenCalledWith('group-1');
    expect(get(membersByGroupId)['group-1']).toEqual(['npub-a', 'npub-b']);
    expect(get(adminsByGroupId)['group-1']).toEqual(['npub-admin']);
  });

  it('skips virtual hub ids', async () => {
    const spy = vi.spyOn(nostrApi, 'getMlsGroupMembers');
    await ensureMlsGroupMembers('__squad_settings__');
    await ensureMlsGroupMembers('__squad_dashboard__');
    expect(spy).not.toHaveBeenCalled();
  });
});
