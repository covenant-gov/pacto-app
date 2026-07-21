import type { NostrProfile } from '../api/nostr';

export interface MentionCandidate {
  npub: string;
  alias: string;
  displayName: string;
  avatar: string | null;
  subtitle: string;
}

export interface Mention {
  npub: string;
  alias: string;
}

export interface MentionEnvelope {
  body: string;
  mentions: Mention[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function firstWordOrShortNpub(profile: NostrProfile | null | undefined, npub: string): string {
  const name = profile?.nickname?.trim() || profile?.name?.trim() || profile?.display_name?.trim() || '';
  if (name) {
    const first = name.split(/\s+/)[0];
    if (first) return first;
  }
  return npub.slice(0, 16);
}

export function shortenNpub(npub: string): string {
  return npub.length > 16 ? `${npub.slice(0, 16)}…` : npub;
}

export function getMentionAlias(profile: NostrProfile | null | undefined, npub: string): string {
  return firstWordOrShortNpub(profile, npub);
}

export function assignMentionAliases(
  memberNpubs: string[],
  profiles: Record<string, NostrProfile>
): Map<string, string> {
  const base = new Map<string, string>();
  for (const npub of memberNpubs) {
    base.set(npub, getMentionAlias(profiles[npub], npub));
  }

  const counts = new Map<string, number>();
  for (const alias of base.values()) {
    counts.set(alias, (counts.get(alias) ?? 0) + 1);
  }

  const out = new Map<string, string>();
  for (const [npub, alias] of base) {
    if ((counts.get(alias) ?? 0) > 1) {
      out.set(npub, `${alias}·${npub.slice(0, 8)}`);
    } else {
      out.set(npub, alias);
    }
  }
  return out;
}

export function parseMentionEnvelope(content: string): MentionEnvelope | null {
  if (typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.body !== 'string' || !Array.isArray(obj.mentions)) return null;
    const mentions: Mention[] = [];
    for (const item of obj.mentions) {
      if (!item || typeof item !== 'object') continue;
      const { npub, alias } = item as Record<string, unknown>;
      if (typeof npub === 'string' && typeof alias === 'string') {
        mentions.push({ npub: npub.trim(), alias: alias.trim() });
      }
    }
    return { body: obj.body, mentions };
  } catch {
    return null;
  }
}

export function formatMentionEnvelope(body: string, mentions: Mention[]): string {
  return JSON.stringify({ body, mentions });
}

export function isMentionEnvelope(content: string): boolean {
  return parseMentionEnvelope(content) !== null;
}

export function filterMentionsInText(body: string, mentions: Mention[]): Mention[] {
  const seen = new Set<string>();
  const out: Mention[] = [];
  for (const m of mentions) {
    const pattern = `(?:^|[\\s\\b])@${escapeRegExp(m.alias)}(?:$|[\\s.,;:!?'"()\\[\\]{}<>\\\`\\n\\b])`;
    if (new RegExp(pattern).test(body) && !seen.has(m.alias)) {
      seen.add(m.alias);
      out.push(m);
    }
  }
  return out;
}
