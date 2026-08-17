import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const mockRecordActionNeededEntry = vi.hoisted(() => vi.fn());
const mockResolveCatchUpEntry = vi.hoisted(() => vi.fn());
const mockGetCatchUpCount = vi.hoisted(() => vi.fn());
const mockListCatchUpEntries = vi.hoisted(() => vi.fn());
const mockGetSquadCapabilities = vi.hoisted(() => vi.fn());
const mockFetchTreasuryProposals = vi.hoisted(() => vi.fn());
const mockFetchQmPending = vi.hoisted(() => vi.fn());
const mockFetchVoteMap = vi.hoisted(() => vi.fn());
const mockGetMutinyStatus = vi.hoisted(() => vi.fn());
const mockMutinyHasVoted = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());

vi.mock('../lib/api/catch-up', () => ({
  recordActionNeededEntry: (...args: unknown[]) => mockRecordActionNeededEntry(...args),
  resolveCatchUpEntry: (...args: unknown[]) => mockResolveCatchUpEntry(...args),
  getCatchUpCount: (...args: unknown[]) => mockGetCatchUpCount(...args),
  listCatchUpEntries: (...args: unknown[]) => mockListCatchUpEntries(...args),
  resolveAllCatchUpEntries: vi.fn(),
}));

vi.mock('../lib/dashboard/parent-dashboard-loaders', () => ({
  fetchTreasuryProposals: (...args: unknown[]) => mockFetchTreasuryProposals(...args),
  fetchQuartermasterPendingActions: (...args: unknown[]) => mockFetchQmPending(...args),
  fetchTreasuryProposalVoteMap: (...args: unknown[]) => mockFetchVoteMap(...args),
}));

vi.mock('../lib/governance/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/governance/api')>('../lib/governance/api');
  return {
    ...actual,
    getSquadCapabilities: (...args: unknown[]) => mockGetSquadCapabilities(...args),
    getMutinyStatus: (...args: unknown[]) => mockGetMutinyStatus(...args),
    mutinyHasVoted: (...args: unknown[]) => mockMutinyHasVoted(...args),
  };
});

vi.mock('./toast', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

vi.mock('svelte-i18n', () => ({
  t: {
    subscribe: (fn: (v: (k: string, opts?: { values?: Record<string, unknown> }) => string) => void) => {
      fn((k, opts) => (opts?.values ? `${k}:${JSON.stringify(opts.values)}` : k));
      return () => {};
    },
  },
}));

import {
  govActionPromptsBySquadId,
  refreshGovActionPromptsForSquad,
  resetGovActionPromptStores,
} from './gov-action-prompts';
import { squadInfraByParentId, type Squad } from './squads';
import { resetCatchUpStore } from './catch-up';

describe('gov-action-prompts store', () => {
  const squad = {
    id: 'squad-1',
    name: 'Test Squad',
    channels: [{ name: 'announcements', groupId: 'grp-1', order: 0 }],
  } as Squad;

  beforeEach(() => {
    resetGovActionPromptStores();
    resetCatchUpStore();
    squadInfraByParentId.set({});
    mockRecordActionNeededEntry.mockReset().mockResolvedValue(undefined);
    mockResolveCatchUpEntry.mockReset().mockResolvedValue(true);
    mockGetCatchUpCount.mockReset().mockResolvedValue(0);
    mockListCatchUpEntries.mockReset().mockResolvedValue([]);
    mockGetSquadCapabilities.mockReset().mockResolvedValue({
      parentId: 'squad-1',
      rosterAddress: '0xabc',
      wearsCaptain: false,
      wearsCrew: true,
      captainIsSafe: false,
      squadAdminFull: false,
      squadAdminPaused: false,
      roleLabel: 'crew',
      capabilities: {},
    });
    mockFetchTreasuryProposals.mockReset().mockResolvedValue({
      proposals: [
        {
          proposalId: '3',
          proposer: '0x1',
          to: '0x2',
          valueWei: '0',
          operation: 'CALL',
          dataHex: '0x',
          deadline: 1,
          snapshot: 3,
          yeas: 1,
          nays: 0,
          captainApproved: false,
          captainDefeated: false,
          executed: false,
          status: 'active',
        },
      ],
      error: '',
    });
    mockFetchQmPending.mockReset().mockResolvedValue({ pending: [], error: '' });
    mockFetchVoteMap.mockReset().mockResolvedValue({});
    mockGetMutinyStatus.mockReset().mockResolvedValue(null);
    mockMutinyHasVoted.mockReset().mockResolvedValue(false);
    mockShowToast.mockReset();
  });

  it('clears prompts when pacto gov is not deployed', async () => {
    squadInfraByParentId.set({ 'squad-1': [] });
    await refreshGovActionPromptsForSquad(squad);
    expect(get(govActionPromptsBySquadId)['squad-1']).toEqual([]);
  });

  it('records catch-up and toasts vote-needed when derived', async () => {
    squadInfraByParentId.set({
      'squad-1': [
        {
          id: 'infra-1',
          parentId: 'squad-1',
          infraType: 'pacto_gov',
          chain: 'sepolia',
          canonicalRef: '0xta',
          providerPayload: JSON.stringify({
            treasuryAuthority: '0xta',
            quartermaster: '0xqm',
            mutinyModule: '0xmu',
            safe: '0xsafe',
          }),
          createdAtMs: 0,
          updatedAtMs: 0,
        },
      ],
    });

    await refreshGovActionPromptsForSquad(squad);

    const prompts = get(govActionPromptsBySquadId)['squad-1'] ?? [];
    expect(prompts.some((p) => p.kind === 'vote_needed')).toBe(true);
    expect(mockRecordActionNeededEntry).toHaveBeenCalledWith(
      'grp-1',
      'gov-vote:treasury:squad-1:3',
    );
    expect(mockShowToast).toHaveBeenCalled();
  });

  function setGovInfra(): void {
    squadInfraByParentId.set({
      'squad-1': [
        {
          id: 'infra-1',
          parentId: 'squad-1',
          infraType: 'pacto_gov',
          chain: 'sepolia',
          canonicalRef: '0xta',
          providerPayload: JSON.stringify({
            treasuryAuthority: '0xta',
            quartermaster: '0xqm',
            mutinyModule: '0xmu',
            safe: '0xsafe',
          }),
          createdAtMs: 0,
          updatedAtMs: 0,
        },
      ],
    });
  }

  it('keeps last-good prompts when a treasury loader returns error', async () => {
    setGovInfra();
    await refreshGovActionPromptsForSquad(squad);
    const lastGood = get(govActionPromptsBySquadId)['squad-1'] ?? [];
    expect(lastGood.some((p) => p.kind === 'vote_needed')).toBe(true);

    mockFetchTreasuryProposals.mockResolvedValueOnce({ proposals: [], error: 'rpc down' });
    mockResolveCatchUpEntry.mockClear();
    mockRecordActionNeededEntry.mockClear();

    await refreshGovActionPromptsForSquad(squad);

    expect(get(govActionPromptsBySquadId)['squad-1']).toEqual(lastGood);
    expect(mockResolveCatchUpEntry).not.toHaveBeenCalled();
    expect(mockRecordActionNeededEntry).not.toHaveBeenCalled();
  });

  it('keeps last-good prompts when quartermaster or mutiny reads fail', async () => {
    setGovInfra();
    await refreshGovActionPromptsForSquad(squad);
    const lastGood = get(govActionPromptsBySquadId)['squad-1'] ?? [];

    mockFetchQmPending.mockResolvedValueOnce({ pending: [], error: 'qm down' });
    mockResolveCatchUpEntry.mockClear();
    await refreshGovActionPromptsForSquad(squad);
    expect(get(govActionPromptsBySquadId)['squad-1']).toEqual(lastGood);
    expect(mockResolveCatchUpEntry).not.toHaveBeenCalled();

    mockFetchQmPending.mockResolvedValue({ pending: [], error: '' });
    mockGetMutinyStatus.mockRejectedValueOnce(new Error('mutiny down'));
    mockResolveCatchUpEntry.mockClear();
    await refreshGovActionPromptsForSquad(squad);
    expect(get(govActionPromptsBySquadId)['squad-1']).toEqual(lastGood);
    expect(mockResolveCatchUpEntry).not.toHaveBeenCalled();
  });

  it('resolves persisted gov- catch-up rows that are no longer derived', async () => {
    setGovInfra();
    mockListCatchUpEntries.mockResolvedValueOnce([
      {
        id: 'cu-1',
        sourceEventId: 'gov-vote:treasury:squad-1:99',
        kind: 'action_prompt',
        chatId: 'grp-1',
        createdAt: 1,
        resolvedAt: null,
      },
      {
        id: 'cu-2',
        sourceEventId: 'join-request:other',
        kind: 'action_prompt',
        chatId: 'grp-1',
        createdAt: 1,
        resolvedAt: null,
      },
    ]);

    await refreshGovActionPromptsForSquad(squad);

    expect(mockListCatchUpEntries).toHaveBeenCalledWith('action_prompt', 'squad-1');
    expect(mockResolveCatchUpEntry).toHaveBeenCalledWith('gov-vote:treasury:squad-1:99');
    expect(mockResolveCatchUpEntry).not.toHaveBeenCalledWith('join-request:other');
  });
});
