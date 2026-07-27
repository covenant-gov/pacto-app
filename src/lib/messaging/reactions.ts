import type { Reaction } from '../../stores/dm';

export interface AggregatedReaction {
  emoji: string;
  count: number;
  /** True if the current user has already sent this emoji on this message. */
  includesMe: boolean;
  /** Bech32 npubs of everyone who reacted with this emoji, in first-seen order (deduped per author). */
  reactorIds: string[];
}

/**
 * Aggregate reactions by emoji, flagging whether the current user contributed and
 * collecting the distinct reactor npubs for that emoji (for the reactor-list tooltip).
 * Results are sorted by count descending, then emoji ascending for stable ordering.
 */
export function aggregateReactions(
  reactions: Reaction[],
  currentUserNpub: string
): AggregatedReaction[] {
  const map = new Map<
    string,
    { count: number; includesMe: boolean; reactorIds: string[]; seenAuthors: Set<string> }
  >();

  for (const r of reactions) {
    const entry = map.get(r.emoji) ?? {
      count: 0,
      includesMe: false,
      reactorIds: [],
      seenAuthors: new Set<string>(),
    };
    entry.count += 1;
    if (r.author_id === currentUserNpub) {
      entry.includesMe = true;
    }
    if (!entry.seenAuthors.has(r.author_id)) {
      entry.seenAuthors.add(r.author_id);
      entry.reactorIds.push(r.author_id);
    }
    map.set(r.emoji, entry);
  }

  return Array.from(map.entries())
    .map(([emoji, { count, includesMe, reactorIds }]) => ({ emoji, count, includesMe, reactorIds }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.emoji.localeCompare(b.emoji);
    });
}

/** In-memory map of reactions that have been sent but not yet confirmed by the backend. */
const pendingReactions = new Map<string, Set<string>>();

/** Record that a reaction was sent optimistically so the UI can suppress duplicate clicks. */
export function pendingReactionSent(messageId: string, emoji: string): void {
  let set = pendingReactions.get(messageId);
  if (!set) {
    set = new Set();
    pendingReactions.set(messageId, set);
  }
  set.add(emoji);
}

/** Check whether a reaction has already been sent optimistically for this message. */
export function isPendingReaction(messageId: string, emoji: string): boolean {
  return pendingReactions.get(messageId)?.has(emoji) ?? false;
}

/** Clear pending-reaction tracking for one message or globally. */
export function clearPendingReactions(messageId?: string): void {
  if (messageId) {
    pendingReactions.delete(messageId);
  } else {
    pendingReactions.clear();
  }
}
