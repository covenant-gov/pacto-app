import { invoke } from './index';
import { persistenceKey } from '../../stores/persistence-context';
import { getInvokeErrorMessage } from '../utils/tauri-errors';

/** One Klipy GIF result. `previewUrl`/`fullUrl` are passed through byte-identical — never rewritten. */
export interface KlipyGif {
  id: string;
  slug: string;
  title: string;
  previewUrl: string;
  fullUrl: string;
  width: number;
  height: number;
}

/** One page of Klipy results (search or trending). */
export interface KlipyPage {
  items: KlipyGif[];
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
}

const DISCLOSURE_ACCEPTED_PREFIX = 'pacto_klipy_gifs_disclosure_accepted_v1';

/** Whether the current account has accepted the one-time Klipy disclosure. Npub-scoped. */
export function isGifsDisclosureAccepted(): boolean {
  if (typeof localStorage === 'undefined') return false;
  const key = persistenceKey(DISCLOSURE_ACCEPTED_PREFIX);
  if (!key) return false;
  return localStorage.getItem(key) === '1';
}

/** Persist Klipy disclosure acceptance for the current account. */
export function acceptGifsDisclosure(): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(DISCLOSURE_ACCEPTED_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* storage unavailable; the caller keeps in-memory acceptance for this session */
  }
}

/**
 * Fail-closed guard: every Klipy request wrapper below calls this first, so no
 * request can leave the device before the account has accepted the disclosure.
 */
function assertGifsDisclosureAccepted(): void {
  if (!isGifsDisclosureAccepted()) {
    throw new Error('Klipy disclosure not yet accepted');
  }
}

/** Search Klipy GIFs. Backend: klipy_search_gifs. */
export async function searchGifs(query: string, page: number): Promise<KlipyPage> {
  assertGifsDisclosureAccepted();
  try {
    return await invoke('klipy_search_gifs', { query, page });
  } catch (e) {
    throw new Error(getInvokeErrorMessage(e), { cause: e });
  }
}

/** Trending Klipy GIFs, shown when the search box is empty. Backend: klipy_trending_gifs. */
export async function trendingGifs(page: number): Promise<KlipyPage> {
  assertGifsDisclosureAccepted();
  try {
    return await invoke('klipy_trending_gifs', { page });
  } catch (e) {
    throw new Error(getInvokeErrorMessage(e), { cause: e });
  }
}

/** Fire Klipy's share-trigger callback for a picked GIF. Backend: klipy_report_share. */
export async function reportGifShare(slug: string, query?: string): Promise<boolean> {
  assertGifsDisclosureAccepted();
  try {
    return await invoke('klipy_report_share', { slug, query: query ?? null });
  } catch (e) {
    throw new Error(getInvokeErrorMessage(e), { cause: e });
  }
}

/**
 * Whether the backend has a Klipy API key configured. Not gated on disclosure
 * acceptance: it is a local capability check and reaches no third party.
 * Backend: klipy_is_configured.
 */
export async function klipyIsConfigured(): Promise<boolean> {
  try {
    return await invoke('klipy_is_configured');
  } catch (e) {
    throw new Error(getInvokeErrorMessage(e), { cause: e });
  }
}

/** Debounce window for GIFs search input, matching the manual setTimeout pattern in wake-sync.ts. */
export const GIFS_SEARCH_DEBOUNCE_MS = 400;

/** Timer handle returned by setTimeout; alias keeps the variable type local. */
type GifsTimerHandle = ReturnType<typeof setTimeout>;

/**
 * Collapse rapid GIFs-tab keystrokes into a single `fetchPage(query, 1)` call after
 * `GIFS_SEARCH_DEBOUNCE_MS` of quiet. Testing-tier Klipy keys allow only 100 requests/hour,
 * so a per-keystroke request would exhaust the quota in under a minute.
 */
export function createGifsSearchScheduler(
  fetchPage: (query: string, page: number) => void
): { scheduleSearch: (query: string) => void; cancel: () => void } {
  let timer: GifsTimerHandle | null = null;
  return {
    scheduleSearch(query: string) {
      clearTimeout(timer ?? undefined);
      timer = setTimeout(() => {
        timer = null;
        fetchPage(query, 1);
      }, GIFS_SEARCH_DEBOUNCE_MS);
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/** Sends a picked GIF as a lightweight, unencrypted attachment carrying the
 * Klipy URL byte-identical. Never uploads or re-hosts the media — Klipy's
 * terms forbid it (see docs/messaging/GIF_PROVIDER.md). Not gated on the
 * disclosure flag: the search tab is the opt-in gate; sending a GIF already
 * picked from it is not a new request.
 * Backend: klipy_gif_message. */
export async function sendGifMessage(
  receiver: string,
  url: string,
  slug: string,
  repliedTo: string
): Promise<boolean> {
  try {
    return await invoke('klipy_gif_message', { receiver, url, slug, repliedTo });
  } catch (e) {
    throw new Error(getInvokeErrorMessage(e), { cause: e });
  }
}

/** Klipy's documented media CDN hosts (docs.klipy.com/network-requirements).
 * Convenience check only — `klipy_fetch_media` enforces this in Rust, which
 * is the actual boundary against a hostile message turning this into an
 * SSRF/IP-disclosure primitive. */
const KLIPY_MEDIA_HOSTS: Record<string, true> = {
  'static.klipy.com': true,
  'static1.klipy.com': true,
  'static2.klipy.com': true,
};

export function isKlipyMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && KLIPY_MEDIA_HOSTS[parsed.hostname] === true;
  } catch {
    return false;
  }
}

/** Fetches Klipy media bytes through the Rust egress chokepoint for an in-memory
 * render. Never persisted to disk (Klipy's no-retain terms). Backend: klipy_fetch_media. */
export async function fetchGifMedia(url: string): Promise<Uint8Array> {
  try {
    const buf = await invoke<ArrayBuffer>('klipy_fetch_media', { url });
    return new Uint8Array(buf);
  } catch (e) {
    throw new Error(getInvokeErrorMessage(e), { cause: e });
  }
}

/** Wraps {@link fetchGifMedia} bytes in a `blob:` URL for a DOM `src`
 * attribute. This is the only path by which Klipy media reaches a DOM `src`
 * — the caller owns the object URL and must call `URL.revokeObjectURL` once
 * it is no longer displayed. */
export async function fetchGifBlobUrl(url: string): Promise<string> {
  const bytes = await fetchGifMedia(url);
  return URL.createObjectURL(new Blob([bytes], { type: 'image/gif' }));
}
