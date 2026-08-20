// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import type * as SquadBotModule from '../../../lib/squad/squad-bot';

vi.mock('../../../lib/squad/squad-bot', async (importOriginal) => {
  const actual = await importOriginal<typeof SquadBotModule>();
  return {
    ...actual,
    getSquadBotState: vi.fn(),
    ensureSquadBot: vi.fn(),
  };
});

import SquadBotHoldersSection from './SquadBotHoldersSection.svelte';
import { getSquadBotState, ensureSquadBot, type SquadBotState } from '../../../lib/squad/squad-bot';
import { profiles } from '../../../stores/profiles';
import { currentUser } from '../../../stores/auth';

function botState(overrides: Partial<SquadBotState> = {}): SquadBotState {
  return {
    squadId: 'group-1',
    botNpub: 'npub1botxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    holders: [],
    keyEpoch: 1,
    updatedAt: Date.now(),
    hasLocalSecret: false,
    iAmHolder: false,
    ...overrides,
  };
}

describe('SquadBotHoldersSection', () => {
  beforeEach(() => {
    profiles.set({});
    currentUser.set(null);
    vi.mocked(getSquadBotState).mockReset();
    vi.mocked(ensureSquadBot).mockReset();
    vi.mocked(getSquadBotState).mockResolvedValue(botState());
    vi.mocked(ensureSquadBot).mockResolvedValue(botState());
  });

  afterEach(() => {
    cleanup();
  });

  it('does not refetch bot-holder state when the same squad is re-rendered (no duplicate network activity across tab cycles)', async () => {
    const { rerender } = render(SquadBotHoldersSection, {
      props: {
        announcementsGroupId: 'group-1',
        channelMembers: ['npub1alice'],
        squadAdminActive: false,
        executorRolesLabel: '',
      },
    });

    await vi.waitFor(() => {
      expect(getSquadBotState).toHaveBeenCalled();
    });
    const callsAfterMount = vi.mocked(getSquadBotState).mock.calls.length;

    // Simulate cycling back to this tab: parent re-renders with the identical squad id.
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

    expect(vi.mocked(getSquadBotState).mock.calls.length).toBe(callsAfterMount);
  });

  it('reloads bot-holder state when the squad id actually changes', async () => {
    const { rerender } = render(SquadBotHoldersSection, {
      props: {
        announcementsGroupId: 'group-1',
        channelMembers: [],
        squadAdminActive: false,
        executorRolesLabel: '',
      },
    });

    await vi.waitFor(() => {
      expect(getSquadBotState).toHaveBeenCalled();
    });
    const callsForFirstSquad = vi.mocked(getSquadBotState).mock.calls.length;

    await rerender({
      announcementsGroupId: 'group-2',
      channelMembers: [],
      squadAdminActive: false,
      executorRolesLabel: '',
    });

    await vi.waitFor(() => {
      expect(vi.mocked(getSquadBotState).mock.calls.length).toBeGreaterThan(callsForFirstSquad);
    });
    expect(vi.mocked(getSquadBotState)).toHaveBeenLastCalledWith('group-2');
  });
});
