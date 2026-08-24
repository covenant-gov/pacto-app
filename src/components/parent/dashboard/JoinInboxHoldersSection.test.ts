// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import type * as JoinInboxModule from '../../../lib/squad/join-inbox';

vi.mock('../../../lib/squad/join-inbox', async (importOriginal) => {
  const actual = await importOriginal<typeof JoinInboxModule>();
  return {
    ...actual,
    getJoinInboxState: vi.fn(),
    initJoinInbox: vi.fn(),
    reclaimJoinInboxIfSplit: vi.fn(),
  };
});

vi.mock('../../../lib/squad/squad-state-sync', () => ({
  requestSquadStateSync: vi.fn().mockResolvedValue(true),
}));

import JoinInboxHoldersSection from './JoinInboxHoldersSection.svelte';
import {
  getJoinInboxState,
  initJoinInbox,
  reclaimJoinInboxIfSplit,
  type JoinInboxState,
} from '../../../lib/squad/join-inbox';
import { profiles } from '../../../stores/profiles';
import { currentUser } from '../../../stores/auth';

function inboxState(overrides: Partial<JoinInboxState> = {}): JoinInboxState {
  return {
    squadId: 'group-1',
    inboxNpub: 'npub1inboxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    holders: [],
    keyEpoch: 1,
    updatedAt: Date.now(),
    hasLocalSecret: false,
    iAmHolder: false,
    ...overrides,
  };
}

describe('JoinInboxHoldersSection', () => {
  beforeEach(() => {
    profiles.set({});
    currentUser.set(null);
    vi.mocked(getJoinInboxState).mockReset();
    vi.mocked(initJoinInbox).mockReset();
    vi.mocked(reclaimJoinInboxIfSplit).mockReset();
    vi.mocked(reclaimJoinInboxIfSplit).mockResolvedValue(inboxState());
    vi.mocked(getJoinInboxState).mockResolvedValue(inboxState());
    vi.mocked(initJoinInbox).mockResolvedValue(inboxState());
  });

  afterEach(() => {
    cleanup();
  });

  it('does not mint when state is missing', async () => {
    vi.mocked(reclaimJoinInboxIfSplit).mockResolvedValue(null);
    vi.mocked(getJoinInboxState).mockResolvedValue(null);
    render(JoinInboxHoldersSection, {
      props: {
        announcementsGroupId: 'group-1',
        channelMembers: ['npub1alice'],
        squadAdminActive: false,
        executorRolesLabel: '',
      },
    });
    await vi.waitFor(() => {
      expect(reclaimJoinInboxIfSplit).toHaveBeenCalledWith('group-1');
    });
    expect(initJoinInbox).not.toHaveBeenCalled();
  });

  it('does not refetch when the same squad is re-rendered', async () => {
    const { rerender } = render(JoinInboxHoldersSection, {
      props: {
        announcementsGroupId: 'group-1',
        channelMembers: ['npub1alice'],
        squadAdminActive: false,
        executorRolesLabel: '',
      },
    });

    await vi.waitFor(() => {
      expect(reclaimJoinInboxIfSplit).toHaveBeenCalled();
    });
    const callsAfterMount = vi.mocked(reclaimJoinInboxIfSplit).mock.calls.length;

    await rerender({
      announcementsGroupId: 'group-1',
      channelMembers: ['npub1alice'],
      squadAdminActive: false,
      executorRolesLabel: '',
    });
    await rerender({
      announcementsGroupId: 'group-1',
      channelMembers: ['npub1alice'],
      squadAdminActive: false,
      executorRolesLabel: '',
    });

    expect(vi.mocked(reclaimJoinInboxIfSplit).mock.calls.length).toBe(callsAfterMount);
  });

  it('reloads when the squad id actually changes', async () => {
    const { rerender } = render(JoinInboxHoldersSection, {
      props: {
        announcementsGroupId: 'group-1',
        channelMembers: [],
        squadAdminActive: false,
        executorRolesLabel: '',
      },
    });

    await vi.waitFor(() => {
      expect(reclaimJoinInboxIfSplit).toHaveBeenCalled();
    });
    const callsForFirstSquad = vi.mocked(reclaimJoinInboxIfSplit).mock.calls.length;

    await rerender({
      announcementsGroupId: 'group-2',
      channelMembers: [],
      squadAdminActive: false,
      executorRolesLabel: '',
    });

    await vi.waitFor(() => {
      expect(vi.mocked(reclaimJoinInboxIfSplit).mock.calls.length).toBeGreaterThan(callsForFirstSquad);
    });
    expect(vi.mocked(reclaimJoinInboxIfSplit)).toHaveBeenLastCalledWith('group-2');
  });
});
