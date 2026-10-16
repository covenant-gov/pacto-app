/** Boundary used when linkifying and when stripping trackers from prose. */
export const URL_REGEX_SOURCE = String.raw`(https?:\/\/[^\s<>"']+?)([.,;:!?)\]'"]*)(?=\s|$|<|>)`;

export const TRACKING_PARAM_PREFIXES = ['utm_'] as const;

export const TRACKING_PARAM_NAMES = [
  'fbclid',
  'gclid',
  'dclid',
  'gclsrc',
  'gbraid',
  'wbraid',
  'msclkid',
  'mc_eid',
  'mc_cid',
  'twclid',
  'ttclid',
  'yclid',
  'srsltid',
  '_ga',
  '_gl',
  '_openstat',
  'wickedid',
  '_hsenc',
  '_hsmi',
  '__hsfp',
  '__hssc',
  '__hstc',
  'hsCtaTracking',
  'mkt_tok',
  'oly_anon_id',
  'oly_enc_id',
  'vero_id',
  'vero_conv',
] as const;

export const HOST_SCOPED_TRACKING_PARAMS = [
  { hosts: ['youtube.com', 'youtu.be', 'open.spotify.com'], names: ['si'] },
  { hosts: ['instagram.com'], names: ['igsh', 'igshid'] },
  { hosts: ['threads.net', 'threads.com'], names: ['igshid'] },
  { hosts: ['x.com', 'twitter.com'], names: ['ref_src', 'ref_url', 'refsrc'] },
] as const;

const EXACT_NAMES = new Set(TRACKING_PARAM_NAMES.map((name) => name.toLowerCase()));

const REPLY_QUOTE_LIMIT = 80;

function hostMatches(hostname: string, rule: string): boolean {
  const host = hostname.toLowerCase();
  const needle = rule.toLowerCase();
  return host === needle || host.endsWith(`.${needle}`);
}

function isTrackingName(name: string, hostname: string, pathname: string): boolean {
  const lower = name.toLowerCase();
  if (TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  if (EXACT_NAMES.has(lower)) {
    if (lower === 'mkt_tok' && pathname.toLowerCase().includes('unsubscribe')) return false;
    return true;
  }
  for (const rule of HOST_SCOPED_TRACKING_PARAMS) {
    if (!rule.names.some((entry) => entry.toLowerCase() === lower)) continue;
    if (rule.hosts.some((host) => hostMatches(hostname, host))) return true;
  }
  return false;
}

function pairName(part: string): string {
  const eq = part.indexOf('=');
  return eq === -1 ? part : part.slice(0, eq);
}

/** Drop matching names and rejoin the original slices. */
function stripPairs(section: string, hostname: string, pathname: string): string {
  return section
    .split('&')
    .filter((part) => part === '' || !isTrackingName(pairName(part), hostname, pathname))
    .join('&');
}

/**
 * Remove catalog tracking parameters from one absolute http(s) URL.
 * Malformed and non-http(s) inputs are returned unchanged.
 */
export function stripTrackingParamsFromUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return input;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return input;

  const hash = input.indexOf('#');
  const beforeFrag = hash === -1 ? input : input.slice(0, hash);
  const fragment = hash === -1 ? null : input.slice(hash + 1);
  const queryAt = beforeFrag.indexOf('?');
  const prefix = queryAt === -1 ? beforeFrag : beforeFrag.slice(0, queryAt);
  const query = queryAt === -1 ? null : beforeFrag.slice(queryAt + 1);

  const nextQuery = query == null ? null : stripPairs(query, parsed.hostname, parsed.pathname);
  const nextFragment =
    fragment != null && fragment.includes('=')
      ? stripPairs(fragment, parsed.hostname, parsed.pathname)
      : fragment;

  let out = prefix;
  if (nextQuery) out += `?${nextQuery}`;
  if (nextFragment) out += `#${nextFragment}`;
  return out;
}

/** Strip catalog parameters from each http(s) URL in text. Trailing punctuation stays put. */
export function stripTrackingParamsFromText(text: string): string {
  if (!text) return text;
  const re = new RegExp(URL_REGEX_SOURCE, 'g');
  return text.replace(re, (_full, url: string, trail: string) => stripTrackingParamsFromUrl(url) + (trail ?? ''));
}

/** Reply-quote chip: strip when enabled, then keep the first 80 characters. */
export function replyQuoteExcerpt(content: string, enabled: boolean): string {
  const text = enabled ? stripTrackingParamsFromText(content) : content;
  const sliced = text.slice(0, REPLY_QUOTE_LIMIT).trim();
  return sliced + (text.length > REPLY_QUOTE_LIMIT ? '…' : '');
}

/**
 * HTTPS spans the preview fetcher will request.
 * Matches the backend scanner: stop on whitespace or `" < > ) ] } |`, then trim `. , : ;`.
 */
export function extractPreviewHttpsUrls(text: string): string[] {
  const urls: string[] = [];
  let start = 0;
  while (start < text.length) {
    const idx = text.indexOf('https://', start);
    if (idx === -1) break;
    const urlText = text.slice(idx);
    let end = urlText.length;
    for (let i = 0; i < urlText.length; i++) {
      const c = urlText[i];
      if (
        /\s/.test(c) ||
        c === '"' ||
        c === '<' ||
        c === '>' ||
        c === ')' ||
        c === ']' ||
        c === '}' ||
        c === '|'
      ) {
        end = i;
        break;
      }
    }
    while (end > 0) {
      const last = urlText[end - 1];
      if (last === '.' || last === ',' || last === ':' || last === ';') end -= 1;
      else break;
    }
    if (end > 'https://'.length) urls.push(urlText.slice(0, end));
    start = idx + 1;
  }
  return urls;
}
