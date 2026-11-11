import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('./squad-outbound-invite', () => ({
  publishInviteDeclinedClaims: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../stores/toast', () => ({
  showToast: vi.fn(),
}));

vi.mock('../invites/pending-welcomes-store', () => ({
  declineWelcomeForGroup: vi.fn(),
}));

vi.mock('../../stores/catch-up', () => ({
  resolveOneCatchUpEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../stores/auth-session', async () => {
  const { writable } = await import('svelte/store');
  return { currentUser: writable({ npub: 'npub1invitee' }) };
});

import { declineWelcomeForGroup } from '../invites/pending-welcomes-store';
import { resolveOneCatchUpEntry } from '../../stores/catch-up';
import { currentUser } from '../../stores/auth-session';
import { declinedSquadInviteIds } from '../../stores/invite-decisions';
import { showToast } from '../../stores/toast';
import { publishInviteDeclinedClaims } from './squad-outbound-invite';
import { declineConsentFirstSquadInvite } from './decline-squad-invite';
import type { DmMessage } from '../../stores/dm';

function msg(overrides: Partial<DmMessage> = {}): DmMessage {
  return {
    id: 'dm-1',
    content: JSON.stringify({
      type: 'squad_invite',
      squadName: 'Alpha',
      groupId: 'g-ann',
      inviteId: 'inv-1',
      admitterNpubs: ['npub1admitter'],
      invitedByNpub: 'npub1inviter',
    }),
    at: 1,
    mine: false,
    npub: 'npub1peer',
    pending: false,
    failed: false,
    ...overrides,
  };
}

describe('declineConsentFirstSquadInvite', () => {
  beforeEach(() => {
    declinedSquadInviteIds.set([]);
    currentUser.set({ npub: 'npub1invitee' } as never);
    vi.mocked(publishInviteDeclinedClaims).mockClear().mockResolvedValue(true);
    vi.mocked(declineWelcomeForGroup).mockClear();
    vi.mocked(resolveOneCatchUpEntry).mockClear();
    vi.mocked(showToast).mockClear();
  });

  it('records local decline and DMs admitters', async () => {
    await declineConsentFirstSquadInvite(msg());
    expect(get(declinedSquadInviteIds)).toEqual(['dm-1']);
    expect(declineWelcomeForGroup).toHaveBeenCalledWith('g-ann');
    expect(publishInviteDeclinedClaims).toHaveBeenCalledWith({
      parentId: 'g-ann',
      inviteId: 'inv-1',
      inviteeNpub: 'npub1invitee',
      squadName: 'Alpha',
      admitterNpubs: ['npub1admitter', 'npub1inviter'],
    });
    expect(resolveOneCatchUpEntry).toHaveBeenCalledWith('dm-1');
  });

  it('records local decline only after a claim is delivered', async () => {
    let release: (ok: boolean) => void = () => {};
    vi.mocked(publishInviteDeclinedClaims).mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
    );
    const pending = declineConsentFirstSquadInvite(msg());
    expect(get(declinedSquadInviteIds)).toEqual([]);
    expect(resolveOneCatchUpEntry).not.toHaveBeenCalled();
    release(true);
    await pending;
    expect(get(declinedSquadInviteIds)).toEqual(['dm-1']);
    expect(resolveOneCatchUpEntry).toHaveBeenCalledWith('dm-1');
  });

  it('leaves the card pending when no claim is delivered', async () => {
    vi.mocked(publishInviteDeclinedClaims).mockResolvedValueOnce(false);
    await declineConsentFirstSquadInvite(msg());
    expect(get(declinedSquadInviteIds)).toEqual([]);
    expect(resolveOneCatchUpEntry).not.toHaveBeenCalled();
    expect(declineWelcomeForGroup).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'Could not decline the invite. Try again.',
      undefined,
      undefined,
      { error: true },
    );
  });

  it('ignores a second decline while the first claim is in flight', async () => {
    let release: (ok: boolean) => void = () => {};
    vi.mocked(publishInviteDeclinedClaims).mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
    );
    const first = declineConsentFirstSquadInvite(msg());
    await declineConsentFirstSquadInvite(msg());
    expect(publishInviteDeclinedClaims).toHaveBeenCalledTimes(1);
    release(true);
    await first;
    expect(get(declinedSquadInviteIds)).toEqual(['dm-1']);
  });

  it('skips claims when inviteId is missing', async () => {
    await declineConsentFirstSquadInvite(
      msg({
        content: JSON.stringify({
          type: 'squad_invite',
          squadName: 'Alpha',
          groupId: 'g-ann',
          admitterNpubs: ['npub1admitter'],
        }),
      }),
    );
    expect(publishInviteDeclinedClaims).not.toHaveBeenCalled();
    expect(declineWelcomeForGroup).toHaveBeenCalledWith('g-ann');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('still records local decline for non-invite content', async () => {
    await declineConsentFirstSquadInvite(msg({ content: 'plain' }));
    expect(get(declinedSquadInviteIds)).toEqual(['dm-1']);
    expect(publishInviteDeclinedClaims).not.toHaveBeenCalled();
    expect(declineWelcomeForGroup).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });
});
