import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import {
  squads,
  normalizeSquadFromStorage,
  isPlaceholderChannelName,
  ungroupedChannels,
  type Squad,
} from '../../stores/squads';
import type { PairedSquads, SquadKind, SquadVisibility } from '../squad-pair';
import { restoreSquadsHubSelection } from '../squad-hub-nav';

interface SquadChannelWire {
  name: string;
  groupId: string;
  order: number;
}

interface PairedSquadRefWire {
  id: string;
  name: string;
}

interface SquadRowWire {
  id: string;
  name: string;
  iconUrl?: string;
  channels: SquadChannelWire[];
  kind: string;
  pairedSquads?: PairedSquadRefWire[];
  visibility: string;
  commonsTags?: string[];
  createdAtMs: number;
  updatedAtMs: number;
}

interface SquadUpsertWire {
  id: string;
  name: string;
  iconUrl?: string | null;
  channels: SquadChannelWire[];
  kind?: string;
  pairedSquads?: PairedSquadRefWire[] | null;
  visibility?: string;
  commonsTags?: string[] | null;
  createdAtMs?: number;
  updatedAtMs?: number;
}

function rowToSquad(row: SquadRowWire): Squad {
  return normalizeSquadFromStorage({
    id: row.id,
    name: row.name,
    iconUrl: row.iconUrl,
    channels: row.channels,
    kind: row.kind as SquadKind,
    pairedSquads: row.pairedSquads as PairedSquads | undefined,
    visibility: (row.visibility === 'public' ? 'public' : 'private') as SquadVisibility,
    commonsTags: row.commonsTags,
    createdAt: row.createdAtMs,
    updatedAt: row.updatedAtMs,
  });
}

function squadToUpsert(squad: Squad): SquadUpsertWire {
  return {
    id: squad.id,
    name: squad.name,
    iconUrl: squad.iconUrl ?? null,
    channels: squad.channels.map((c) => ({ name: c.name, groupId: c.groupId, order: c.order })),
    kind: squad.kind,
    pairedSquads: squad.pairedSquads ?? null,
    visibility: squad.visibility ?? 'private',
    commonsTags: squad.commonsTags ?? null,
    createdAtMs: squad.createdAt,
    updatedAtMs: squad.updatedAt,
  };
}

export async function listSquads(): Promise<Squad[]> {
  const rows = await invoke<SquadRowWire[]>('list_squads');
  const loaded: Squad[] = [];
  for (const row of rows) {
    try {
      if (row?.id) loaded.push(rowToSquad(row));
    } catch {
      // skip malformed row
    }
  }
  return loaded;
}

export async function getSquad(id: string): Promise<Squad | null> {
  const row = await invoke<SquadRowWire | null>('get_squad', { parentId: id });
  if (!row) return null;
  return rowToSquad(row);
}

export async function upsertSquad(squad: Squad): Promise<Squad> {
  const row = await invoke<SquadRowWire>('upsert_squad', { squad: squadToUpsert(squad) });
  return rowToSquad(row);
}

export async function deleteSquad(id: string): Promise<void> {
  await invoke('delete_squad', { parentId: id });
}

/** Load squads from SQLite into the store; restores hub selection after prefs are loaded. */
export async function hydrateSquadsFromDb(): Promise<void> {
  try {
    squads.set(await listSquads());
  } catch {
    squads.set([]);
  }
  restoreSquadsHubSelection();
}

/** Persist one squad row and merge the normalized backend row into the store. */
export async function persistSquad(squad: Squad): Promise<Squad> {
  const saved = await upsertSquad(squad);
  squads.update((list) => {
    const idx = list.findIndex((s) => s.id === saved.id);
    if (idx === -1) return [...list, saved];
    const next = [...list];
    next[idx] = saved;
    return next;
  });
  return saved;
}

/** Swap a temp creating id in the store, then persist the finalized squad. */
export async function persistCreatedSquad(tempId: string, squad: Squad): Promise<Squad> {
  squads.update((list) => list.map((s) => (s.id !== tempId ? s : squad)));
  return persistSquad(squad);
}

/** Apply a patch in the store, then upsert the merged row. */
export async function persistSquadPatch(
  parentId: string,
  patch: (squad: Squad) => Squad,
): Promise<Squad | null> {
  const current = get(squads).find((s) => s.id === parentId);
  if (!current) return null;
  const patched = normalizeSquadFromStorage(patch({ ...current, updatedAt: Date.now() }));
  squads.update((list) => list.map((s) => (s.id !== parentId ? s : patched)));
  return persistSquad(patched);
}

export function updateChannelNameIfPlaceholder(groupId: string, newName: string): void {
  if (!newName || typeof newName !== 'string') return;
  const name = newName.trim();
  if (!name) return;

  const parentIds = new Set<string>();
  squads.update((list) =>
    list.map((s) => {
      let changed = false;
      const channels = s.channels.map((ch) => {
        if (ch.groupId === groupId && isPlaceholderChannelName(groupId, ch.name)) {
          changed = true;
          return { ...ch, name };
        }
        return ch;
      });
      if (changed) parentIds.add(s.id);
      return changed ? { ...s, channels, updatedAt: Date.now() } : s;
    }),
  );
  ungroupedChannels.update((list) =>
    list.map((ch) =>
      ch.groupId === groupId && isPlaceholderChannelName(groupId, ch.name) ? { ...ch, name } : ch,
    ),
  );
  for (const parentId of parentIds) {
    const squad = get(squads).find((s) => s.id === parentId);
    if (squad) void persistSquad(squad);
  }
}
