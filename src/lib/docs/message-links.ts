import type { SquadDocDto } from '../api/squad-docs';
import { isTrackingName, URL_REGEX_SOURCE } from '../utils/url-tracking';
import { isSecretQueryName, splitHttpUrl } from './mask-url';

export interface MessageDocLink {
  url: string;
  /** Markdown link text when it differs from the URL. */
  label: string | null;
}

/** Markdown `[label](` opener; the destination is read with the shared URL scan. */
const MARKDOWN_LINK_OPEN = /\[([^[\]\n]*)\]\(/g;

interface Found {
  index: number;
  url: string;
  label: string | null;
}

/** Fragment and non-empty secret query values of `url`, raw and decoded. */
function secretFragments(url: string): string[] {
  const parts = splitHttpUrl(url);
  if (!parts) return [];
  const secrets: string[] = [];
  if (parts.fragment) secrets.push(parts.fragment);
  for (const part of (parts.query ?? '').split('&')) {
    const eq = part.indexOf('=');
    if (eq === -1 || !isSecretQueryName(part.slice(0, eq))) continue;
    const value = part.slice(eq + 1);
    if (value) secrets.push(value);
  }
  return secrets.flatMap((s) => {
    try {
      const decoded = decodeURIComponent(s);
      return decoded === s ? [s] : [s, decoded];
    } catch {
      return [s];
    }
  });
}

/** Link text as a title prefill; null when it repeats the URL or carries its fragment or a secret value. */
function labelFor(label: string, url: string): string | null {
  const trimmed = label.trim();
  if (!trimmed || trimmed === url) return null;
  return secretFragments(url).some((secret) => trimmed.includes(secret)) ? null : trimmed;
}

/** http(s) links in message text in order of appearance, deduped by `docIdentityKey`. */
export function extractMessageDocLinks(content: string): MessageDocLink[] {
  if (!content) return [];
  const found: Found[] = [];
  let rest = content;

  for (const open of content.matchAll(MARKDOWN_LINK_OPEN)) {
    const urlStart = open.index + open[0].length;
    const scan = new RegExp(URL_REGEX_SOURCE, 'y');
    scan.lastIndex = urlStart;
    const hit = scan.exec(content);
    if (!hit) continue;
    const close = hit[1].indexOf(')');
    const url = close === -1 ? hit[1] : hit[1].slice(0, close);
    if (!splitHttpUrl(url)) continue;
    found.push({ index: open.index, url, label: labelFor(open[1], url) });
    const spanEnd = urlStart + url.length + (content[urlStart + url.length] === ')' ? 1 : 0);
    rest = rest.slice(0, open.index) + ' '.repeat(spanEnd - open.index) + rest.slice(spanEnd);
  }

  for (const hit of rest.matchAll(new RegExp(URL_REGEX_SOURCE, 'g'))) {
    if (splitHttpUrl(hit[1])) found.push({ index: hit.index, url: hit[1], label: null });
  }

  found.sort((a, b) => a.index - b.index);
  const byKey = new Map<string, MessageDocLink>();
  for (const { url, label } of found) {
    const key = docIdentityKey(url);
    const existing = byKey.get(key);
    if (!existing) byKey.set(key, { url, label });
    else if (!existing.label && label) existing.label = label;
  }
  return [...byKey.values()];
}

/** Title prefill: link text, else hostname. */
export function defaultDocTitle(link: MessageDocLink): string {
  if (link.label) return link.label;
  try {
    return new URL(link.url).hostname || link.url;
  } catch {
    return link.url;
  }
}

/** Dedup identity: lowercased host, path, non-secret non-tracker query, and fragment. Scheme is ignored. */
export function docIdentityKey(url: string): string {
  const parts = splitHttpUrl(url);
  if (!parts) return url.trim();
  const { host, pathname } = new URL(url);
  const query = (parts.query ?? '')
    .split('&')
    .filter((part) => {
      if (!part) return false;
      const eq = part.indexOf('=');
      const name = eq === -1 ? part : part.slice(0, eq);
      return !isSecretQueryName(name) && !isTrackingName(name, parts.hostname, parts.pathname);
    })
    .join('&');
  let key = `${host.toLowerCase()}${pathname}`;
  if (query) key += `?${query}`;
  if (parts.fragment) key += `#${parts.fragment}`;
  return key;
}

/** Visible shelf row with the same identity as `url`, if any. */
export function findExistingDoc(rows: SquadDocDto[], url: string): SquadDocDto | null {
  const key = docIdentityKey(url);
  return rows.find((row) => docIdentityKey(row.url) === key) ?? null;
}
