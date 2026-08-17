import { get } from 'svelte/store';
import { sendDmMessage } from '../api/nostr';
import {
  ANNOUNCE_TYPE_GOVERNANCE_PROCESS_UPDATED,
  buildAnnounceContent,
  type GovernanceProcessKind,
  type GovernanceProcessUpdatedPayload,
} from '../announcements';
import { getAnnouncementsChannel } from '../parent-navbar';
import { squads } from '../../stores/squads';

export function buildGovernanceProcessUpdatedPayload(params: {
  parentId: string;
  kind: GovernanceProcessKind;
  address?: string;
  proposalId?: string;
  txHash?: string;
}): GovernanceProcessUpdatedPayload {
  const payload: GovernanceProcessUpdatedPayload = {
    parent_id: params.parentId.trim(),
    kind: params.kind,
  };
  const address = params.address?.trim();
  if (address) payload.address = address;
  const proposalId = params.proposalId?.trim();
  if (proposalId) payload.proposal_id = proposalId;
  const txHash = params.txHash?.trim();
  if (txHash) payload.tx_hash = txHash;
  return payload;
}

export async function announceGovernanceProcessUpdated(params: {
  parentId: string;
  kind: GovernanceProcessKind;
  address?: string;
  proposalId?: string;
  txHash?: string;
}): Promise<void> {
  const parentId = params.parentId.trim();
  if (!parentId) return;
  const row = get(squads).find((s) => s.id === parentId);
  const gid = row ? getAnnouncementsChannel(row)?.groupId?.trim() : '';
  if (!gid) return;
  try {
    await sendDmMessage(
      gid,
      buildAnnounceContent({
        type: ANNOUNCE_TYPE_GOVERNANCE_PROCESS_UPDATED,
        payload: buildGovernanceProcessUpdatedPayload(params),
      }),
      '',
      { virtualBucket: 'announcements' },
    );
  } catch {
    // Chain remains canonical; hint is best-effort.
  }
}
