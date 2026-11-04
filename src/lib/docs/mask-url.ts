import { isTrackingName, stripTrackingParamsFromUrl } from '../utils/url-tracking';

/** Query names whose values are masked or dropped (case-insensitive exact). Mirrors the backend list. */
export const SECRET_QUERY_NAMES = [
  'token',
  'access_token',
  'id_token',
  'refresh_token',
  'api_key',
  'apikey',
  'key',
  'secret',
  'sig',
  'signature',
  'auth',
  'password',
  'code',
] as const;

const SECRET_NAMES = new Set<string>(SECRET_QUERY_NAMES);
const MASK = '••••';

export function isSecretQueryName(name: string): boolean {
  return SECRET_NAMES.has(name.toLowerCase());
}

/** Absolute http or https URL. */
export function isHttpUrl(raw: string): boolean {
  try {
    const { protocol } = new URL(raw);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

interface UrlParts {
  /** Scheme, authority, and path as written. */
  prefix: string;
  /** Raw query after `?`, or null when there is no `?`. */
  query: string | null;
  /** Raw fragment after `#`, or null when there is no `#`. */
  fragment: string | null;
  hostname: string;
  pathname: string;
}

/** Split an http(s) URL on its original text so encoding is preserved. Null for anything else. */
export function splitHttpUrl(raw: string): UrlParts | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const hash = raw.indexOf('#');
  const beforeFrag = hash === -1 ? raw : raw.slice(0, hash);
  const queryAt = beforeFrag.indexOf('?');
  return {
    prefix: queryAt === -1 ? beforeFrag : beforeFrag.slice(0, queryAt),
    query: queryAt === -1 ? null : beforeFrag.slice(queryAt + 1),
    fragment: hash === -1 ? null : raw.slice(hash + 1),
    hostname: parsed.hostname,
    pathname: parsed.pathname,
  };
}

function splitPair(part: string): { name: string; value: string } {
  const eq = part.indexOf('=');
  return eq === -1 ? { name: part, value: '' } : { name: part.slice(0, eq), value: part.slice(eq + 1) };
}

/** Display form: non-empty fragment → `#••••`; secret or tracker values → `name=••••`. Non-http(s) unchanged. */
export function maskDocUrl(raw: string): string {
  const parts = splitHttpUrl(raw);
  if (!parts) return raw;
  let out = parts.prefix;
  if (parts.query != null) {
    const masked = parts.query.split('&').map((part) => {
      const { name, value } = splitPair(part);
      if (!value) return part;
      if (isSecretQueryName(name) || isTrackingName(name, parts.hostname, parts.pathname)) return `${name}=${MASK}`;
      return part;
    });
    out += `?${masked.join('&')}`;
  }
  if (parts.fragment != null) out += parts.fragment ? `#${MASK}` : '#';
  return out;
}

/**
 * Link-preview fetch candidate: drop the fragment and every secret-name pair, then catalog trackers.
 * `stripTrackers: false` keeps trackers for users who turned tracker stripping off.
 */
export function previewCandidateUrl(raw: string, options: { stripTrackers?: boolean } = {}): string {
  const parts = splitHttpUrl(raw);
  if (!parts) return raw;
  let out = parts.prefix;
  if (parts.query != null) {
    const kept = parts.query.split('&').filter((part) => !isSecretQueryName(splitPair(part).name));
    if (kept.some((part) => part !== '')) out += `?${kept.join('&')}`;
  }
  return options.stripTrackers === false ? out : stripTrackingParamsFromUrl(out);
}

/** Commons warning: non-empty fragment or a non-empty secret query value. Trackers alone do not count. */
export function hasKeyedSecret(raw: string): boolean {
  const parts = splitHttpUrl(raw);
  if (!parts) return false;
  if (parts.fragment) return true;
  if (parts.query == null) return false;
  return parts.query.split('&').some((part) => {
    const { name, value } = splitPair(part);
    return value !== '' && isSecretQueryName(name);
  });
}
