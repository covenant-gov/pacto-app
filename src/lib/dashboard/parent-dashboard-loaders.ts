import { invoke } from '@tauri-apps/api/core';
import { getMlsGroupMembers } from '../api/nostr';
import type { HatTreeNodeDto, TreasuryProposalDto } from '../governance/api';
import {
  getHatsTree,
  getMemberHatWearers,
  getNavePirataDeployment,
  getSquadAdminExecutorRoles,
  listTreasuryProposals,
  treasuryProposalHasVoted,
} from '../governance/api';
import {
  formatSquadAdminExecutorRoles,
  hatChecksFromNaveDeployment,
} from '../governance/pacto-gov-payload';
import { isTreasuryProposalActive } from '../governance/treasury-proposal-ui';
import { getInvokeErrorMessage } from '../utils/tauri-errors';
import { listSquadMemberEvmInvokeArgs } from '../squad/squad-member-evm-share';
import { withReadPlaneLimit } from '../evm/read-plane-limiter';

import { parseSupportedChainId, type SupportedChainId } from '../wallet/chains';

type SquadMemberEvmRow = { memberNpub: string; evmAddress: string; updatedAtMs: number };

export async function fetchSquadMemberEvmByNpub(
  parentId: string | undefined,
  announcementsGroupId: string | null,
): Promise<Record<string, string>> {
  if (!parentId && !announcementsGroupId) return {};
  try {
    const q = listSquadMemberEvmInvokeArgs(parentId ?? '', announcementsGroupId);
    if (!q.parentId) return {};
    const rows = await invoke<SquadMemberEvmRow[]>('list_squad_member_evm', q);
    const m: Record<string, string> = {};
    for (const r of rows) m[r.memberNpub] = r.evmAddress;
    return m;
  } catch {
    return {};
  }
}

export async function fetchDashboardChannelMembers(groupId: string | null): Promise<string[]> {
  if (!groupId) return [];
  try {
    const result = await getMlsGroupMembers(groupId);
    return (result.members ?? []) as string[];
  } catch {
    return [];
  }
}

export async function fetchTreasuryProposalVoteMap(params: {
  network: SupportedChainId;
  treasuryAuthority: string;
  proposals: TreasuryProposalDto[];
  voterAddress: string;
}): Promise<Record<string, boolean>> {
  const active = params.proposals.filter((p) => isTreasuryProposalActive(p.status));
  if (active.length === 0) return {};
  const pairs = await Promise.all(
    active.map((p) =>
      withReadPlaneLimit(async () => {
        const voted = await treasuryProposalHasVoted({
          network: params.network,
          treasuryAuthority: params.treasuryAuthority,
          proposalId: p.proposalId,
          voter: params.voterAddress,
        });
        return [p.proposalId, voted] as const;
      }),
    ),
  );
  const map: Record<string, boolean> = {};
  for (const [id, voted] of pairs) map[id] = voted;
  return map;
}

export async function fetchTreasuryProposals(params: {
  network: SupportedChainId;
  treasuryAuthority: string;
}): Promise<{ proposals: TreasuryProposalDto[]; error: string }> {
  try {
    const rows = await listTreasuryProposals({
      network: params.network,
      treasuryAuthority: params.treasuryAuthority,
    });
    return {
      proposals: [...rows].sort((a, b) => Number(b.proposalId) - Number(a.proposalId)),
      error: '',
    };
  } catch (e) {
    return {
      proposals: [],
      error: getInvokeErrorMessage(e, 'Could not load treasury proposals.'),
    };
  }
}

export async function fetchHatsTree(params: {
  network: SupportedChainId;
  topHatId: string;
}): Promise<{ tree: HatTreeNodeDto | null; error: string }> {
  try {
    const tree = await getHatsTree({ network: params.network, topHatId: params.topHatId });
    return { tree, error: '' };
  } catch (e) {
    return {
      tree: null,
      error: getInvokeErrorMessage(e, 'Could not load Hats tree.'),
    };
  }
}

export async function fetchSettingsChainMemberMaps(params: {
  network: SupportedChainId;
  topHatId: string | null;
  squadAdminProxy: string | null;
  squadAdminChain: string | null;
  squadMemberEvmByNpub: Record<string, string>;
}): Promise<{
  memberHatByAddress: Record<string, string>;
  memberRolesByAddress: Record<string, string>;
  error: string;
}> {
  const evmAddresses = Object.values(params.squadMemberEvmByNpub).filter(Boolean);
  if (evmAddresses.length === 0) {
    return { memberHatByAddress: {}, memberRolesByAddress: {}, error: '' };
  }

  try {
    let memberHatByAddress: Record<string, string> = {};
    let memberRolesByAddress: Record<string, string> = {};

    if (params.topHatId) {
      const deployment = await getNavePirataDeployment({
        network: params.network,
        topHatId: params.topHatId,
      });
      const assignments = await getMemberHatWearers({
        network: params.network,
        memberAddresses: evmAddresses,
        hatChecks: hatChecksFromNaveDeployment(deployment),
      });
      const hatMap: Record<string, string> = {};
      for (const row of assignments) {
        if (row.hats.length > 0) {
          hatMap[row.address.toLowerCase()] = row.hats.map((h) => h.label).join(', ');
        }
      }
      memberHatByAddress = hatMap;
    }

    if (params.squadAdminProxy) {
      const roleNetwork = parseSupportedChainId(params.squadAdminChain?.trim() || params.network);
      const roleRows = await Promise.all(
        evmAddresses.map((addr) =>
          withReadPlaneLimit(async () => {
            const roles = await getSquadAdminExecutorRoles({
              network: roleNetwork,
              squadAdminProxy: params.squadAdminProxy!,
              executorAddress: addr,
            });
            return {
              address: addr.toLowerCase(),
              label: formatSquadAdminExecutorRoles(roles),
            };
          }),
        ),
      );
      const roleMap: Record<string, string> = {};
      for (const row of roleRows) {
        if (row.label && row.label !== '—') {
          roleMap[row.address] = row.label;
        }
      }
      memberRolesByAddress = roleMap;
    }

    return { memberHatByAddress, memberRolesByAddress, error: '' };
  } catch (e) {
    return {
      memberHatByAddress: {},
      memberRolesByAddress: {},
      error: getInvokeErrorMessage(e, 'Could not load on-chain Hats or Roles for members.'),
    };
  }
}
