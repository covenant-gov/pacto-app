import { get, writable } from 'svelte/store';
import { t } from 'svelte-i18n';
import { recordActionNeededEntry } from '../lib/api/catch-up';
import {
  fetchQuartermasterPendingActions,
  fetchTreasuryProposalVoteMap,
  fetchTreasuryProposals,
} from '../lib/dashboard/parent-dashboard-loaders';
import {
  deriveGovActionPrompts,
  type GovActionPrompt,
} from '../lib/governance/gov-action-prompts';
import {
  getMutinyStatus,
  getSquadCapabilities,
  mutinyHasVoted,
  pactoGovInfraRow,
} from '../lib/governance/api';
import { resolveGovernancePrivilege } from '../lib/governance/governance-privilege';
import { isMutinyActive } from '../lib/governance/gov-proposal-lists';
import { parsePactoGovProviderPayload } from '../lib/governance/pacto-gov-payload';
import { openSquadDashboard } from '../lib/navigation/open-squad-dashboard';
import { parseSupportedChainId } from '../lib/wallet/chains';
import { announcementsGroupIdForSquad } from './squad-hub-alerts';
import { hydrateCatchUpCount, resolveOneCatchUpEntry } from './catch-up';
import { squadDashboardChannelMode } from './navigation';
import { squadInfraByParentId, type Squad } from './squads';
import { showToast, type ToastGoTo } from './toast';
import { SQUAD_DASHBOARD_CHANNEL_ID } from '../lib/squad/hub-channel-names';

/** Derived gov prompts keyed by squad id (for Alerts tab). */
export const govActionPromptsBySquadId = writable<Record<string, GovActionPrompt[]>>({});

const refreshGenBySquadId = new Map<string, number>();
const recordedIdsBySquadId = new Map<string, Set<string>>();
const toastedSourceEventIds = new Set<string>();

export function resetGovActionPromptStores(): void {
  govActionPromptsBySquadId.set({});
  refreshGenBySquadId.clear();
  recordedIdsBySquadId.clear();
  toastedSourceEventIds.clear();
}

function toastGoTo(squad: Squad): ToastGoTo {
  return {
    type: 'squad',
    name: squad.name,
    id: squad.id,
    channelId: SQUAD_DASHBOARD_CHANNEL_ID,
  };
}

function maybeToastNewPrompts(squad: Squad, prompts: GovActionPrompt[]): void {
  const tFn = get(t);
  for (const p of prompts) {
    if (p.kind !== 'vote_needed' && p.kind !== 'execute_ready') continue;
    if (toastedSourceEventIds.has(p.sourceEventId)) continue;
    toastedSourceEventIds.add(p.sourceEventId);
    const text = tFn(p.bodyKey, { values: p.bodyValues ?? {} });
    showToast(text, toastGoTo(squad));
  }
}

async function reconcileCatchUp(
  groupId: string,
  squadId: string,
  prompts: GovActionPrompt[],
): Promise<void> {
  const nextIds = new Set(prompts.map((p) => p.sourceEventId));
  const prev = recordedIdsBySquadId.get(squadId) ?? new Set<string>();

  for (const id of nextIds) {
    try {
      await recordActionNeededEntry(groupId, id);
    } catch {
      // best-effort
    }
  }
  for (const id of prev) {
    if (nextIds.has(id)) continue;
    resolveOneCatchUpEntry(id).catch(() => {});
  }
  recordedIdsBySquadId.set(squadId, nextIds);
  if (nextIds.size > 0 || prev.size > 0) {
    void hydrateCatchUpCount();
  }
}

/** Load gov state, derive prompts, reconcile catch-up, edge-toast vote/execute. */
export async function refreshGovActionPromptsForSquad(squad: Squad): Promise<void> {
  const id = squad.id.trim();
  if (!id) return;

  const gen = (refreshGenBySquadId.get(id) ?? 0) + 1;
  refreshGenBySquadId.set(id, gen);

  const rows = get(squadInfraByParentId)[id] ?? [];
  const govRow = pactoGovInfraRow(rows);
  const payload = parsePactoGovProviderPayload(govRow?.providerPayload);
  const treasuryAuthority = payload?.treasuryAuthority?.trim() ?? '';
  const quartermaster = payload?.quartermaster?.trim() ?? '';
  const mutinyModule = payload?.mutinyModule?.trim() ?? '';

  if (!govRow || !treasuryAuthority) {
    if (refreshGenBySquadId.get(id) !== gen) return;
    govActionPromptsBySquadId.update((m) => ({ ...m, [id]: [] }));
    const groupId = announcementsGroupIdForSquad(squad);
    if (groupId) {
      await reconcileCatchUp(groupId, id, []);
    }
    return;
  }

  const network = parseSupportedChainId(govRow.chain);
  const groupId = announcementsGroupIdForSquad(squad);

  try {
    const capabilities = await getSquadCapabilities(id, network);
    if (refreshGenBySquadId.get(id) !== gen) return;

    const privilege = resolveGovernancePrivilege({
      myAddress: capabilities.rosterAddress,
      safeAddress: payload?.safe,
      captainWearers: null,
      crewWearers: null,
      capabilities,
    });

    const [{ proposals }, mutinyStatus] = await Promise.all([
      fetchTreasuryProposals({
        network,
        treasuryAuthority,
        parentId: id,
      }),
      mutinyModule
        ? getMutinyStatus({ network, mutinyModule, parentId: id }).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (refreshGenBySquadId.get(id) !== gen) return;

    const qmPending =
      quartermaster.trim().length > 0
        ? (
            await fetchQuartermasterPendingActions({
              network,
              quartermaster,
              parentId: id,
            })
          ).pending
        : [];
    if (refreshGenBySquadId.get(id) !== gen) return;

    const voter = privilege.myAddress?.trim() ?? '';
    const treasuryVoteMap =
      voter.length > 0
        ? await fetchTreasuryProposalVoteMap({
            network,
            treasuryAuthority,
            proposals,
            voterAddress: voter,
          })
        : {};
    if (refreshGenBySquadId.get(id) !== gen) return;

    let mutinyVoted = false;
    if (voter && mutinyModule && mutinyStatus && isMutinyActive(mutinyStatus)) {
      try {
        mutinyVoted = await mutinyHasVoted({
          network,
          mutinyModule,
          mutinyId: mutinyStatus.activeMutinyId,
          voter,
          parentId: id,
        });
      } catch {
        mutinyVoted = false;
      }
    }
    if (refreshGenBySquadId.get(id) !== gen) return;

    const prompts = deriveGovActionPrompts({
      parentId: id,
      proposals,
      mutinyStatus,
      qmPending,
      privilege,
      mutinyMode: isMutinyActive(mutinyStatus),
      treasuryVoteMap,
      mutinyHasVoted: mutinyVoted,
    });

    govActionPromptsBySquadId.update((m) => ({ ...m, [id]: prompts }));
    maybeToastNewPrompts(squad, prompts);

    if (groupId) {
      await reconcileCatchUp(groupId, id, prompts);
    }
  } catch {
    if (refreshGenBySquadId.get(id) !== gen) return;
    // Keep last good prompts on transient failure
  }
}

/** Open squad Governance tab from an alert card. */
export function openGovernanceFromPrompt(parentId: string): void {
  openSquadDashboard(parentId);
  squadDashboardChannelMode.set('governance');
}
