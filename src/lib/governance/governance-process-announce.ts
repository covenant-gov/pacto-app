import { get } from 'svelte/store';
import { sendDmMessage } from '../api/nostr';
import {
  ANNOUNCE_TYPE_GOVERNANCE_PROCESS_UPDATED,
  buildAnnounceContent,
  type GovernanceProcessKind,
  type GovernanceProcessSnapshot,
  type GovernanceProcessStack,
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
  stack?: GovernanceProcessStack;
  round?: string;
  blockNumber?: number;
  snapshot?: GovernanceProcessSnapshot;
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
  if (params.stack) payload.stack = params.stack;
  const round = params.round?.trim();
  if (round) payload.round = round;
  if (params.blockNumber != null && Number.isFinite(params.blockNumber)) {
    payload.block_number = String(Math.max(0, Math.floor(params.blockNumber)));
  }
  if (params.snapshot) payload.snapshot = params.snapshot;
  return payload;
}

export async function announceGovernanceProcessUpdated(params: {
  parentId: string;
  kind: GovernanceProcessKind;
  address?: string;
  proposalId?: string;
  txHash?: string;
  stack?: GovernanceProcessStack;
  round?: string;
  blockNumber?: number;
  snapshot?: GovernanceProcessSnapshot;
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
        payload: buildGovernanceProcessUpdatedPayload({
          parentId: params.parentId,
          kind: params.kind,
          address: params.address,
          proposalId: params.proposalId,
          txHash: params.txHash,
          stack: params.stack,
          round: params.round,
          blockNumber: params.blockNumber,
          snapshot: params.snapshot,
        }),
      }),
      '',
      { virtualBucket: 'announcements' },
    );
  } catch {
    // Chain remains canonical; hint is best-effort.
  }
}
