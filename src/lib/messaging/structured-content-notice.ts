/**
 * Human-facing notices for structured chat/DM JSON that has no dedicated card.
 * Never return the raw JSON body.
 */

import { getWalletNetworkDisplayName } from '../wallet/assets';
import { isSquadDeployableChain } from '../squad/squad-network';

const SCHEMA_NOTICES: Record<string, string> = {
  'pacto.squad.bot_join_response.v1': 'Squad join response',
  'pacto.squad.bot_join_dm.v1': 'Squad join request',
  'pacto.squad.join_request.v1': 'Squad join request',
  'pacto.squad.join_request_response.v1': 'Squad join update',
  'pacto.squad_bot.key_share.v1': 'Squad bot key update',
  'pacto.squad_bot.meta.v1': 'Squad bot update',
  'pacto.squad_bot.key_rotated.v1': 'Squad bot key rotated',
  'pacto.squad_bot.rotate_prompt.v1': 'Squad bot rotation prompt',
  'pacto.commons.broadcast.v1': 'Commons broadcast',
  'pacto.dashboard_poll.v1': 'Dashboard poll update',
};

const TYPE_NOTICES: Record<string, string> = {
  squad_contract_allowlist_updated: 'Contract allowlist updated',
  squad_tracked_tokens_updated: 'Tracked tokens updated',
  squad_member_evm_share: 'Member EVM address shared',
  squad_state_sync_request: 'Squad sync request',
  squad_network_updated: 'Squad network updated',
  governance_updated: 'Governance updated',
  squad_safe_updated: 'Treasury Safe updated',
  safe_proposal: 'Safe proposal',
  dashboard_poll_created: 'Dashboard poll created',
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

/** True when content looks like a product structured event (schema or type key). */
export function isStructuredProductContent(content: string | null | undefined): boolean {
  const obj = tryParseObject(content ?? '');
  if (!obj) return false;
  return typeof obj.schema === 'string' || typeof obj.type === 'string';
}

/**
 * Short notice for structured product JSON, or null if content is ordinary text / unknown shape.
 * Prefer dedicated cards when available; this is the fall-through safety net.
 */
export function summarizeStructuredMessageContent(content: string | null | undefined): string | null {
  const obj = tryParseObject(content ?? '');
  if (!obj) return null;

  const schema = typeof obj.schema === 'string' ? obj.schema.trim() : '';
  if (schema) {
    if (schema === 'pacto.squad.bot_join_response.v1') {
      const name = typeof obj.squadName === 'string' && obj.squadName.trim() ? obj.squadName.trim() : 'squad';
      const status = obj.status === 'accepted' || obj.status === 'rejected' ? obj.status : null;
      if (status === 'accepted') return `Join request for ${name} was accepted`;
      if (status === 'rejected') return `Join request for ${name} was rejected`;
      return `Join update for ${name}`;
    }
    if (schema === 'pacto.squad.bot_join_dm.v1') {
      const name = typeof obj.squadName === 'string' && obj.squadName.trim() ? obj.squadName.trim() : 'squad';
      return `Join request for ${name}`;
    }
    return SCHEMA_NOTICES[schema] ?? 'Squad update';
  }

  const type = typeof obj.type === 'string' ? obj.type.trim() : '';
  if (type) {
    if (type === 'squad_network_updated') {
      const payload =
        obj.payload && typeof obj.payload === 'object'
          ? (obj.payload as Record<string, unknown>)
          : null;
      const chain = payload?.chain;
      if (isSquadDeployableChain(chain)) {
        return `Squad network updated to ${getWalletNetworkDisplayName(chain)}`;
      }
      return TYPE_NOTICES.squad_network_updated;
    }
    return TYPE_NOTICES[type] ?? 'Squad update';
  }

  return null;
}
