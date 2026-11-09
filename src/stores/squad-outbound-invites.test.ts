import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/squad/squad-outbound-invite', () => ({
  loadPendingOutboundInvitesFromMls: vi.fn(),
}));

vi.mock('svelte-i18n', () => ({
  t: {
    subscribe: (fn: (v: (k: string) => string) => void) => {
      fn((k: string) => k);
      return () => {};
    },
  },
}));

vi.mock('../lib/utils/tauri-errors', () => ({
  getInvokeErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

import { get } from 'svelte/store';
import { loadPendingOutboundInvitesFromMls } from '../lib/squad/squad-outbound-invite';
import {
  ensureOutboundInvitesHydrated,
  outboundInvitesErrorBySquadId,
  pendingOutboundInvitesBySquadId,
  removePendingOutboundInvite,
  resetSquadOutboundInviteStores,
  syncOutboundInvitesForSquad,
} from './squad-outbound-invites';

describe('squad-outbound-invites store', () => {
  beforeEach(() => {
    resetSquadOutboundInviteStores();
    vi.mocked(loadPendingOutboundInvitesFromMls).mockReset();
  });

  it('ensureOutboundInvitesHydrated fetches once per squad', async () => {
    vi.mocked(loadPendingOutboundInvitesFromMls).mockResolvedValue([
      {
        parentId: 'squad1',
        inviteId: 'inv-1',
        inviteeNpub: 'npub-bob',
        squadName: 'Alpha',
        createdAt: 1,
      },
    ]);
    await ensureOutboundInvitesHydrated('squad1');
    await ensureOutboundInvitesHydrated('squad1');
    expect(loadPendingOutboundInvitesFromMls).toHaveBeenCalledTimes(1);
    expect(get(pendingOutboundInvitesBySquadId).squad1).toHaveLength(1);
  });

  it('ensureOutboundInvitesHydrated surfaces load errors', async () => {
    vi.mocked(loadPendingOutboundInvitesFromMls).mockRejectedValue(new Error('boom'));
    await ensureOutboundInvitesHydrated('squad2');
    expect(get(outboundInvitesErrorBySquadId).squad2).toBe('squad.pendingAccess.loadInvitesFailed');
    expect(get(pendingOutboundInvitesBySquadId).squad2).toEqual([]);
  });

  it('syncOutboundInvitesForSquad reloads and removePendingOutboundInvite drops a row', async () => {
    vi.mocked(loadPendingOutboundInvitesFromMls).mockResolvedValue([
      {
        parentId: 'squad3',
        inviteId: 'inv-a',
        inviteeNpub: 'npub-a',
        squadName: 'Alpha',
        createdAt: 1,
      },
      {
        parentId: 'squad3',
        inviteId: 'inv-b',
        inviteeNpub: 'npub-b',
        squadName: 'Alpha',
        createdAt: 2,
      },
    ]);
    await syncOutboundInvitesForSquad('squad3');
    expect(get(pendingOutboundInvitesBySquadId).squad3).toHaveLength(2);
    removePendingOutboundInvite('squad3', 'inv-a');
    expect(get(pendingOutboundInvitesBySquadId).squad3.map((r) => r.inviteId)).toEqual(['inv-b']);
  });
});
