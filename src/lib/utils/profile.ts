import { convertFileSrc } from '@tauri-apps/api/core';
import type { NostrProfile } from '../api/nostr';

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

/**
 * Get the display name for a profile (PFP_FLOW §1).
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
  
  // Prefer remote Nostr URL when present so profile pictures load (asset scope may block cached paths).
  const remoteUrl = profile.avatar?.trim();
  if (remoteUrl && isHttpUrl(remoteUrl)) return remoteUrl;
  
  // In Tauri WebView: try cached path via convertFileSrc for offline support.
  if (profile.avatar_cached && isTauri()) {
    const src = convertFileSrc(profile.avatar_cached);
    if (!isLikelyFilePath(src)) return src;
  }
  
  // Fallback: avatar set but not http (e.g. relative or other) and not path-like
  if (remoteUrl && !isLikelyFilePath(remoteUrl)) return remoteUrl;
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
  
  const remoteUrl = profile.banner?.trim();
  if (remoteUrl && isHttpUrl(remoteUrl)) return remoteUrl;
  
  if (profile.banner_cached && isTauri()) {
    const src = convertFileSrc(profile.banner_cached);
    if (!isLikelyFilePath(src)) return src;
  }
  
  if (remoteUrl && !isLikelyFilePath(remoteUrl)) return remoteUrl;
  return null;
}
