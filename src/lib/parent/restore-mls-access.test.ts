import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/nostr', () => ({
  inviteMemberToGroup: vi.fn(),
}));

vi.mock('../pacto-app-inbox', () => ({
  sendSquadInviteDm: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../stores/mls-chat', () => ({
  bumpMembershipVersion: vi.fn(),
}));

vi.mock('../../stores/mls-group-members', () => ({
  refreshMlsGroupMembers: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../stores/squads', () => ({
  squads: createMockWritable([] as { id: string; name: string; kind: 'squad' | 'squad-pair'; iconUrl?: string }[]),
}));

vi.mock('../../stores/auth', () => ({
  currentUser: createMockWritable<{ npub: string; pubkey: string } | null>(null),
}));

vi.mock('../utils/tauri-errors', () => ({
  getInvokeErrorMessage: (e: unknown, fallback: string) =>
    e instanceof Error ? e.message : fallback,
  friendlyMessage: (m: string) => m,
}));

import { inviteMemberToGroup } from '../api/nostr';
import { sendSquadInviteDm } from '../pacto-app-inbox';
import { bumpMembershipVersion } from '../../stores/mls-chat';
import { squads } from '../../stores/squads';
import { currentUser } from '../../stores/auth';
import { restoreMlsMemberAccess } from './restore-mls-access';

function createMockWritable<T>(initial: T) {
  let value = initial;
  const subscribers = new Set<(v: T) => void>();
  return {
    set: (v: T) => {
      value = v;
      subscribers.forEach((fn) => fn(v));
    },
    update: (fn: (v: T) => T) => {
      value = fn(value);
      subscribers.forEach((sub) => sub(value));
    },
    subscribe: (fn: (v: T) => void) => {
      fn(value);
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}

describe('restoreMlsMemberAccess', () => {
  beforeEach(() => {
    vi.mocked(inviteMemberToGroup).mockReset().mockResolvedValue(undefined);
    vi.mocked(bumpMembershipVersion).mockReset();
    vi.mocked(sendSquadInviteDm).mockReset().mockResolvedValue(true);
    squads.set([]);
    currentUser.set(null);
  });

  it('invites an existing member so the backend can Restore', async () => {
    const result = await restoreMlsMemberAccess('group-1', 'npub-bob');
    expect(result).toEqual({ ok: true });
    expect(inviteMemberToGroup).toHaveBeenCalledWith('group-1', 'npub-bob', false);
    expect(bumpMembershipVersion).toHaveBeenCalledWith('group-1');
    expect(sendSquadInviteDm).not.toHaveBeenCalled();
  });

  it('passes isResend through for the "Resend invite" action', async () => {
    await restoreMlsMemberAccess('group-1', 'npub-bob', true);
    expect(inviteMemberToGroup).toHaveBeenCalledWith('group-1', 'npub-bob', true);
  });

  it('sends a squad_invite DM after a successful announcements-group resend', async () => {
    squads.set([
      {
        id: 'group-1',
        name: 'Alpha',
        kind: 'squad-pair',
        iconUrl: 'https://example.com/icon.png',
        channels: [],
        createdAt: 0,
        updatedAt: 0,
      },
    ]);
    currentUser.set({ npub: 'npub-admin', pubkey: 'hex-admin' });

    const result = await restoreMlsMemberAccess('group-1', 'npub-bob', true);
    expect(result).toEqual({ ok: true });
    expect(sendSquadInviteDm).toHaveBeenCalledWith(
      'npub-bob',
      {
        squadName: 'Alpha',
        groupId: 'group-1',
        kind: 'squad-pair',
        pairedSquads: undefined,
        iconUrl: 'https://example.com/icon.png',
      },
      'npub-admin',
    );
  });

  it('does not send a squad_invite DM when the group is not an announcements squad', async () => {
    squads.set([{ id: 'announcements-id', name: 'Alpha', kind: 'squad', channels: [], createdAt: 0, updatedAt: 0 }]);
    await restoreMlsMemberAccess('channel-group', 'npub-bob', true);
    expect(sendSquadInviteDm).not.toHaveBeenCalled();
  });

  it('still succeeds if the post-resend squad invite DM fails', async () => {
    squads.set([{ id: 'group-1', name: 'Alpha', kind: 'squad', channels: [], createdAt: 0, updatedAt: 0 }]);
    vi.mocked(sendSquadInviteDm).mockRejectedValueOnce(new Error('relay down'));
    await expect(restoreMlsMemberAccess('group-1', 'npub-bob', true)).resolves.toEqual({ ok: true });
  });

  it('rejects blank ids without calling the backend', async () => {
    await expect(restoreMlsMemberAccess('  ', 'npub-bob')).resolves.toMatchObject({ ok: false });
    expect(inviteMemberToGroup).not.toHaveBeenCalled();
  });

  it('surfaces invite failures', async () => {
    vi.mocked(inviteMemberToGroup).mockRejectedValueOnce(new Error('not an admin'));
    const result = await restoreMlsMemberAccess('group-1', 'npub-bob');
    expect(result).toEqual({ ok: false, error: 'not an admin' });
  });
});
