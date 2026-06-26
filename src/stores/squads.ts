import { writable } from 'svelte/store';
import type { TreasurySafeEntry } from '../lib/treasury/treasury-safes';
import type { SquadInfraDto } from '../lib/governance/api';
import { ensureDefaultHubChannelRows } from '../lib/parent-navbar';
import {
  normalizeStoredSquad,
  type PairedSquads,
  type PairedSquadRef,
  type SquadKind,
  type SquadVisibility,
} from '../lib/squad-pair';
import { persistenceKey } from './persistence-context';

export type { SquadKind, PairedSquadRef, PairedSquads, SquadVisibility };
export { partnerSquadsForAnchor, partnerSquadsForHubParent } from '../lib/squad-pair';

export interface Channel {
  name: string;
  groupId: string;
  order: number;
}

export const ANNOUNCEMENTS_CHANNEL_NAME = 'announcements';
export const INBOX_CHANNEL_NAME = 'inbox';
export const POLLS_CHANNEL_NAME = 'polls';
export const DASHBOARD_CHANNEL_ID = '__dashboard__';
export const DASHBOARD_CHANNEL_NAME = 'dashboard';

export const squadInfraByParentId = writable<Record<string, SquadInfraDto[]>>({});
export const treasurySafesByParentId = writable<Record<string, TreasurySafeEntry[]>>({});
export const squadMemberEvmByParentId = writable<Record<string, Record<string, string>>>({});

export type { TreasurySafeEntry };
export type { SquadInfraDto };

export function normalizeStoredChannel(ch: { name: string; groupId: string; order: number }): Channel {
  const name = ch.name === 'monitor' ? INBOX_CHANNEL_NAME : ch.name;
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

export const PACTO_SQUADS_PREFIX = 'pacto_squads';

function isEmptySquadsJson(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.length === 0;
  } catch {
    return false;
  }
}

export const squads = writable<Squad[]>([]);

/** Read squads from npub-scoped localStorage; migrate legacy `pacto_squads` when scoped is missing or empty. */
export function hydrateSquadsFromDisk(npub: string): void {
  if (typeof localStorage === 'undefined') {
    squads.set([]);
    return;
  }
  const scopedKey = `${PACTO_SQUADS_PREFIX}_${npub}`;
  let raw = localStorage.getItem(scopedKey);
  if (!raw || isEmptySquadsJson(raw)) {
    const legacy = localStorage.getItem(PACTO_SQUADS_PREFIX);
    if (legacy && !isEmptySquadsJson(legacy)) {
      raw = legacy;
      try {
        localStorage.setItem(scopedKey, legacy);
        localStorage.removeItem(PACTO_SQUADS_PREFIX);
      } catch {
        // ignore quota
      }
    }
  }
  if (!raw) {
    squads.set([]);
    return;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed) ? (parsed as Squad[]) : [];
    const loaded: Squad[] = [];
    for (const item of list) {
      try {
        if (item && typeof item === 'object' && typeof item.id === 'string') {
          loaded.push(normalizeSquadFromStorage(item));
        }
      } catch {
        // skip malformed row
      }
    }
    squads.set(loaded);
  } catch {
    squads.set([]);
  }
}

squads.subscribe((value) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(PACTO_SQUADS_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota or serialization errors
  }
});

export function isPlaceholderChannelName(groupId: string, name: string): boolean {
  if (!name || name.length < 10) return false;
  const placeholder = groupId.slice(0, 12) + '…';
  return name === placeholder || name === groupId.slice(0, 12);
}

export function updateChannelNameIfPlaceholder(groupId: string, newName: string): void {
  if (!newName || typeof newName !== 'string') return;
  const name = newName.trim();
  if (!name) return;

  squads.update((list) =>
    list.map((s) => ({
      ...s,
      channels: s.channels.map((ch) =>
        ch.groupId === groupId && isPlaceholderChannelName(groupId, ch.name)
          ? { ...ch, name }
          : ch
      ),
    }))
  );
  ungroupedChannels.update((list) =>
    list.map((ch) =>
      ch.groupId === groupId && isPlaceholderChannelName(groupId, ch.name)
        ? { ...ch, name }
        : ch
    )
  );
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
