import { writable } from 'svelte/store';
import type { TreasurySafeEntry } from '../lib/treasury/treasury-safes';
import type { SquadInfraDto } from '../lib/governance/api';
import { ensureDefaultHubChannelRows } from '../lib/squad/hub-channel-rows';
import {
  ANNOUNCEMENTS_CHANNEL_NAME,
  DASHBOARD_CHANNEL_ID,
  DASHBOARD_CHANNEL_NAME,
  JOIN_REQUESTS_CHANNEL_ID,
  JOIN_REQUESTS_CHANNEL_NAME,
  PERSONAL_ALERTS_CHANNEL_NAME,
  POLLS_CHANNEL_NAME,
  normalizeHubChannelName,
} from '../lib/squad/hub-channel-names';
import {
  normalizeStoredSquad,
  type PairedSquads,
  type PairedSquadRef,
  type SquadKind,
  type SquadVisibility,
} from '../lib/squad-pair';
export type { SquadKind, PairedSquadRef, PairedSquads, SquadVisibility };
export { partnerSquadsForAnchor, partnerSquadsForHubParent } from '../lib/squad-pair';
export {
  ANNOUNCEMENTS_CHANNEL_NAME,
  DASHBOARD_CHANNEL_ID,
  DASHBOARD_CHANNEL_NAME,
  JOIN_REQUESTS_CHANNEL_ID,
  JOIN_REQUESTS_CHANNEL_NAME,
  PERSONAL_ALERTS_CHANNEL_NAME,
  POLLS_CHANNEL_NAME,
  normalizeHubChannelName,
};

export interface Channel {
  name: string;
  groupId: string;
  order: number;
}

export const squadInfraByParentId = writable<Record<string, SquadInfraDto[]>>({});
export const treasurySafesByParentId = writable<Record<string, TreasurySafeEntry[]>>({});
export const squadMemberEvmByParentId = writable<Record<string, Record<string, string>>>({});

export type { TreasurySafeEntry };
export type { SquadInfraDto };

export function normalizeStoredChannel(ch: { name: string; groupId: string; order: number }): Channel {
  const name = normalizeHubChannelName(ch.name) ?? ch.name;
  return { name, groupId: ch.groupId, order: ch.order };
}

function normalizeParentChannels(channels: Channel[]): Channel[] {
  return ensureDefaultHubChannelRows(channels.map(normalizeStoredChannel));
}

export function normalizeSquadFromStorage(raw: Squad): Squad {
  return normalizeStoredSquad({
    ...raw,
    channels: normalizeParentChannels(raw.channels),
  }) as Squad;
}

export interface Squad {
  id: string;
  name: string;
  iconUrl?: string;
  channels: Channel[];
  kind: SquadKind;
  pairedSquads?: PairedSquads;
  visibility?: SquadVisibility;
  commonsTags?: string[];
  createdAt: number;
  updatedAt: number;
}

export const squads = writable<Squad[]>([]);

export function isPlaceholderChannelName(groupId: string, name: string): boolean {
  if (!name || name.length < 10) return false;
  const placeholder = groupId.slice(0, 12) + '…';
  return name === placeholder || name === groupId.slice(0, 12);
}

export const parentsCreatingAnnouncements = writable<Set<string>>(new Set());

export function addParentCreatingAnnouncements(id: string): void {
  parentsCreatingAnnouncements.update((s) => new Set(s).add(id));
}

export function removeParentCreatingAnnouncements(id: string): void {
  parentsCreatingAnnouncements.update((s) => {
    const next = new Set(s);
    next.delete(id);
    return next;
  });
}

export const parentCreateErrorById = writable<Record<string, string>>({});
export const parentPendingCreateMembers = writable<Record<string, string[]>>({});

export const ungroupedChannels = writable<Channel[]>([]);

/** Legacy: channelMessages was keyed by groupId for local-only mock. Replaced by backendGroupMessages keyed by groupId. */
export const channelMessages = writable<Record<string, unknown[]>>({});
