// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import type * as SquadJoinMls from '../../lib/squad/squad-join-mls';

// Real ensureJoinRequestsHydrated/isJoinRequestsHydrated/syncJoinRequestsForSquad run for real
// (their own hydratingSquadIds/hydratedBySquadId guards are what we're proving) — only the
// backend-facing network calls are mocked out.
vi.mock('../../lib/squad/squad-join-mls', async (importOriginal) => {
  const actual = await importOriginal<typeof SquadJoinMls>();
  return {
    ...actual,
    fanOutJoinInboxDmsToMls: vi.fn().mockResolvedValue(undefined),
    loadPendingJoinRequestsFromMls: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../stores/squad-hub-alerts', () => ({
  refreshPersonalAlertForSquad: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../stores/gov-action-prompts', () => ({
  refreshGovActionPromptsForSquad: vi.fn().mockResolvedValue(undefined),
}));

import ParentNavbar from './ParentNavbar.svelte';
import { squads, type Squad } from '../../stores/squads';
import { activeSquadId, activeTopNavTab } from '../../stores/navigation';
import { isJoinRequestsHydrated, resetSquadJoinRequestStores } from '../../stores/squad-join-requests';
import { deferredSquadRosterKeyParentIds } from '../../lib/squad/squad-roster-key-choice';
import { loadPendingJoinRequestsFromMls } from '../../lib/squad/squad-join-mls';
import { refreshPersonalAlertForSquad } from '../../stores/squad-hub-alerts';
import { refreshGovActionPromptsForSquad } from '../../stores/gov-action-prompts';

function squad(overrides: Partial<Squad> = {}): Squad {
  return {
    id: 'squad-1',
    name: 'Alpha',
    channels: [],
    kind: 'squad',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('ParentNavbar', () => {
  beforeEach(() => {
    squads.set([]);
    activeSquadId.set(null);
    activeTopNavTab.set('commons');
    deferredSquadRosterKeyParentIds.set([]);
    resetSquadJoinRequestStores();
    vi.mocked(loadPendingJoinRequestsFromMls).mockClear();
    vi.mocked(refreshPersonalAlertForSquad).mockClear();
    vi.mocked(refreshGovActionPromptsForSquad).mockClear();
  });

  afterEach(() => {
    cleanup();
    squads.set([]);
    activeSquadId.set(null);
    activeTopNavTab.set('commons');
    deferredSquadRosterKeyParentIds.set([]);
    resetSquadJoinRequestStores();
  });

  it('hydrates join requests once per squad on the squads tab, and not again on switch-away-and-back', async () => {
    squads.set([squad()]);
    activeSquadId.set('squad-1');
    activeTopNavTab.set('squads');

    render(ParentNavbar);

    // Wait for the real hydration guard to flip, not just for the call to start.
    await waitFor(() => expect(isJoinRequestsHydrated('squad-1')).toBe(true));
    expect(loadPendingJoinRequestsFromMls).toHaveBeenCalledTimes(1);
    expect(loadPendingJoinRequestsFromMls).toHaveBeenCalledWith('squad-1');

    // Switch away, then back — the guard (isJoinRequestsHydrated) must block a re-fetch.
    activeTopNavTab.set('dms');
    activeTopNavTab.set('squads');
    await tick();

    expect(loadPendingJoinRequestsFromMls).toHaveBeenCalledTimes(1);
  });

  it('does not hydrate join requests when not on the squads tab', async () => {
    squads.set([squad()]);
    activeSquadId.set('squad-1');
    activeTopNavTab.set('dms');

    render(ParentNavbar);

    await tick();
    expect(loadPendingJoinRequestsFromMls).not.toHaveBeenCalled();
  });

  it('refreshes the personal alert and gov-action prompts for the active squad on the squads tab', async () => {
    squads.set([squad()]);
    activeSquadId.set('squad-1');
    activeTopNavTab.set('squads');

    render(ParentNavbar);

    await waitFor(() => expect(refreshPersonalAlertForSquad).toHaveBeenCalled());
    expect(refreshPersonalAlertForSquad).toHaveBeenCalledWith(expect.objectContaining({ id: 'squad-1' }));
    expect(refreshGovActionPromptsForSquad).toHaveBeenCalledWith(expect.objectContaining({ id: 'squad-1' }));
  });

  it('does not refresh the personal alert when there is no active squad', async () => {
    squads.set([squad()]);
    activeSquadId.set(null);
    activeTopNavTab.set('squads');

    render(ParentNavbar);

    await tick();
    expect(refreshPersonalAlertForSquad).not.toHaveBeenCalled();
    expect(refreshGovActionPromptsForSquad).not.toHaveBeenCalled();
  });
});
