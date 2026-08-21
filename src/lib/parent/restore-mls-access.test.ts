import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/nostr', () => ({
  inviteMemberToGroup: vi.fn(),
}));

vi.mock('../../stores/mls-chat', () => ({
  bumpMembershipVersion: vi.fn(),
}));

vi.mock('../../stores/mls-group-members', () => ({
  refreshMlsGroupMembers: vi.fn().mockResolvedValue([]),
}));

vi.mock('../utils/tauri-errors', () => ({
  getInvokeErrorMessage: (e: unknown, fallback: string) =>
    e instanceof Error ? e.message : fallback,
  friendlyMessage: (m: string) => m,
}));

import { inviteMemberToGroup } from '../api/nostr';
import { bumpMembershipVersion } from '../../stores/mls-chat';
import { restoreMlsMemberAccess } from './restore-mls-access';

describe('restoreMlsMemberAccess', () => {
  beforeEach(() => {
    vi.mocked(inviteMemberToGroup).mockReset().mockResolvedValue(undefined);
    vi.mocked(bumpMembershipVersion).mockReset();
  });

  it('invites an existing member so the backend can Restore', async () => {
    const result = await restoreMlsMemberAccess('group-1', 'npub-bob');
    expect(result).toEqual({ ok: true });
    expect(inviteMemberToGroup).toHaveBeenCalledWith('group-1', 'npub-bob', false);
    expect(bumpMembershipVersion).toHaveBeenCalledWith('group-1');
  });

  it('passes isResend through for the "Resend invite" action', async () => {
    await restoreMlsMemberAccess('group-1', 'npub-bob', true);
    expect(inviteMemberToGroup).toHaveBeenCalledWith('group-1', 'npub-bob', true);
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
