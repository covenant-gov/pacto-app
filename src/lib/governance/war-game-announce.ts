import { sendDmMessage } from '../api/nostr';
import {
  ANNOUNCE_TYPE_WAR_GAME_UPDATED,
  buildAnnounceContent,
  type WarGameUpdatedAction,
  type WarGameUpdatedPayload,
} from '../announcements';
import { getAnnouncementsChannel } from '../parent-navbar';
import { squads } from '../../stores/squads';
import { get } from 'svelte/store';
import type { WarGameDeployResultDto } from './api';
import { pactoGovWargameInfraId } from './squad-infra-row-id';

export function warGameActionFromProviderPayload(
  providerPayload: string | undefined | null,
): WarGameUpdatedAction {
  if (!providerPayload?.trim()) return 'deploy';
  try {
    const p = JSON.parse(providerPayload) as Record<string, unknown>;
    const status = typeof p.status === 'string' ? p.status.trim().toLowerCase() : '';
    if (status === 'retired') return 'retire';
    const retired = typeof p.retiredSponsor === 'string' ? p.retiredSponsor.trim() : '';
    if (retired) return 'redeploy';
    return 'deploy';
  } catch {
    return 'deploy';
  }
}

export function warGameActionFromDeploy(result: {
  retiredSponsor?: string | null;
}): WarGameUpdatedAction {
  return result.retiredSponsor?.trim() ? 'redeploy' : 'deploy';
}

export function buildWarGameUpdatedPayload(params: {
  parentId: string;
  action: WarGameUpdatedAction;
  topHatId: string;
  chain: string;
  providerPayload: string;
  round: string;
  gameSquadId: string;
  sponsor: string;
  retiredSponsor?: string | null;
  entryId?: string;
}): WarGameUpdatedPayload {
  const retired = params.retiredSponsor?.trim() || '';
  return {
    parent_id: params.parentId.trim(),
    action: params.action,
    canonical_ref: params.topHatId.trim(),
    chain: params.chain.trim() || 'sepolia',
    entry_id: params.entryId?.trim() || pactoGovWargameInfraId(params.parentId),
    round: params.round.trim(),
    game_squad_id: params.gameSquadId.trim(),
    sponsor: params.sponsor.trim(),
    ...(retired ? { retired_sponsor: retired } : {}),
    provider_payload: params.providerPayload,
  };
}

export async function announceWarGameUpdated(params: {
  parentId: string;
  announcementsGroupId?: string | null;
  result: WarGameDeployResultDto;
}): Promise<void> {
  const parentId = params.parentId.trim();
  if (!parentId) return;
  let gid = params.announcementsGroupId?.trim() || '';
  if (!gid) {
    const row = get(squads).find((s) => s.id === parentId);
    gid = row ? getAnnouncementsChannel(row)?.groupId?.trim() || '' : '';
  }
  if (!gid) return;
  try {
    await sendDmMessage(
      gid,
      buildAnnounceContent({
        type: ANNOUNCE_TYPE_WAR_GAME_UPDATED,
        payload: buildWarGameUpdatedPayload({
          parentId,
          action: warGameActionFromDeploy(params.result),
          topHatId: params.result.topHatId,
          chain: params.result.chain,
          providerPayload: params.result.providerPayload,
          round: params.result.round,
          gameSquadId: params.result.gameSquadId,
          sponsor: params.result.sponsorAddress,
          retiredSponsor: params.result.retiredSponsor,
          entryId: params.result.infraRowId,
        }),
      }),
      '',
      { virtualBucket: 'announcements' },
    );
  } catch {
    // Chain remains canonical; announce is best-effort for other members.
  }
}
