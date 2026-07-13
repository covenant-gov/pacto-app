import type { DmMessage } from '../../stores/dm';
import { resolveDmMessagePresentation } from './resolve-dm-message-presentation';

/** Default gap after which the same author starts a new header/avatar group. */
export const MESSAGE_STACK_MAX_GAP_MS = 5 * 60 * 1000;

export function messageStackAuthorKey(msg: DmMessage): string {
  if (msg.mine) return '__mine__';
  return msg.npub?.trim() ? msg.npub.trim() : '__peer__';
}

/**
 * Stable author key for plain chat bubbles only.
 * Non-plain rows (invites, wallet cards, announcements) return null and break the stack.
 */
export function plainMessageStackAuthorKey(msg: DmMessage): string | null {
  if (resolveDmMessagePresentation(msg).kind !== 'plain') return null;
  return messageStackAuthorKey(msg);
}

export function withinMessageStackGap(
  prev: DmMessage,
  curr: DmMessage,
  maxGapMs: number = MESSAGE_STACK_MAX_GAP_MS
): boolean {
  return Math.abs(curr.at - prev.at) <= maxGapMs;
}

/** Whether `curr` should nest under the previous row's avatar/name (DM / plain-only). */
export function shouldStackWithPrevious(
  prev: DmMessage | undefined,
  curr: DmMessage,
  maxGapMs: number = MESSAGE_STACK_MAX_GAP_MS
): boolean {
  if (!prev) return false;
  const prevKey = plainMessageStackAuthorKey(prev);
  const currKey = plainMessageStackAuthorKey(curr);
  if (!prevKey || !currKey || prevKey !== currKey) return false;
  return withinMessageStackGap(prev, curr, maxGapMs);
}

/**
 * Channel timelines: caller decides which rows render as cards (non-stackable).
 * Both rows must be plain bubbles, same author, within the time gap.
 */
export function shouldStackChannelWithPrevious(
  prev: DmMessage | undefined,
  curr: DmMessage,
  isNonStackableRow: (m: DmMessage) => boolean,
  maxGapMs: number = MESSAGE_STACK_MAX_GAP_MS
): boolean {
  if (!prev) return false;
  if (isNonStackableRow(prev) || isNonStackableRow(curr)) return false;
  if (messageStackAuthorKey(prev) !== messageStackAuthorKey(curr)) return false;
  return withinMessageStackGap(prev, curr, maxGapMs);
}
