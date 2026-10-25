import type { GovernanceProcessKind } from '../../announcements';
import { announceGovernanceProcessUpdated } from '../governance-process-announce';
import { recordMutinyProcessTx } from '../mutiny-process-tx';
import { bumpGovernanceProcessNonce } from '../../../stores/navigation';

export async function afterGovWrite<T extends { txHash?: string }>(
  result: T,
  hint: {
    parentId: string;
    kind: GovernanceProcessKind;
    address?: string;
    proposalId?: string;
    mutinyStart?: boolean;
    proposedDataHex?: string;
  },
): Promise<T> {
  if (hint.kind === 'mutiny' && result.txHash?.trim()) {
    recordMutinyProcessTx({
      parentId: hint.parentId,
      txHash: result.txHash,
      isStart: hint.mutinyStart === true,
    });
  }
  bumpGovernanceProcessNonce(hint.parentId);
  let replica: {
    stack: 'pacto_gov' | 'pacto_gov_wargame';
    round: string;
    blockNumber: number;
    snapshot: import('../gov-replica').GovReplicaSnapshot;
  } | null;
  try {
    const { buildWriterGovReplicaSnapshot } = await import('../gov-replica-writer');
    replica = await buildWriterGovReplicaSnapshot({
      parentId: hint.parentId,
      kind: hint.kind,
      proposedDataHex: hint.proposedDataHex,
    });
  } catch {
    replica = null;
  }
  if (replica) {
    try {
      const { persistGovReplicaSnapshot } = await import('../gov-replica');
      await persistGovReplicaSnapshot({
        parentId: hint.parentId,
        stack: replica.stack,
        snapshot: replica.snapshot,
        blockNumber: replica.blockNumber,
        round: replica.round,
        txHash: result.txHash,
      });
    } catch {
      /* best-effort local hydrate */
    }
  }
  await announceGovernanceProcessUpdated({
    parentId: hint.parentId,
    kind: hint.kind,
    address: hint.address,
    proposalId: hint.proposalId,
    txHash: result.txHash,
    stack: replica?.stack,
    round: replica?.round,
    blockNumber: replica?.blockNumber,
    snapshot: replica?.snapshot,
  });
  return result;
}
