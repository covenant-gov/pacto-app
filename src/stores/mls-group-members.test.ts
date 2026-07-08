import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import * as nostrApi from '../lib/api/nostr';
import {
  ensureMlsGroupMembers,
  membersByGroupId,
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
      admins: [],
    });
    await ensureMlsGroupMembers('group-1');
    await ensureMlsGroupMembers('group-1');
    expect(nostrApi.getMlsGroupMembers).toHaveBeenCalledTimes(1);
    expect(get(membersByGroupId)['group-1']).toEqual(['npub-a']);
  });

  it('refreshMlsGroupMembers syncs and replaces cached list', async () => {
    vi.spyOn(nostrApi, 'syncMlsGroupsNow').mockResolvedValue({ synced: 1, total: 1 });
    vi.spyOn(nostrApi, 'getMlsGroupMembers')
      .mockResolvedValueOnce({ group_id: 'group-1', members: ['npub-a'], admins: [] })
      .mockResolvedValueOnce({ group_id: 'group-1', members: ['npub-a', 'npub-b'], admins: [] });
    await ensureMlsGroupMembers('group-1');
    await refreshMlsGroupMembers('group-1');
    expect(nostrApi.syncMlsGroupsNow).toHaveBeenCalledWith('group-1');
    expect(get(membersByGroupId)['group-1']).toEqual(['npub-a', 'npub-b']);
  });

  it('skips virtual hub ids', async () => {
    const spy = vi.spyOn(nostrApi, 'getMlsGroupMembers');
    await ensureMlsGroupMembers('__join_requests__');
    await ensureMlsGroupMembers('__dashboard__');
    expect(spy).not.toHaveBeenCalled();
  });
});
