import { writable } from 'svelte/store';
import { persistenceKey } from '../../stores/persistence-context';

export const PACTO_COMMONS_HIDDEN_BROADCASTS_PREFIX = 'pacto_commons_hidden_broadcasts';
export const PACTO_COMMONS_HIDDEN_CATEGORIES_PREFIX = 'pacto_commons_hidden_categories';

/** Bumps whenever hidden broadcast/category state changes so Commons UI reacts without a remount. */
export const commonsHiddenRevision = writable(0);

/** Snapshot of a hidden broadcast, kept so the "manage hidden" list can render after the broadcast expires. */
export interface HiddenCommonsBroadcastRecord {
  eventId: string;
  title: string;
  subtitle: string;
  tags: string[];
  hiddenAt: number;
}

/** JSON-serialized to localStorage; a `Map` would need manual (de)serialization for no behavioral gain. */
type HiddenBroadcastMap = Record<string, HiddenCommonsBroadcastRecord>;

function readHiddenBroadcastMap(): HiddenBroadcastMap {
  if (typeof localStorage === 'undefined') return {};
  const key = persistenceKey(PACTO_COMMONS_HIDDEN_BROADCASTS_PREFIX);
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as HiddenBroadcastMap) : {};
  } catch {
    return {};
  }
}

function writeHiddenBroadcastMap(map: HiddenBroadcastMap): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(PACTO_COMMONS_HIDDEN_BROADCASTS_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore quota
  }
}

/** Hide a broadcast; non-destructive, reversible via `unhideCommonsBroadcast`. */
export function hideCommonsBroadcast(record: Omit<HiddenCommonsBroadcastRecord, 'hiddenAt'>): void {
  const id = record.eventId.trim();
  if (!id) return;
  const map = readHiddenBroadcastMap();
  map[id] = { ...record, eventId: id, hiddenAt: Math.floor(Date.now() / 1000) };
  writeHiddenBroadcastMap(map);
  commonsHiddenRevision.update((n) => n + 1);
}

export function unhideCommonsBroadcast(eventId: string): void {
  const id = eventId.trim();
  if (!id) return;
  const map = readHiddenBroadcastMap();
  if (!(id in map)) return;
  delete map[id];
  writeHiddenBroadcastMap(map);
  commonsHiddenRevision.update((n) => n + 1);
}

/** All hidden broadcasts, newest-hidden first, for the "manage hidden commons" settings list. */
export function getHiddenCommonsBroadcasts(): HiddenCommonsBroadcastRecord[] {
  return Object.values(readHiddenBroadcastMap()).sort((a, b) => b.hiddenAt - a.hiddenAt);
}

/** Hidden broadcast event ids, for excluding them from the live feed. */
export function getHiddenCommonsBroadcastIds(): Set<string> {
  return new Set(Object.keys(readHiddenBroadcastMap()));
}

/** Hidden default-category ids, for excluding their tiles from the browse grid and listing in settings. */
export function getHiddenCommonsCategoryIds(): string[] {
  if (typeof localStorage === 'undefined') return [];
  const key = persistenceKey(PACTO_COMMONS_HIDDEN_CATEGORIES_PREFIX);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeHiddenCategoryIds(ids: string[]): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(PACTO_COMMONS_HIDDEN_CATEGORIES_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // ignore quota
  }
}

/** Hide a default Commons category tile; non-destructive, reversible via `unhideCommonsCategory`. */
export function hideCommonsCategory(categoryId: string): void {
  const id = categoryId.trim();
  if (!id) return;
  const ids = getHiddenCommonsCategoryIds();
  if (ids.includes(id)) return;
  writeHiddenCategoryIds([...ids, id]);
  commonsHiddenRevision.update((n) => n + 1);
}

export function unhideCommonsCategory(categoryId: string): void {
  const id = categoryId.trim();
  const ids = getHiddenCommonsCategoryIds();
  if (!ids.includes(id)) return;
  writeHiddenCategoryIds(ids.filter((x) => x !== id));
  commonsHiddenRevision.update((n) => n + 1);
}
