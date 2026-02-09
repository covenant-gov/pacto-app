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
        const t = token as { text?: string; lang?: string };
        const raw = t.text ?? '';
        const lang = t.lang ?? 'plaintext';
        const highlighted = highlightCode(raw, lang);
        const langClass = lang ? `language-${escapeHtml(lang)}` : '';
        const dataRaw = escapeAttr(raw);
        return `<div class="code-block-wrapper" data-raw-code="${dataRaw}"><pre><code class="hljs ${langClass}">${highlighted}</code></pre><button type="button" class="code-copy-btn" aria-label="Copy code" title="Copy code">Copy</button></div>`;
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

/**
 * Parse markdown (GFM, breaks, spoiler ||...||) to HTML.
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
  return purify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
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

const URL_REGEX = /(https?:\/\/[^\s<>"']+?)([.,;:!?)\]\']*)(?=\s|$|<|>)/g;

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
 * Parse, linkify bare URLs, sanitize, replace emoji with Twemoji img, then re-sanitize.
 */
export function formatMessageContent(content: string): string {
  const html = parseMarkdown(content);
  const linked = linkify(html);
  const cleaned = sanitize(linked);
  const withEmoji = replaceEmojiWithTwemoji(cleaned);
  return sanitizeWithEmoji(withEmoji);
}
