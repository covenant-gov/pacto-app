import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const resolveOneCatchUpEntryMock = vi.fn();

vi.mock('../../stores/catch-up', () => ({
  resolveOneCatchUpEntry: (...args: unknown[]) => resolveOneCatchUpEntryMock(...args),
}));

vi.mock('../squad/squad-catalog', () => ({
  persistSquadPatch: vi.fn(),
  persistSquad: vi.fn(),
}));

vi.mock('../../stores/backup-verification', () => ({
  requireBackupVerified: () => true,
}));

vi.mock('../utils/dm-debug', () => ({
  dmError: vi.fn(),
}));

vi.mock('../squad/squad-state-sync', () => ({
  maybeAutoRequestSquadStateSyncAfterJoin: vi.fn(),
}));

vi.mock('../squad/squad-outbound-invite', () => ({
  publishInviteAcceptedClaims: vi.fn().mockResolvedValue(undefined),
}));

import { declineWelcomeForGroup } from './pending-welcomes-store';
import { declinedWelcomeGroupIds } from '../../stores/invite-decisions';
import { pendingMlsWelcomes } from '../../stores/mls-chat';
import {
  pendingWelcomeFinalizations,
  resetPendingWelcomeFinalizations,
  upsertPendingWelcomeFinalization,
} from '../../stores/pending-welcome-finalization';
import { dmError } from '../utils/dm-debug';
import type { PendingMlsWelcome } from '../api/nostr';

function welcome(overrides: Partial<PendingMlsWelcome> = {}): PendingMlsWelcome {
  return {
    id: 'welcome-1',
    wrapper_event_id: 'wrap-1',
    nostr_group_id: 'group-1',
    group_name: 'Alpha',
    group_description: null,
    group_admin_pubkeys: [],
    group_relays: [],
    welcomer: 'npub1inviter',
    member_count: 3,
    ...overrides,
  };
}

describe('declineWelcomeForGroup', () => {
  beforeEach(() => {
    declinedWelcomeGroupIds.set([]);
    pendingMlsWelcomes.set([]);
    resetPendingWelcomeFinalizations();
    resolveOneCatchUpEntryMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    declinedWelcomeGroupIds.set([]);
    pendingMlsWelcomes.set([]);
    resetPendingWelcomeFinalizations();
  });

  it('records the decline even with no matching pendingMlsWelcomes entry and skips resolveOneCatchUpEntry', () => {
    declineWelcomeForGroup('group-1');
    expect(get(declinedWelcomeGroupIds)).toEqual(['group-1']);
    expect(resolveOneCatchUpEntryMock).not.toHaveBeenCalled();
  });

  it('calls resolveOneCatchUpEntry with wrapper_event_id when a match exists', () => {
    pendingMlsWelcomes.set([welcome()]);
    declineWelcomeForGroup('group-1');
    expect(resolveOneCatchUpEntryMock).toHaveBeenCalledWith('wrap-1');
  });

  it('matches pending welcomes across case and whitespace differences', () => {
    pendingMlsWelcomes.set([welcome({ nostr_group_id: 'GROUP-1' })]);
    declineWelcomeForGroup('  group-1  ');
    expect(resolveOneCatchUpEntryMock).toHaveBeenCalledWith('wrap-1');
  });

  it('does not throw when resolveOneCatchUpEntry rejects', async () => {
    pendingMlsWelcomes.set([welcome()]);
    resolveOneCatchUpEntryMock.mockRejectedValue(new Error('backend down'));
    expect(() => declineWelcomeForGroup('group-1')).not.toThrow();
    expect(get(declinedWelcomeGroupIds)).toEqual(['group-1']);
    await vi.waitFor(() => expect(resolveOneCatchUpEntryMock).toHaveBeenCalledTimes(2));
    expect(dmError).toHaveBeenCalled();
  });

  it('clears a stuck finalization record for the declined group', () => {
    upsertPendingWelcomeFinalization({
      welcomeId: 'welcome-1',
      groupId: 'group-1',
      name: 'Alpha',
      description: null,
      imageUrl: null,
      inviterNpub: 'npub1inviter',
      memberCount: 3,
      acceptedAt: 1,
    });
    declineWelcomeForGroup('group-1');
    expect(get(pendingWelcomeFinalizations)).toEqual([]);
  });
});
