declare global {
  interface Window {
    hljs?: { highlight: (code: string, opts: { language: string }) => { value: string } };
    marked?: {
      use: (opts: object) => void;
      parse: (src: string, opts?: { async?: boolean }) => string;
    };
    twemoji?: {
      replace: (text: string, callback: (match: string) => string) => string;
      convert: { toCodePoint: (unicode: string, sep?: string) => string };
    };
    DOMPurify?: {
      sanitize: (dirty: string, config?: object) => string;
      addHook: (hook: string, cb: (currentNode: Element, data: unknown, config: unknown) => void) => void;
      removeHook: (hook: string, cb: (currentNode: Element, data: unknown, config: unknown) => void) => void;
    };
  }
}

import type { Mention } from '../messaging/mentions';
import type { NostrProfile } from '../api/nostr';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { locale } from '$lib/i18n';

function getDOMPurify(): Window['DOMPurify'] {
  return typeof window !== 'undefined' ? window.DOMPurify : undefined;
}

let markedConfigured = false;

function getMarked() {
  if (typeof window === 'undefined') return undefined;
  const m = window.marked;
  if (!m || markedConfigured) return m;
  m.use({
    gfm: true,
    breaks: true,
    extensions: [spoilerExtension],
    renderer: {
      code(token: unknown) {
        const codeToken = token as { text?: string; lang?: string };
        const raw = codeToken.text ?? '';
        const lang = codeToken.lang ?? 'plaintext';
        const highlighted = highlightCode(raw, lang);
        const langClass = lang ? `language-${escapeHtml(lang)}` : '';
        const dataRaw = escapeAttr(raw);
        const tFn = get(t);
        const copyCode = tFn('messaging.message.copyCode');
        const copy = tFn('messaging.message.copy');
        return `<div class="code-block-wrapper" data-raw-code="${dataRaw}"><pre><code class="hljs ${langClass}">${highlighted}</code></pre><button type="button" class="code-copy-btn" aria-label="${escapeAttr(copyCode)}" title="${escapeAttr(copyCode)}">${escapeHtml(copy)}</button></div>`;
      },
    },
  });
  markedConfigured = true;
  return m;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (ch) => map[ch] ?? ch);
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\r?\n/g, '&#10;');
}

function highlightCode(text: string, lang: string | undefined): string {
  const language = (lang ?? 'plaintext').toLowerCase();
  try {
    const hljs = typeof window !== 'undefined' ? window.hljs : undefined;
    if (hljs) {
      const result = hljs.highlight(text, { language });
      return result.value;
    }
    return escapeHtml(text);
  } catch {
    return escapeHtml(text);
  }
}

interface SpoilerToken {
  type: string;
  raw: string;
  text: string;
}

const spoilerExtension = {
  name: 'spoiler',
  level: 'inline' as const,
  start(src: string): number | void {
    const idx = src.indexOf('||');
    return idx === -1 ? undefined : idx;
  },
  tokenizer(src: string): SpoilerToken | undefined {
    const match = src.match(/^\|\|([\s\S]*?)\|\|/);
    if (match) {
      return {
        type: 'spoiler',
        raw: match[0],
        text: match[1],
      };
    }
  },
  renderer(token: SpoilerToken): string {
    return `<span class="spoiler" role="button" tabindex="0">${escapeHtml(token.text ?? '')}</span>`;
  },
};

/**
 * Map emoji character(s) to Twemoji SVG filename (e.g. "🌈" → "1f308.svg", "🇺🇸" → "1f1fa-1f1f8.svg").
 * Used for local /twemoji/svg/<filename>.svg. Returns null if not a valid replacement.
 */
export function emojiToTwemojiFilename(emoji: string): string | null {
  if (!emoji?.length) return null;
  const parts: string[] = [];
  for (let i = 0; i < emoji.length; ) {
    const cp = emoji.codePointAt(i);
    if (cp == null) break;
    parts.push(cp.toString(16).toLowerCase());
    i += cp > 0xffff ? 2 : 1;
  }
  if (parts.length === 0) return null;
  const filename = parts.join('-') + '.svg';
  return /^[0-9a-f]+(-[0-9a-f]+)*\.svg$/.test(filename) ? filename : null;
}

const TWEMOJI_SVG_PREFIX = '/twemoji/svg/';
const ALLOWED_TAGS = [
  'blockquote', 'code', 'pre', 'div', 'span', 'strong', 'em', 'del',
  'a', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'p', 'button',
];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'title', 'class', 'align', 'data-raw-code', 'tabindex', 'role'];
const ALLOWED_TAGS_WITH_EMOJI = [...ALLOWED_TAGS, 'img'];
const ALLOWED_ATTR_WITH_EMOJI = [...ALLOWED_ATTR, 'src', 'alt'];
const TWEMOJI_SRC_REGEX = /^\/twemoji\/svg\/[0-9a-f]+(-[0-9a-f]+)*\.svg$/;

const MENTION_SKIP_TAGS: Record<string, true> = { a: true, code: true, pre: true };

function shortenNpub(npub: string): string {
  if (npub.length <= 16) return npub;
  return `${npub.slice(0, 8)}…${npub.slice(-4)}`;
}

function profileDisplayName(profile: NostrProfile | undefined, fallback: string): string {
  if (!profile) return fallback;
  return (
    profile.nickname?.trim() ||
    profile.display_name?.trim() ||
    profile.name?.trim() ||
    fallback
  );
}

function profileTrustSignal(profile: NostrProfile | undefined, npub: string): string {
  if (profile?.nip05?.trim()) return profile.nip05.trim();
  return shortenNpub(npub);
}

function isAtTokenBoundary(text: string, atIndex: number, alias: string): boolean {
  const aliasStart = atIndex + 1;
  const aliasEnd = aliasStart + alias.length;
  if (aliasEnd > text.length) return false;
  if (text.slice(aliasStart, aliasEnd) !== alias) return false;
  const prev = text[atIndex - 1];
  if (prev && /[a-zA-Z0-9_]/.test(prev)) return false;
  const next = text[aliasEnd];
  if (next && /[a-zA-Z0-9_]/.test(next)) return false;
  return true;
}

interface ProcessMentionSegmentResult {
  text: string;
  mentionIndex: number;
}

function processMentionSegment(
  segment: string,
  mentions: Mention[],
  profiles: Record<string, NostrProfile | undefined>,
  rosterSet: Set<string>,
  startIndex: number
): ProcessMentionSegmentResult {
  let out = '';
  let i = 0;
  let mentionIndex = startIndex;
  while (i < segment.length && mentionIndex < mentions.length) {
    const m = mentions[mentionIndex];
    const search = `@${m.alias}`;
    const pos = segment.indexOf(search, i);
    if (pos === -1) break;
    if (!isAtTokenBoundary(segment, pos, m.alias)) {
      out += segment.slice(i, pos + 1);
      i = pos + 1;
      continue;
    }
    if (rosterSet.has(m.npub)) {
      const resolvedName = profileDisplayName(profiles[m.npub], m.alias);
      const trust = resolvedName !== m.alias ? profileTrustSignal(profiles[m.npub], m.npub) : '';
      const span = trust
        ? `<span class="mention" data-npub="${escapeAttr(m.npub)}">@${escapeHtml(resolvedName)} <span class="mention-trust">${escapeHtml(trust)}</span></span>`
        : `<span class="mention" data-npub="${escapeAttr(m.npub)}">@${escapeHtml(resolvedName)}</span>`;
      out += segment.slice(i, pos) + span;
    } else {
      out += segment.slice(i, pos + search.length);
    }
    i = pos + search.length;
    mentionIndex++;
  }
  out += segment.slice(i);
  return { text: out, mentionIndex };
}

function mentionify(
  html: string,
  mentions: Mention[],
  profiles: Record<string, NostrProfile | undefined>,
  rosterNpubs: string[] | Set<string>
): string {
  const rosterSet = rosterNpubs instanceof Set ? rosterNpubs : new Set(rosterNpubs);
  if (mentions.length === 0 || rosterSet.size === 0) return html;
  let out = '';
  let i = 0;
  const len = html.length;
  const stack: string[] = [];
  let mentionIndex = 0;
  while (i < len) {
    if (html[i] === '<') {
      const close = html.indexOf('>', i);
      if (close === -1) {
        out += html.slice(i);
        break;
      }
      const tag = html.slice(i, close + 1);
      const isClosing = tag.startsWith('</');
      const nameMatch = tag.match(isClosing ? /^<\/([a-zA-Z0-9]+)/ : /^<([a-zA-Z0-9]+)/);
      const tagName = nameMatch?.[1]?.toLowerCase();
      if (tagName && MENTION_SKIP_TAGS[tagName]) {
        if (isClosing && stack[stack.length - 1] === tagName) stack.pop();
        else if (!isClosing) stack.push(tagName);
      }
      out += tag;
      i = close + 1;
      continue;
    }
    const nextTag = html.indexOf('<', i);
    const segmentEnd = nextTag === -1 ? len : nextTag;
    let segment = html.slice(i, segmentEnd);
    if (stack.length === 0) {
      const processed = processMentionSegment(segment, mentions, profiles, rosterSet, mentionIndex);
      segment = processed.text;
      mentionIndex = processed.mentionIndex;
    }
    out += segment;
    i = segmentEnd;
  }
  return out;
}

/** DOMPurify hook: allow data-npub only on span.mention with a valid npub1 prefix. */
export function mentionSanitizeAttributeHook(
  currentNode: Element,
  data: unknown,
  _config: unknown
): void {
  const event = data as { attrName: string; attrValue: string; keepAttr?: boolean };
  if (event.attrName !== 'data-npub') return;
  const classes = currentNode.getAttribute('class')?.split(/\s+/) ?? [];
  if (currentNode.tagName !== 'SPAN' || !classes.includes('mention')) {
    event.keepAttr = false;
    return;
  }
  const value = event.attrValue.trim();
  if (!value.startsWith('npub1')) {
    event.keepAttr = false;
    return;
  }
  event.attrValue = escapeAttr(value);
  event.keepAttr = true;
}

/**
 * Parse, replace mentions with safe spans, linkify, sanitize, replace emoji, and re-sanitize.
 */
export function formatMessageContentWithMentions(
  content: string,
  mentions: Mention[],
  profiles: Record<string, NostrProfile | undefined>,
  rosterNpubs: string[] | Set<string>
): string {
  const html = parseMarkdown(content);
  const mentionified = mentionify(html, mentions, profiles, rosterNpubs);
  const linked = linkify(mentionified);
  const cleaned = sanitize(linked);
  const withEmoji = replaceEmojiWithTwemoji(cleaned);
  return sanitizeWithEmoji(withEmoji);
}

/**
 * Parse, linkify bare URLs, sanitize, replace emoji with Twemoji img, then re-sanitize.
 */
export function parseMarkdown(content: string): string {
  if (typeof content !== 'string') return '';
  const marked = getMarked();
  if (!marked) return escapeHtml(content);
  return marked.parse(content, { async: false }) as string;
}

/**
 * Sanitize HTML with a strict allowlist (no scripts, no event handlers).
 */
export function sanitize(html: string): string {
  if (typeof html !== 'string') return '';
  const purify = getDOMPurify();
  if (!purify) return escapeHtml(html);
  const hookName = 'uponSanitizeAttribute';
  purify.addHook(hookName, mentionSanitizeAttributeHook);
  try {
    return purify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
    });
  } finally {
    purify.removeHook(hookName, mentionSanitizeAttributeHook);
  }
}

const restrictTwemojiImgSrc = (currentNode: Element, _data: unknown, _config: unknown): void => {
  if (currentNode.tagName === 'IMG') {
    const src = currentNode.getAttribute('src');
    if (!src || !TWEMOJI_SRC_REGEX.test(src)) currentNode.removeAttribute('src');
  }
};

/**
 * Sanitize HTML allowing Twemoji img tags; img src restricted to /twemoji/svg/*.svg.
 */
function sanitizeWithEmoji(html: string): string {
  if (typeof html !== 'string') return '';
  const purify = getDOMPurify();
  if (!purify) return escapeHtml(html);
  const hookName = 'beforeSanitizeAttributes';
  purify.addHook(hookName, restrictTwemojiImgSrc);
  try {
    return purify.sanitize(html, {
      ALLOWED_TAGS: ALLOWED_TAGS_WITH_EMOJI,
      ALLOWED_ATTR: ALLOWED_ATTR_WITH_EMOJI,
      ALLOW_DATA_ATTR: false,
    });
  } finally {
    purify.removeHook(hookName, restrictTwemojiImgSrc);
  }
}

const URL_REGEX = /(https?:\/\/[^\s<>"']+?)([.,;:!?)\]'"]*)(?=\s|$|<|>)/g;

/** True when content has an https:// URL — mirrors the backend's link-preview candidate check. */
export function containsHttpsUrl(content: string): boolean {
  return /https:\/\/\S/.test(content);
}

function isSafeUrl(url: string): boolean {
  const t = url.toLowerCase().trim();
  return t.startsWith('http://') || t.startsWith('https://');
}

const SKIP_LINKIFY_TAGS = new Set(['a', 'code', 'pre']);
const SKIP_EMOJI_TAGS = new Set(['code', 'pre']);

/**
 * Replace Unicode emoji in text segments with Twemoji <img> tags.
 * Uses window.twemoji (Vector's vendored script) when available; skips content inside <code> and <pre>.
 */
function replaceEmojiWithTwemoji(html: string): string {
  const tw = typeof window !== 'undefined' ? window.twemoji : undefined;
  let out = '';
  let i = 0;
  const len = html.length;
  const stack: string[] = [];
  while (i < len) {
    if (html[i] === '<') {
      const close = html.indexOf('>', i);
      if (close === -1) {
        out += html.slice(i);
        break;
      }
      const tag = html.slice(i, close + 1);
      const isClosing = tag.startsWith('</');
      const nameMatch = tag.match(isClosing ? /^<\/([a-zA-Z0-9]+)/ : /^<([a-zA-Z0-9]+)/);
      const tagName = nameMatch?.[1]?.toLowerCase();
      if (tagName && SKIP_EMOJI_TAGS.has(tagName)) {
        if (isClosing && stack[stack.length - 1] === tagName) stack.pop();
        else if (!isClosing) stack.push(tagName);
      }
      out += tag;
      i = close + 1;
      continue;
    }
    const nextTag = html.indexOf('<', i);
    const segmentEnd = nextTag === -1 ? len : nextTag;
    let segment = html.slice(i, segmentEnd);
    if (stack.length === 0 && tw) {
      segment = tw.replace(segment, (rawText: string) => {
        const icon = tw.convert.toCodePoint(rawText);
        if (!icon || !/^[0-9a-f]+(-[0-9a-f]+)*$/.test(icon)) return rawText;
        const alt = escapeAttr(rawText);
        return `<img class="twemoji" draggable="false" alt="${alt}" src="${TWEMOJI_SVG_PREFIX}${icon}.svg">`;
      });
    }
    out += segment;
    i = segmentEnd;
  }
  return out;
}

/**
 * Linkify: turn bare https?:// URLs in text segments into <a> tags.
 * Skips content inside <a>, <code>, and <pre>. Trailing punctuation is kept after the link.
 */
function linkify(html: string): string {
  let out = '';
  let i = 0;
  const len = html.length;
  const stack: string[] = [];
  while (i < len) {
    if (html[i] === '<') {
      const close = html.indexOf('>', i);
      if (close === -1) {
        out += html.slice(i);
        break;
      }
      const tag = html.slice(i, close + 1);
      const isClosing = tag.startsWith('</');
      const nameMatch = tag.match(isClosing ? /^<\/([a-zA-Z0-9]+)/ : /^<([a-zA-Z0-9]+)/);
      const tagName = nameMatch?.[1]?.toLowerCase();
      if (tagName && SKIP_LINKIFY_TAGS.has(tagName)) {
        if (isClosing && stack[stack.length - 1] === tagName) stack.pop();
        else if (!isClosing) stack.push(tagName);
      }
      out += tag;
      i = close + 1;
      continue;
    }
    const nextTag = html.indexOf('<', i);
    const segmentEnd = nextTag === -1 ? len : nextTag;
    let segment = html.slice(i, segmentEnd);
    if (stack.length === 0) {
      segment = segment.replace(URL_REGEX, (_: string, url: string, trail: string) => {
        if (!isSafeUrl(url)) return url + trail;
        const href = escapeAttr(url);
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>${trail}`;
      });
    }
    out += segment;
    i = segmentEnd;
  }
  return out;
}

/**
 * Chat message header timestamp: short date + time (e.g. "May 26, 11:09 PM").
 */
export function formatMessageTimestamp(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const localeValue = get(locale) ?? 'en-US';
  const dateOpts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
  };
  if (date.getFullYear() !== now.getFullYear()) {
    dateOpts.year = 'numeric';
  }
  const datePart = date.toLocaleDateString(localeValue, dateOpts);
  const timePart = date.toLocaleTimeString(localeValue, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${datePart}, ${timePart}`;
}

/**
 * Parse, linkify bare URLs, sanitize, replace emoji with Twemoji img, then re-sanitize.
 */
export function formatMessageContent(content: string): string {
  const html = parseMarkdown(content);
  const linked = linkify(html);
  const cleaned = sanitize(linked);
  const withEmoji = replaceEmojiWithTwemoji(cleaned);
  return sanitizeWithEmoji(withEmoji);
}
