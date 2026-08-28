import { convertFileSrc } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import type { NostrProfile } from '../api/nostr';
import { torRoutingEnabled } from '../../stores/tor';

/** True when running inside Tauri WebView (so convertFileSrc works). In browser dev, false. */
function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as { __TAURI__?: unknown }).__TAURI__;
}

/** True if the string looks like a filesystem path - must not be used as img src. */
function isLikelyFilePath(s: string): boolean {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  return t.startsWith('/') || t.startsWith('file:') || /^[A-Za-z]:[\\/]/.test(t);
}

/** True if the string is an http(s) URL - safe to use as img src and loads from Nostr. */
function isHttpUrl(s: string): boolean {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim().toLowerCase();
  return t.startsWith('http://') || t.startsWith('https://');
}

/** True if the string is an https URL — required for peer-supplied squad icons. */
export function isHttpsUrl(s: string): boolean {
  if (!s || typeof s !== 'string') return false;
  return s.trim().toLowerCase().startsWith('https://');
}

/**
 * Resolves an `<img src>` for content that may come from a remote URL or a
 * path the backend already cached locally (via its Tor-aware image cache).
 *
 * While Tor routing is enabled, the remote URL is never used: rendering it
 * directly fetches it through the webview's own network stack, which never
 * touches the local SOCKS proxy and would leak the real IP regardless of the
 * setting. In that case only the cached path counts, and the image is
 * omitted (not leaked via a remote fallback) until the backend has fetched
 * and cached it. When Tor is off this preserves the original remote-first
 * behavior exactly.
 *
 * Reads the store with `get()` rather than a subscription, so a mid-session
 * Tor toggle self-corrects on the next re-render rather than updating every
 * already-rendered image instantly -- an acceptable tradeoff against
 * threading a reactive parameter through every call site.
 */
export function cachedOrRemoteImageSrc(
  remoteUrl: string | null | undefined,
  cachedPath: string | null | undefined
): string | null {
  const torActive = get(torRoutingEnabled);
  const url = remoteUrl?.trim();

  if (!torActive && url && isHttpUrl(url)) return url;

  if (cachedPath && isTauri()) {
    const src = convertFileSrc(cachedPath);
    if (!isLikelyFilePath(src)) return src;
  }

  return null;
}

/**
 * Get the display name for a profile.
 * Prefer Vector nickname, then Nostr name/display_name, then short npub.
 */
export function getProfileDisplayName(profile: NostrProfile | null | undefined): string {
  if (!profile) return 'Unknown';
  const name = profile.nickname?.trim() || profile.name?.trim() || profile.display_name?.trim();
  if (name) return name;
  if (profile.id) return profile.id.slice(0, 16);
  return 'Unknown';
}

/**
 * Get the avatar URL for a profile
 * Prefers cached local file (for offline support), falls back to remote URL
 * @param profile - The profile object
 * @returns The avatar URL to use, or null if none available
 */
export function getProfileAvatarSrc(profile: NostrProfile | null | undefined): string | null {
  if (!profile) return null;

  const src = cachedOrRemoteImageSrc(profile.avatar, profile.avatar_cached);
  if (src) return src;

  // Fallback: avatar set but not http (e.g. a data: URI) and not path-like --
  // never a network fetch either way, so it's safe regardless of Tor state.
  // Must exclude http(s) URLs explicitly: an http avatar reaches this line
  // when Tor blocked it above (no cached path yet), and returning it here
  // would silently defeat that block.
  const remoteUrl = profile.avatar?.trim();
  if (remoteUrl && !isLikelyFilePath(remoteUrl) && !isHttpUrl(remoteUrl)) return remoteUrl;
  return null;
}

/**
 * Get the banner URL for a profile
 * Prefers cached local file (for offline support), falls back to remote URL
 * @param profile - The profile object
 * @returns The banner URL to use, or null if none available
 */
export function getProfileBannerSrc(profile: NostrProfile | null | undefined): string | null {
  if (!profile) return null;

  const src = cachedOrRemoteImageSrc(profile.banner, profile.banner_cached);
  if (src) return src;

  // See getProfileAvatarSrc's fallback comment: must exclude http(s) so a
  // Tor-blocked banner URL can't leak back out through this branch.
  const remoteUrl = profile.banner?.trim();
  if (remoteUrl && !isLikelyFilePath(remoteUrl) && !isHttpUrl(remoteUrl)) return remoteUrl;
  return null;
}
