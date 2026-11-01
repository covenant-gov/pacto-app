import { persistenceKey } from '../../stores/persistence-context';
import { compareVersions, parseVersion } from './version-compare';

export interface WhatsNewItem {
  kind: 'new' | 'improved' | 'fixed';
  title: { en: string; es: string };
  detail: { en: string; es: string };
}
export interface WhatsNewRelease { version: string; items: WhatsNewItem[] }
export interface WhatsNewAnnouncement { version: string; releases: WhatsNewRelease[]; storageKey: string }
export type NotesLoaders = Record<string, () => Promise<unknown>>;
const bundledNotes: NotesLoaders = import.meta.glob('/whats-new/*.json', { import: 'default' });
const SEEN_PREFIX = 'pacto_whats_new_seen';
const markerRevisions = new Map<string, number>();
function advanceMarkerRevision(key: string): number {
  const revision = (markerRevisions.get(key) ?? 0) + 1;
  markerRevisions.set(key, revision);
  return revision;
}

export function whatsNewStorageKey(): string | null { return persistenceKey(SEEN_PREFIX); }

/** Only in-app updates establish an origin; normal launches never enroll fresh installs. */
export function rememberVersionBeforeUpdate(version: string, key = whatsNewStorageKey()): () => void {
  const noop = () => {};
  const current = parseVersion(version);
  if (!key || key !== whatsNewStorageKey() || !current) return noop;
  try {
    const old = localStorage.getItem(key);
    const revision = advanceMarkerRevision(key);
    const previous = old && parseVersion(old);
    if (previous && compareVersions(previous, current) <= 0) return noop;
    localStorage.setItem(key, version);
    // A failed installer must not undo a newer update or a dismissal.
    return () => {
      try {
        if (markerRevisions.get(key) !== revision || localStorage.getItem(key) !== version) return;
        if (old === null) localStorage.removeItem(key);
        else localStorage.setItem(key, old);
        advanceMarkerRevision(key);
      } catch { /* Notes must never interrupt an update. */ }
    };
  } catch { return noop; }
}

function isRelease(value: unknown, expectedVersion: string): value is WhatsNewRelease {
  if (!value || typeof value !== 'object') return false;
  const release = value as WhatsNewRelease;
  const bilingual = (text: WhatsNewItem['title'], limit: number) => text && ['en', 'es'].every(language => {
    const value = text[language as 'en' | 'es'];
    return typeof value === 'string' && value.trim().length > 0 && Array.from(value).length <= limit;
  });
  return release.version === expectedVersion && Array.isArray(release.items) &&
    (release.items.length === 0 || (release.items.length >= 3 && release.items.length <= 6)) &&
    release.items.every(item => item && ['new', 'improved', 'fixed'].includes(item.kind) &&
      bilingual(item.title, 80) && bilingual(item.detail, 240));
}

export async function loadWhatsNew(currentVersion: string, loaders: NotesLoaders = bundledNotes): Promise<WhatsNewAnnouncement | null> {
  const key = whatsNewStorageKey();
  const current = parseVersion(currentVersion);
  if (!key || !current) return null;
  try {
    const origin = parseVersion(localStorage.getItem(key) ?? '');
    if (!origin || compareVersions(origin, current) >= 0) return null;
    const entries = Object.entries(loaders).flatMap(([path, load]) => {
      const version = path.split('/').at(-1)?.replace(/\.json$/, '') ?? '';
      const parsed = parseVersion(version);
      return parsed && compareVersions(parsed, origin) > 0 && compareVersions(parsed, current) <= 0
        ? [{ version, parsed, load }] : [];
    }).sort((a, b) => compareVersions(a.parsed, b.parsed));
    const releases: WhatsNewRelease[] = [];
    for (const entry of entries) {
      const release = await entry.load();
      if (!isRelease(release, entry.version)) return null;
      if (release.items.length) releases.push(release);
    }
    if (key !== whatsNewStorageKey()) return null;
    if (!releases.length) {
      advanceMarkerRevision(key);
      localStorage.setItem(key, currentVersion);
      return null;
    }
    return { version: currentVersion, releases, storageKey: key };
  } catch { return null; }
}

export function acknowledgeWhatsNew(announcement: WhatsNewAnnouncement): void {
  if (announcement.storageKey !== whatsNewStorageKey()) return;
  advanceMarkerRevision(announcement.storageKey);
  try { localStorage.setItem(announcement.storageKey, announcement.version); } catch { /* Dismiss in memory even when storage is unavailable. */ }
}
