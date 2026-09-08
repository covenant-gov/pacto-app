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
import { squadNavOrder } from '../../stores/navigation';
import { reconcileSquadNavOrder, replaceSquadNavId, appendSquadNavId } from './squad-nav-order';
import { channelDefaultsFromSquad, remapActiveSquadNavigation } from './squad-navigation';
import { dmError } from '../utils/dm-debug';

function isInFlightSquadId(id: string): boolean {
  return id.startsWith('creating-squad-') || id.startsWith('creating-squad-pair-');
}

function inFlightSquads(list: Squad[]): Squad[] {
  return list.filter((s) => isInFlightSquadId(s.id));
}

function mergeListedWithInFlight(listed: Squad[], inFlight: Squad[]): Squad[] {
  if (inFlight.length === 0) return listed;
  const listedIds = new Set(listed.map((s) => s.id));
  const merged = [...listed];
  for (const placeholder of inFlight) {
    if (!listedIds.has(placeholder.id)) merged.push(placeholder);
  }
  return merged;
}

interface SquadChannelWire {
  name: string;
  groupId: string;
  order: number;
  access?: 'open' | 'closed';
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
    channels: squad.channels.map((c) => ({
      name: c.name,
      groupId: c.groupId,
      order: c.order,
      ...(c.access === 'open' || c.access === 'closed' ? { access: c.access } : {}),
    })),
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

async function listSquadsWithRetry(): Promise<Squad[] | null> {
  try {
    return await listSquads();
  } catch (e) {
    dmError('list_squads failed', e);
    try {
      return await listSquads();
    } catch (e2) {
      dmError('list_squads retry failed', e2);
      return null;
    }
  }
}

/** Load squads from SQLite into the store; restores hub selection after prefs are loaded. */
export async function hydrateSquadsFromDb(): Promise<void> {
  const inFlight = inFlightSquads(get(squads));
  const listed = await listSquadsWithRetry();
  if (listed) {
    const merged = mergeListedWithInFlight(listed, inFlight);
    squads.set(merged);
    squadNavOrder.update((order) => reconcileSquadNavOrder(order, merged));
  } else if (inFlight.length > 0) {
    squads.set(inFlight);
    squadNavOrder.update((order) => reconcileSquadNavOrder(order, inFlight));
  } else {
    squads.set([]);
    squadNavOrder.update((order) => reconcileSquadNavOrder(order, []));
  }
  const { recoverMissingSquadCatalog, enrichRecoveredSquadNamesFromInvites } = await import(
    './squad-catalog-recover'
  );
  await recoverMissingSquadCatalog();
  void enrichRecoveredSquadNamesFromInvites();
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
  squadNavOrder.update((order) => appendSquadNavId(order, saved.id));
  return saved;
}

/** Persist the finalized squad, then swap the temp creating id in the store. */
export async function persistCreatedSquad(tempId: string, squad: Squad): Promise<Squad> {
  const saved = await persistSquad(squad);
  squads.update((list) => list.filter((s) => s.id !== tempId));
  squadNavOrder.update((order) => replaceSquadNavId(order, tempId, saved.id));
  remapActiveSquadNavigation(tempId, saved.id, channelDefaultsFromSquad(saved));
  return saved;
}

const squadPatchQueue = new Map<string, Promise<unknown>>();

async function persistSquadPatchNow(
  parentId: string,
  patch: (squad: Squad) => Squad,
): Promise<Squad | null> {
  const current = get(squads).find((s) => s.id === parentId);
  if (!current) return null;
  const patched = normalizeSquadFromStorage(patch({ ...current, updatedAt: Date.now() }));
  squads.update((list) => list.map((s) => (s.id !== parentId ? s : patched)));
  return persistSquad(patched);
}

/** Apply a patch in the store, then upsert the merged row. Serialized per parent. */
export async function persistSquadPatch(
  parentId: string,
  patch: (squad: Squad) => Squad,
): Promise<Squad | null> {
  const prev = squadPatchQueue.get(parentId) ?? Promise.resolve();
  const next = prev.then(
    () => persistSquadPatchNow(parentId, patch),
    () => persistSquadPatchNow(parentId, patch),
  );
  squadPatchQueue.set(parentId, next);
  try {
    return await next;
  } finally {
    if (squadPatchQueue.get(parentId) === next) {
      squadPatchQueue.delete(parentId);
    }
  }
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
