/**
 * Fuzzy member picker logic for @ mentions in the squad composer.
 * Keeps all candidate ranking/filtering pure and testable; UI anchoring lives in MessageInput.
 */

import type { NostrProfile } from '../api/nostr';
import { getProfileAvatarSrc } from '../utils/profile';

export interface MentionCandidate {
  npub: string;
  alias: string;
  displayName: string;
  trustSignal: string;
  avatar: string | null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeForSearch(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

function shortenNpub(npub: string): string {
  if (npub.length <= 16) return npub;
  return `${npub.slice(0, 8)}…${npub.slice(-4)}`;
}

function candidateDisplayName(profile: NostrProfile | null | undefined, npub: string): string {
  if (!profile) return shortenNpub(npub);
  return (
    profile.nickname?.trim() ||
    profile.display_name?.trim() ||
    profile.name?.trim() ||
    shortenNpub(npub)
  );
}

function candidateAlias(profile: NostrProfile | null | undefined, npub: string): string {
  const fromProfile = profile?.nickname?.trim() || profile?.name?.trim();
  return fromProfile || shortenNpub(npub).replace('…', '');
}

/** Build mention candidates from a roster and profile map. */
export function buildMentionCandidates(
  roster: string[],
  profiles: Record<string, NostrProfile | undefined>,
  excludeNpubs?: Set<string>,
): MentionCandidate[] {
  const seen = new Set<string>();
  const out: MentionCandidate[] = [];
  for (const npub of roster) {
    const trimmed = npub.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    if (excludeNpubs?.has(trimmed)) continue;
    seen.add(trimmed);
    const profile = profiles[trimmed];
    const displayName = candidateDisplayName(profile, trimmed);
    const alias = candidateAlias(profile, trimmed);
    const trustSignal = profile?.nip05?.trim() ?? '';
    const avatar = getProfileAvatarSrc(profile);
    out.push({ npub: trimmed, alias, displayName, trustSignal, avatar });
  }
  return out;
}

/** True when `query` (without leading @) matches the candidate. */
export function candidateMatchesQuery(candidate: MentionCandidate, query: string): boolean {
  const q = normalizeForSearch(query);
  if (!q) return true;
  const haystacks = [
    candidate.alias,
    candidate.displayName,
    candidate.npub,
  ].map(normalizeForSearch);
  return haystacks.some((h) => h.includes(q));
}

/** Ranked, filtered candidates for the current picker query. */
export function filterMentionCandidates(
  candidates: MentionCandidate[],
  query: string,
  limit = 8,
): MentionCandidate[] {
  const q = normalizeForSearch(query);
  const matched = candidates.filter((c) => candidateMatchesQuery(c, q));
  return matched.slice(0, limit);
}

/** Find the active `@` trigger in a text value: the substring after the most recent
 * word-boundary `@`. Returns null when no active trigger exists. */
export function findActiveAtTrigger(
  value: string,
  cursor: number,
): { query: string; start: number; end: number } | null {
  if (cursor < 0 || cursor > value.length) return null;
  // Search backward for an unescaped `@` that is at a word boundary.
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch === '@') {
      // Must be at a word boundary: either at string start or preceded by whitespace/punctuation.
      const prev = value[i - 1];
      if (i > 0 && !/\s/.test(prev ?? '') && !/[.,;:!?()[\]{}/"]/.test(prev ?? '')) continue;
      const segment = value.slice(i + 1, cursor);
      // Disallow spaces inside the query; user has moved on to typing normal words.
      if (/\s/.test(segment)) continue;
      return { query: segment, start: i, end: cursor };
    }
    if (/\s/.test(ch)) {
      // A space before the cursor without finding an @ terminates the search.
      break;
    }
  }
  return null;
}

/** Replace the active `@query` text with `@alias` and return the new value/cursor. */
export function replaceAtTrigger(
  value: string,
  trigger: { start: number; end: number },
  alias: string,
): { value: string; cursor: number } {
  const before = value.slice(0, trigger.start);
  const after = value.slice(trigger.end);
  const replacement = `@${alias}`;
  const newValue = `${before}${replacement}${after}`;
  return { value: newValue, cursor: before.length + replacement.length };
}

/** Build a regex that matches any of the given aliases as whole @ tokens. */
export function mentionAliasPattern(aliases: string[]): RegExp | null {
  if (aliases.length === 0) return null;
  const escaped = aliases.map(escapeRegExp).join('|');
  return new RegExp(`(^|[^a-zA-Z0-9_])(${escaped})(?=[^a-zA-Z0-9_]|$)`, 'g');
}
