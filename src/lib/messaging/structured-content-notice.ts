/**
 * Human-facing notices for structured chat/DM JSON that has no dedicated card.
 * Never return the raw JSON body.
 */

import { getWalletNetworkDisplayName } from '../wallet/assets';
import { isSquadDeployableChain } from '../squad/squad-network';
import type { FormatXMLElementFn } from 'intl-messageformat';

export type MessageFormatter = (
  key: string,
  opts?: {
    values?: Record<
      string,
      string | number | boolean | Date | FormatXMLElementFn<unknown> | null | undefined
    >;
  }
) => string;

const SCHEMA_KEYS: Record<string, string> = {
  'pacto.squad.bot_join_response.v1': 'messaging.structuredNotice.squadJoinResponse',
  'pacto.squad.bot_join_dm.v1': 'messaging.structuredNotice.squadJoinRequest',
  'pacto.squad.join_request.v1': 'messaging.structuredNotice.squadJoinRequest',
  'pacto.squad.join_request_response.v1': 'messaging.structuredNotice.squadJoinUpdate',
  'pacto.squad_bot.key_share.v1': 'messaging.structuredNotice.squadBotKeyUpdate',
  'pacto.squad_bot.meta.v1': 'messaging.structuredNotice.squadBotUpdate',
  'pacto.squad_bot.key_rotated.v1': 'messaging.structuredNotice.squadBotKeyRotated',
  'pacto.squad_bot.rotate_prompt.v1': 'messaging.structuredNotice.squadBotRotationPrompt',
  'pacto.commons.broadcast.v1': 'messaging.structuredNotice.commonsBroadcast',
  'pacto.dashboard_poll.v1': 'messaging.structuredNotice.dashboardPollUpdate',
};

const TYPE_KEYS: Record<string, string> = {
  squad_contract_allowlist_updated: 'messaging.structuredNotice.contractAllowlistUpdated',
  squad_tracked_tokens_updated: 'messaging.structuredNotice.trackedTokensUpdated',
  squad_member_evm_share: 'messaging.structuredNotice.memberEvmAddressShared',
  squad_state_sync_request: 'messaging.structuredNotice.squadSyncRequest',
  squad_network_updated: 'messaging.structuredNotice.squadNetworkUpdated',
  squad_rpc_updated: 'messaging.structuredNotice.squadRpcUpdated',
  governance_updated: 'messaging.structuredNotice.governanceUpdated',
  war_game_updated: 'messaging.structuredNotice.warGameUpdated',
  governance_process_updated: 'messaging.structuredNotice.governanceProcessUpdated',
  squad_safe_updated: 'messaging.structuredNotice.treasurySafeUpdated',
  safe_proposal: 'messaging.structuredNotice.safeProposal',
  dashboard_poll_created: 'messaging.structuredNotice.dashboardPollCreated',
  squad_outbound_invite: 'messaging.structuredNotice.squadInvitePending',
  squad_admit_needed: 'messaging.structuredNotice.squadMemberAdmit',
  squad_channels_catalog: 'messaging.structuredNotice.squadChannelsUpdated',
  squad_identity_updated: 'messaging.structuredNotice.squadIdentityUpdated',
  squad_invite_accepted: 'messaging.structuredNotice.squadInviteAccepted',
  squad_member_left: 'messaging.structuredNotice.squadMemberLeft',
};

function tryParseObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const v = JSON.parse(trimmed) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  return null;
}

/** True when content looks like a product structured event (schema or type key).
 * Mentions envelopes use `kind` and are intentionally not treated as structured product notices. */
export function isStructuredProductContent(content: string | null | undefined): boolean {
  const obj = tryParseObject(content ?? '');
  if (!obj) return false;
  if (obj.kind === 'pacto.mentions.envelope.v1') return false;
  return typeof obj.schema === 'string' || typeof obj.type === 'string';
}

/**
 * Short notice for structured product JSON, or null if content is ordinary text / unknown shape.
 * Prefer dedicated cards when available; this is the fall-through safety net.
 */
export function summarizeStructuredMessageContent(
  content: string | null | undefined,
  t: MessageFormatter
): string | null {
  const obj = tryParseObject(content ?? '');
  if (!obj) return null;

  const schema = typeof obj.schema === 'string' ? obj.schema.trim() : '';
  if (schema) {
    if (schema === 'pacto.squad.bot_join_response.v1') {
      const name =
        typeof obj.squadName === 'string' && obj.squadName.trim()
          ? obj.squadName.trim()
          : t('messaging.structuredNotice.unknownSquad');
      const status = obj.status === 'accepted' || obj.status === 'rejected' ? obj.status : null;
      if (status === 'accepted')
        return t('messaging.structuredNotice.joinRequestAccepted', { values: { squadName: name } });
      if (status === 'rejected')
        return t('messaging.structuredNotice.joinRequestRejected', { values: { squadName: name } });
      return t('messaging.structuredNotice.joinUpdateFor', { values: { squadName: name } });
    }
    if (schema === 'pacto.squad.bot_join_dm.v1') {
      const name =
        typeof obj.squadName === 'string' && obj.squadName.trim()
          ? obj.squadName.trim()
          : t('messaging.structuredNotice.unknownSquad');
      return t('messaging.structuredNotice.joinRequestFor', { values: { squadName: name } });
    }
    const key = SCHEMA_KEYS[schema];
    if (key) return t(key);
    return t('messaging.structuredNotice.squadUpdate');
  }

  const type = typeof obj.type === 'string' ? obj.type.trim() : '';
  if (type) {
    if (type === 'squad_network_updated') {
      const payload =
        obj.payload && typeof obj.payload === 'object'
          ? (obj.payload as Record<string, unknown>)
          : null;
      const primary = payload?.primary;
      const practice = payload?.practice;
      if (isSquadDeployableChain(primary) && isSquadDeployableChain(practice)) {
        if (primary === practice) {
          return t('messaging.structuredNotice.squadNetworkUpdatedTo', {
            values: { network: getWalletNetworkDisplayName(primary) },
          });
        }
        return t('messaging.structuredNotice.squadNetworkUpdatedToSlots', {
          values: {
            primary: getWalletNetworkDisplayName(primary),
            practice: getWalletNetworkDisplayName(practice),
          },
        });
      }
      const key = TYPE_KEYS.squad_network_updated;
      if (key) return t(key);
    }
    const key = TYPE_KEYS[type];
    if (key) return t(key);
    return t('messaging.structuredNotice.squadUpdate');
  }

  return null;
}
