// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';

vi.mock('../../lib/invites/pending-welcomes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/invites/pending-welcomes')>();
  return {
    ...actual,
    acceptOfferedWelcome: vi.fn(() => new Promise<void>(() => {})),
  };
});

import PendingWelcomeRequests from './PendingWelcomeRequests.svelte';
import { pendingMlsWelcomes } from '../../stores/mls-chat';
import { squads } from '../../stores/squads';
import { blockedDmNpubs } from '../../stores/dm';
import { declinedWelcomeGroupIds } from '../../stores/invite-decisions';
import { pendingSquadAdmissions } from '../../stores/pending-squad-admission';
import { joiningWelcomeGroupIds } from '../../lib/invites/pending-welcomes-store';
import { resetPendingWelcomeFinalizations } from '../../stores/pending-welcome-finalization';
import type { PendingMlsWelcome } from '../../lib/api/nostr';

function welcome(overrides: Partial<PendingMlsWelcome> = {}): PendingMlsWelcome {
  return {
    id: 'welcome-1',
    wrapper_event_id: 'ev-1',
    nostr_group_id: 'group-1',
    group_name: 'Alpha',
    group_description: null,
    group_admin_pubkeys: [],
    group_relays: [],
    welcomer: 'npub1inviterabcdefghijklmnopqrstuv',
    member_count: 3,
    ...overrides,
  };
}

describe('PendingWelcomeRequests', () => {
  beforeEach(() => {
    pendingMlsWelcomes.set([welcome()]);
    squads.set([]);
    blockedDmNpubs.set(new Set());
    declinedWelcomeGroupIds.set([]);
    pendingSquadAdmissions.set([]);
    joiningWelcomeGroupIds.set([]);
    resetPendingWelcomeFinalizations();
  });

  afterEach(() => {
    cleanup();
    pendingMlsWelcomes.set([]);
    joiningWelcomeGroupIds.set([]);
    resetPendingWelcomeFinalizations();
  });

  it('shows a disabled Joining… label mid-accept without unmounting the card', async () => {
    render(PendingWelcomeRequests);
    const join = screen.getByRole('button', { name: 'Join' });
    await fireEvent.click(join);
    const joining = await screen.findByRole('button', { name: 'Joining…' });
    expect((joining as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Alpha')).toBeTruthy();
  });
});
