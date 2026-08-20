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
import { parseSquadNetworkUpdated } from '../squad/squad-network-share';
import { saveSquadNetworkOverride } from '../squad/squad-network';
import { applySquadRpcUpdated, parseSquadRpcUpdated } from '../squad/squad-rpc-share';
import {
  onMlsAdmitNeeded,
  onMlsOutboundInviteAnnounce,
  parseSquadAdmitNeeded,
  parseSquadOutboundInvite,
} from '../squad/squad-outbound-invite';
import {
  applySquadChannelsCatalog,
  parseSquadChannelsCatalog,
} from '../squad/squad-channels-catalog';
import {
  applySquadIdentityUpdated,
  parseSquadIdentityUpdated,
} from '../squad/squad-identity-announce';
import { currentUser } from '../../stores/auth';
import {
  governanceProcessNonceByParentId,
  squadAllowlistNonceByParentId,
  squadBotMetaNonceBySquadId,
  squadTrackedTokensNonceByParentId,
} from '../../stores/navigation';
import { syncJoinRequestsForSquad } from '../../stores/squad-join-requests';
import { drainPendingAdmitQueue } from '../parent/pending-admit';

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
 */
export function onMlsStructuredMessage(
  content: string | null | undefined,
  groupId: string,
  handlers: MlsStructuredRefreshHandlers
): void {
  const raw = content ?? '';
  const gid = groupId.trim();
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
    bumpNonce(governanceProcessNonceByParentId, announce.payload.parent_id);
  }
  if (announce?.type === ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE) {
    handlers.mergeSquadMemberEvmForAnnouncementsGroup(announce.payload.parent_id || gid);
  }

  if (parseSquadStateSyncRequest(raw)) {
    void respondToSquadStateSyncRequest(raw, gid);
  }

  if (parseSquadOutboundInvite(raw)) {
    onMlsOutboundInviteAnnounce(raw);
  }
  if (parseSquadAdmitNeeded(raw)) {
    onMlsAdmitNeeded(raw, gid);
    void drainPendingAdmitQueue();
  }
  if (parseSquadChannelsCatalog(raw)) {
    applySquadChannelsCatalog(raw, gid);
  }
  if (parseSquadIdentityUpdated(raw)) {
    applySquadIdentityUpdated(raw, gid);
  }

  const networkUpdate = parseSquadNetworkUpdated(raw);
  if (networkUpdate && networkUpdate.parent_id === gid) {
    const me = get(currentUser)?.npub?.trim();
    if (me) {
      saveSquadNetworkOverride(me, networkUpdate.parent_id, networkUpdate.chain);
    }
  }

  const rpcUpdate = parseSquadRpcUpdated(raw);
  if (rpcUpdate && rpcUpdate.parent_id === gid) {
    const me = get(currentUser)?.npub?.trim();
    if (me) {
      applySquadRpcUpdated(rpcUpdate, me);
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
    schema === 'pacto.squad_bot.meta.v1' ||
    schema === 'pacto.squad_bot.key_rotated.v1'
  ) {
    const squadId =
      (typeof root.squadId === 'string' && root.squadId.trim()) ||
      (typeof root.squad_id === 'string' && root.squad_id.trim()) ||
      gid;
    bumpNonce(squadBotMetaNonceBySquadId, squadId);
  }

  if (schema === SQUAD_JOIN_REQUEST_SCHEMA || schema === SQUAD_JOIN_REQUEST_RESPONSE_SCHEMA) {
    const squadId =
      (typeof root.squadId === 'string' && root.squadId.trim()) ||
      (typeof root.squad_id === 'string' && root.squad_id.trim()) ||
      gid;
    if (squadId) {
      void syncJoinRequestsForSquad(squadId);
    }
    void drainPendingAdmitQueue();
  }
}
