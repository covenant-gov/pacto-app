/**
 * Virtual bucket routing for squad/network default channels when one MLS group backs
 * announcements, inbox, polls, and join_requests. Matches docs/mls/VIRTUAL_CHANNEL_ROUTING_ADR.md
 * (client-side; rumor tags are not available on DmMessage).
 */

import {
  parseAnnouncement,
  ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED,
  ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
  ANNOUNCE_TYPE_SAFE_PROPOSAL,
  ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE,
  ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED,
  isAnnouncementsGovernanceAnnounce,
  type AnnounceMessage,
} from '../announcements';
import {
  ANNOUNCEMENTS_CHANNEL_NAME,
  PERSONAL_ALERTS_CHANNEL_NAME,
  POLLS_CHANNEL_NAME,
  normalizeHubChannelName,
} from '../squad/hub-channel-names';

export type VirtualBucket = 'announcements' | 'inbox' | 'polls' | 'join_requests';

function isVirtualBucket(value: string): value is VirtualBucket {
  return (
    value === 'announcements' ||
    value === 'inbox' ||
    value === 'polls' ||
    value === 'join_requests'
  );
}

/** Separator between MLS parent id and bucket in {@link groupTimelineKey} (not valid in hex MLS ids). */
export const GROUP_TIMELINE_KEY_SEP = '\x1f';

export function groupTimelineKey(parentGroupId: string, bucket: VirtualBucket): string {
  return `${parentGroupId}${GROUP_TIMELINE_KEY_SEP}${bucket}`;
}

export function parseGroupTimelineKey(key: string): { parentGroupId: string; bucket: VirtualBucket } | null {
  const i = key.indexOf(GROUP_TIMELINE_KEY_SEP);
  if (i <= 0) return null;
  const parentGroupId = key.slice(0, i);
  const bucket = key.slice(i + GROUP_TIMELINE_KEY_SEP.length);
  if (!isVirtualBucket(bucket)) return null;
  return { parentGroupId, bucket };
}

export interface ChannelLike {
  name: string;
  groupId: string;
  order: number;
}

const DEFAULT_TRIO_CHANNEL_NAMES = [
  ANNOUNCEMENTS_CHANNEL_NAME,
  PERSONAL_ALERTS_CHANNEL_NAME,
  POLLS_CHANNEL_NAME,
] as const;

/** True when #announcements, #personal-alerts, and #polls exist and share one MLS group id. */
export function defaultTrioSharesSingleMlsGroup(channels: ChannelLike[]): boolean {
  const byName = new Map(channels.map((c) => [c.name, c]));
  const ann = byName.get(DEFAULT_TRIO_CHANNEL_NAMES[0]);
  const personalAlerts = byName.get(DEFAULT_TRIO_CHANNEL_NAMES[1]);
  const pol = byName.get(DEFAULT_TRIO_CHANNEL_NAMES[2]);
  if (!ann || !personalAlerts || !pol) return false;
  const gid = ann.groupId.trim();
  return gid.length > 0 && gid === personalAlerts.groupId.trim() && gid === pol.groupId.trim();
}

/**
 * Pick which sidebar row is selected when several channels share the same MLS group id.
 */
export function resolveHubChannelNameForGroupSelection(
  channels: ChannelLike[],
  groupId: string | null | undefined,
  preferredName: string | null | undefined
): string | null {
  const gid = groupId?.trim();
  if (!gid) return null;
  const sorted = [...channels].sort((a, b) => a.order - b.order);
  const matches = sorted.filter((c) => c.groupId === gid);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0].name;
  const pref = normalizeHubChannelName(preferredName);
  if (pref && matches.some((c) => c.name === pref)) return pref;
  return [...matches].sort((a, b) => a.order - b.order)[0]?.name ?? null;
}

/** ADR derivation order (tags omitted — not on message model). */
export function deriveVirtualBucketFromMessageContent(content: string | undefined | null): VirtualBucket {
  const trimmed = (content ?? '').trim();
  if (!trimmed.startsWith('{')) return 'announcements';

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return 'announcements';
  }
  if (!parsed || typeof parsed !== 'object') return 'announcements';
  const rec = parsed as Record<string, unknown>;

  const vb = rec['pacto_virtual_bucket'];
  if (typeof vb === 'string' && isVirtualBucket(vb)) return vb;

  if (
    rec['schema'] === 'pacto.dashboard_poll.v1' &&
    rec['action'] === 'vote' &&
    typeof rec['parent_id'] === 'string' &&
    typeof rec['poll_id'] === 'string' &&
    typeof rec['option_id'] === 'string'
  ) {
    return 'polls';
  }

  const schema = rec['schema'];
  if (
    schema === 'pacto.squad.join_request.v1' ||
    schema === 'pacto.squad.join_request_response.v1'
  ) {
    return 'join_requests';
  }
  if (schema === 'pacto.squad_bot.meta.v1' || schema === 'pacto.squad_bot.key_rotated.v1') {
    return 'announcements';
  }
  if (schema === 'pacto.squad_bot.rotate_prompt.v1') {
    return 'inbox';
  }

  const ann = parseAnnouncement(trimmed);
  if (ann?.type === ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED) return 'announcements';
  if (ann?.type === ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE) return 'announcements';
  if (ann?.type === ANNOUNCE_TYPE_GOVERNANCE_UPDATED) {
    return isAnnouncementsGovernanceAnnounce(ann) ? 'announcements' : 'inbox';
  }
  if (ann?.type === ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED || ann?.type === ANNOUNCE_TYPE_SAFE_PROPOSAL) {
    return 'inbox';
  }

  return 'announcements';
}

/** Automation-shaped announces belong in **inbox** for MLS timeline partitioning (ADR), except squad sponsor deploys. */
export function isInboxOnlyStructuredAnnounce(parsed: AnnounceMessage): boolean {
  if (isAnnouncementsGovernanceAnnounce(parsed)) return false;
  switch (parsed.type) {
    case ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED:
    case ANNOUNCE_TYPE_SAFE_PROPOSAL:
    case ANNOUNCE_TYPE_GOVERNANCE_UPDATED:
      return true;
    default:
      return false;
  }
}

/** Prefer rendering structured automation rows only when the message resolves to the correct virtual bucket. */
export function announceCardAllowedForTimelineBucket(
  parsed: AnnounceMessage,
  msg: { virtual_bucket?: string | null; content?: string | null },
): boolean {
  if (parsed.type === ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE) {
    return resolveVirtualBucketForTimelineMessage(msg) === 'announcements';
  }
  if (!isInboxOnlyStructuredAnnounce(parsed)) return true;
  return resolveVirtualBucketForTimelineMessage(msg) === 'inbox';
}

/** Minimal shape for partitioning MLS timelines by derived bucket (issue 3 spike). */
export interface TimelinePartitionMessage {
  content?: string | null;
  at: number;
  /** From Tauri `Message.virtual_bucket` when persisted (issue 6). */
  virtual_bucket?: string | null;
}

/** Prefer backend-normalized bucket when present; otherwise derive from content (ADR). */
export function resolveVirtualBucketForTimelineMessage(m: {
  content?: string | null;
  virtual_bucket?: string | null;
}): VirtualBucket {
  const ann =
    m.content?.trim().startsWith('{') === true ? parseAnnouncement(m.content) : null;
  if (ann?.type === ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED) return 'announcements';
  if (ann?.type === ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE) return 'announcements';

  const pb = m.virtual_bucket?.trim();
  if (pb && isVirtualBucket(pb)) return pb;
  return deriveVirtualBucketFromMessageContent(m.content);
}

/**
 * Build a map keyed by `groupTimelineKey(parentGroupId, virtualBucket)` from raw MLS timelines keyed by physical group id.
 * Same message object references as input; sorts each bucket by `at`.
 */
export function buildBackendGroupTimelineMessages<T extends TimelinePartitionMessage>(
  byGroup: Record<string, T[] | undefined>
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const [groupId, msgs] of Object.entries(byGroup)) {
    if (!msgs?.length) continue;
    for (const m of msgs) {
      const b = resolveVirtualBucketForTimelineMessage(m);
      const k = groupTimelineKey(groupId, b);
      (out[k] ??= []).push(m);
    }
  }
  for (const arr of Object.values(out)) {
    arr.sort((a, b) => a.at - b.at);
  }
  return out;
}
