import { get } from 'svelte/store';
import { parseAnnouncement, ANNOUNCE_TYPE_GOVERNANCE_UPDATED, ANNOUNCE_TYPE_GOVERNANCE_PROCESS_UPDATED, ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE, ANNOUNCE_TYPE_WAR_GAME_UPDATED } from '../announcements';
import { SQUAD_CONTRACT_ALLOWLIST_ANNOUNCE_TYPE } from '../governance/squad-allowlist';
import { SQUAD_TRACKED_TOKENS_ANNOUNCE_TYPE } from '../governance/squad-tracked-tokens';
import {
  SQUAD_JOIN_REQUEST_RESPONSE_SCHEMA,
  SQUAD_JOIN_REQUEST_SCHEMA,
} from '../squad/squad-join-mls';
import {
  parseSquadStateSyncRequest,
  respondToSquadStateSyncRequest,
} from '../squad/squad-state-sync';
import {
  applySquadNetworkUpdated,
  parseSquadNetworkUpdated,
  infraChainFromSquadRows,
  practiceInfraChainFromSquadRows,
} from '../squad/squad-network-share';
import { applySquadRpcUpdated, parseSquadRpcUpdated } from '../squad/squad-rpc-share';
import {
  onMlsAdmitNeeded,
  onMlsOutboundInviteAnnounce,
  onMlsOutboundInviteDeclined,
  onMlsOutboundInviteRevoked,
  parseSquadAdmitNeeded,
  parseSquadOutboundInvite,
  parseSquadOutboundInviteDeclined,
  parseSquadOutboundInviteRevoked,
} from '../squad/squad-outbound-invite';
import { syncOutboundInvitesForSquad } from '../../stores/squad-outbound-invites';
import {
  applySquadChannelsCatalog,
  parseSquadChannelsCatalog,
} from '../squad/squad-channels-catalog';
import {
  applySquadIdentityUpdated,
  parseSquadIdentityUpdated,
} from '../squad/squad-identity-announce';
import { parseSquadEvmRosterSnapshot } from '../squad/squad-evm-roster-snapshot';
import { currentUser } from '../../stores/auth-session';
import { squadInfraByParentId } from '../../stores/squads';
import {
  bumpGovernanceProcessNonce,
  squadAllowlistNonceByParentId,
  joinInboxMetaNonceBySquadId,
  squadTrackedTokensNonceByParentId,
} from '../../stores/navigation';
import { syncJoinRequestsForSquad } from '../../stores/squad-join-requests';
import { drainPendingAdmitQueue } from '../parent/pending-admit';
import { ingestMutinyProcessTxFromAnnounce } from '../governance/mutiny-process-tx';

export interface MlsStructuredRefreshHandlers {
  mergeTreasurySafesForParent: (parentId: string) => void;
  mergeSquadInfraForParent: (parentId: string) => void;
  mergeSquadMemberEvmForAnnouncementsGroup: (announcementsGroupId: string) => void;
}

function bumpNonce(
  store: typeof squadAllowlistNonceByParentId,
  parentId: string
): void {
  const id = parentId.trim();
  if (!id) return;
  store.update((m) => ({ ...m, [id]: (m[id] ?? 0) + 1 }));
}

function tryParseRoot(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const v = JSON.parse(trimmed) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Apply FE refresh for structured MLS content after SQLite side effects.
 * Call from mls_message_new / message_update (group path).
 * `authorNpub` enables arrival-time SquadAdmin privilege checks (ignore event created_at).
 */
export function onMlsStructuredMessage(
  content: string | null | undefined,
  groupId: string,
  handlers: MlsStructuredRefreshHandlers,
  authorNpub?: string | null,
): void {
  const raw = content ?? '';
  const gid = groupId.trim();
  const author = authorNpub?.trim() || '';
  const announce = parseAnnouncement(raw);

  if (announce?.type === 'squad_safe_updated') {
    handlers.mergeTreasurySafesForParent(announce.payload.squad_id);
  }
  if (announce?.type === ANNOUNCE_TYPE_GOVERNANCE_UPDATED) {
    handlers.mergeSquadInfraForParent(announce.payload.parent_id);
  }
  if (announce?.type === ANNOUNCE_TYPE_WAR_GAME_UPDATED) {
    handlers.mergeSquadInfraForParent(announce.payload.parent_id);
  }
  if (announce?.type === ANNOUNCE_TYPE_GOVERNANCE_PROCESS_UPDATED) {
    bumpGovernanceProcessNonce(announce.payload.parent_id);
    ingestMutinyProcessTxFromAnnounce(announce.payload);
  }
  if (announce?.type === ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE) {
    handlers.mergeSquadMemberEvmForAnnouncementsGroup(announce.payload.parent_id || gid);
  }
  if (parseSquadEvmRosterSnapshot(raw)) {
    handlers.mergeSquadMemberEvmForAnnouncementsGroup(gid);
  }

  if (parseSquadStateSyncRequest(raw)) {
    void respondToSquadStateSyncRequest(raw, gid, author);
  }

  if (parseSquadOutboundInvite(raw)) {
    void applyPrivilegedMlsAction(author, gid, 'inviteAccept', () => {
      onMlsOutboundInviteAnnounce(raw);
      if (gid) void syncOutboundInvitesForSquad(gid);
    });
  }
  if (parseSquadOutboundInviteRevoked(raw)) {
    void applyPrivilegedMlsAction(author, gid, 'inviteAccept', () => {
      onMlsOutboundInviteRevoked(raw);
      if (gid) void syncOutboundInvitesForSquad(gid);
    });
  }
  if (parseSquadOutboundInviteDeclined(raw)) {
    void applyPrivilegedMlsAction(author, gid, 'inviteAccept', () => {
      onMlsOutboundInviteDeclined(raw);
      if (gid) void syncOutboundInvitesForSquad(gid);
    });
  }
  if (parseSquadAdmitNeeded(raw)) {
    void applyPrivilegedMlsAction(author, gid, 'inviteAccept', () => {
      onMlsAdmitNeeded(raw, gid);
      void drainPendingAdmitQueue();
      if (gid) void syncOutboundInvitesForSquad(gid);
    });
  }
  if (parseSquadChannelsCatalog(raw)) {
    void applyPrivilegedMlsAction(author, gid, 'createChannel', () => {
      applySquadChannelsCatalog(raw, gid);
    });
  }
  if (parseSquadIdentityUpdated(raw)) {
    applySquadIdentityUpdated(raw, gid);
  }

  const networkUpdate = parseSquadNetworkUpdated(raw);
  if (networkUpdate && networkUpdate.parent_id === gid) {
    const me = get(currentUser)?.npub?.trim();
    if (me) {
      void applyPrivilegedMlsAction(author, networkUpdate.parent_id, 'manageNetwork', () => {
        const infraRows = get(squadInfraByParentId)[networkUpdate.parent_id] ?? [];
        applySquadNetworkUpdated(
          networkUpdate,
          me,
          practiceInfraChainFromSquadRows(infraRows),
          infraChainFromSquadRows(infraRows),
        );
      });
    }
  }

  const rpcUpdate = parseSquadRpcUpdated(raw);
  if (rpcUpdate && rpcUpdate.parent_id === gid) {
    const me = get(currentUser)?.npub?.trim();
    if (me) {
      void applyPrivilegedMlsAction(author, rpcUpdate.parent_id, 'manageNetwork', () => {
        applySquadRpcUpdated(rpcUpdate, me);
      });
    }
  }

  const root = tryParseRoot(raw);
  if (!root) return;

  const type = typeof root.type === 'string' ? root.type.trim() : '';
  const payload = root.payload && typeof root.payload === 'object' ? (root.payload as Record<string, unknown>) : null;

  if (type === SQUAD_CONTRACT_ALLOWLIST_ANNOUNCE_TYPE && payload) {
    const parentId = typeof payload.parent_id === 'string' ? payload.parent_id : gid;
    bumpNonce(squadAllowlistNonceByParentId, parentId);
  }
  if (type === SQUAD_TRACKED_TOKENS_ANNOUNCE_TYPE && payload) {
    const parentId = typeof payload.parent_id === 'string' ? payload.parent_id : gid;
    bumpNonce(squadTrackedTokensNonceByParentId, parentId);
  }

  const schema = typeof root.schema === 'string' ? root.schema.trim() : '';
  if (
    schema === 'pacto.squad.join_inbox.meta.v1' ||
    schema === 'pacto.squad.join_inbox.key_rotated.v1'
  ) {
    const squadId =
      (typeof root.squadId === 'string' && root.squadId.trim()) ||
      (typeof root.squad_id === 'string' && root.squad_id.trim()) ||
      gid;
    bumpNonce(joinInboxMetaNonceBySquadId, squadId);
  }

  if (schema === SQUAD_JOIN_REQUEST_SCHEMA || schema === SQUAD_JOIN_REQUEST_RESPONSE_SCHEMA) {
    const squadId =
      (typeof root.squadId === 'string' && root.squadId.trim()) ||
      (typeof root.squad_id === 'string' && root.squad_id.trim()) ||
      gid;
    if (schema === SQUAD_JOIN_REQUEST_RESPONSE_SCHEMA) {
      void applyPrivilegedMlsAction(author, squadId, 'inviteAccept', () => {
        if (squadId) void syncJoinRequestsForSquad(squadId);
        void drainPendingAdmitQueue();
      });
    } else {
      if (squadId) void syncJoinRequestsForSquad(squadId);
      void drainPendingAdmitQueue();
    }
  }
}

async function applyPrivilegedMlsAction(
  authorNpub: string,
  parentId: string,
  action: 'inviteAccept' | 'createChannel' | 'manageNetwork',
  apply: () => void,
): Promise<void> {
  const pid = parentId.trim();
  if (!pid) return;
  // Missing author: fail closed when SquadAdmin is active (checked inside decide).
  const { decideSquadPrivilege } = await import('../governance/squad-privilege-enforce');
  const decision = await decideSquadPrivilege({
    parentId: pid,
    memberNpub: authorNpub || '__missing__',
    action,
  });
  if (!decision.ok) return;
  apply();
}
