import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import emojiRegex from 'emoji-regex';

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
    const result = hljs.highlight(text, { language });
    return result.value;
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

marked.use({
  gfm: true,
  breaks: true,
  extensions: [spoilerExtension],
  renderer: {
    code(token: { type: string; text: string; lang?: string; escaped?: boolean }) {
      const raw = token.text ?? '';
      const lang = token.lang ?? 'plaintext';
      const highlighted = highlightCode(raw, lang);
      const langClass = lang ? `language-${escapeHtml(lang)}` : '';
      const dataRaw = escapeAttr(raw);
      return `<div class="code-block-wrapper" data-raw-code="${dataRaw}"><pre><code class="hljs ${langClass}">${highlighted}</code></pre><button type="button" class="code-copy-btn" aria-label="Copy code" title="Copy code">Copy</button></div>`;
    },
  },
});

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

/**
 * Parse markdown (GFM, breaks, spoiler ||...||) to HTML.
 */
export function parseMarkdown(content: string): string {
  if (typeof content !== 'string') return '';
  return marked.parse(content, { async: false }) as string;
}

/**
 * Sanitize HTML with a strict allowlist (no scripts, no event handlers).
 */
export function sanitize(html: string): string {
  if (typeof html !== 'string') return '';
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}

const restrictTwemojiImgSrc: (currentNode: Element, hookEvent: null, _config: unknown) => void = (currentNode) => {
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
  const hookName = 'beforeSanitizeAttributes' as const;
  DOMPurify.addHook(hookName, restrictTwemojiImgSrc as import('dompurify').ElementHook);
  try {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ALLOWED_TAGS_WITH_EMOJI,
      ALLOWED_ATTR: ALLOWED_ATTR_WITH_EMOJI,
      ALLOW_DATA_ATTR: false,
    });
  } finally {
    DOMPurify.removeHook(hookName, restrictTwemojiImgSrc as import('dompurify').ElementHook);
  }
}

const URL_REGEX = /(https?:\/\/[^\s<>"']+?)([.,;:!?)\]\']*)(?=\s|$|<|>)/g;

function isSafeUrl(url: string): boolean {
  const t = url.toLowerCase().trim();
  return t.startsWith('http://') || t.startsWith('https://');
}

const SKIP_LINKIFY_TAGS = new Set(['a', 'code', 'pre']);
const SKIP_EMOJI_TAGS = new Set(['code', 'pre']);

const regexEmoji = emojiRegex();

/**
 * Replace Unicode emoji in text segments with Twemoji <img> tags.
 * Skips content inside <code> and <pre>. Keeps alt as original emoji for a11y.
 */
function replaceEmojiWithTwemoji(html: string): string {
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
    if (stack.length === 0) {
      segment = segment.replace(regexEmoji, (emoji) => {
        const filename = emojiToTwemojiFilename(emoji);
        if (!filename) return emoji;
        const alt = escapeAttr(emoji);
        return `<img src="${TWEMOJI_SVG_PREFIX}${filename}" alt="${alt}" class="twemoji">`;
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
 * Parse, linkify bare URLs, sanitize, replace emoji with Twemoji img, then re-sanitize.
 */
export function formatMessageContent(content: string): string {
  const html = parseMarkdown(content);
  const linked = linkify(html);
  const cleaned = sanitize(linked);
  const withEmoji = replaceEmojiWithTwemoji(cleaned);
  return sanitizeWithEmoji(withEmoji);
}
