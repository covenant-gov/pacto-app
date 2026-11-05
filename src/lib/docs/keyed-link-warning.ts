import { persistenceKey } from '../../stores/persistence-context';
import { URL_REGEX_SOURCE } from '../utils/url-tracking';
import { hasKeyedSecret } from './mask-url';

export const KEYED_LINK_WARNING_PREFIX = 'pacto_commons_keyed_link_warned_v1';

/** True when any http(s) URL in the text carries a fragment or secret query value. */
export function textHasKeyedLink(text: string): boolean {
  if (!text) return false;
  const re = new RegExp(URL_REGEX_SOURCE, 'g');
  for (const match of text.matchAll(re)) {
    if (hasKeyedSecret(match[1])) return true;
  }
  return false;
}

/** Public composers: warn before publishing a keyed link, once per npub. */
export function needsKeyedLinkWarning(text: string): boolean {
  if (!textHasKeyedLink(text)) return false;
  const key = typeof localStorage === 'undefined' ? null : persistenceKey(KEYED_LINK_WARNING_PREFIX);
  if (!key) return true;
  try {
    return localStorage.getItem(key) !== 'true';
  } catch {
    return true;
  }
}

/** Records the current npub's confirmation; call only when the member confirms. */
export function confirmKeyedLinkWarning(): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(KEYED_LINK_WARNING_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, 'true');
  } catch {
    // ignore
  }
}
