/**
 * Message editing rules shared by DMs and squad channels.
 *
 * Authors can fix a sent text message for a short window; after that the
 * message is locked. The backend (`EDIT_WINDOW_SECS` in `src-tauri/src/message.rs`)
 * enforces the same window on send and on receipt.
 */
import { get } from 'svelte/store';
import { locale, t } from 'svelte-i18n';
import type { DmMessage, EditEntry } from '../../stores/dm';
import { buildMentionEnvelope, parseMessageContent, type Mention } from './mentions';
import { friendlyMessage, getInvokeErrorMessage } from '../utils/tauri-errors';

export const EDIT_WINDOW_MS = 60_000;

/** Backend error text when the edit window has closed (`EDIT_WINDOW_CLOSED_ERROR`). */
const EDIT_WINDOW_CLOSED = 'edit window closed';

function isOptimisticId(id: string): boolean {
  return id.startsWith('opt-') || id.startsWith('pending-');
}

/**
 * Last ms timestamp at which `msg` may still be edited, or `null` when it can
 * never be edited (not ours, not yet sent, or not a plain text message).
 */
export function editableUntil(msg: DmMessage): number | null {
  if (!msg.mine || msg.pending || msg.failed) return null;
  if (!msg.id || isOptimisticId(msg.id)) return null;
  if (msg.attachments && msg.attachments.length > 0) return null;
  // Backend compares whole seconds, so the window closes at the end of the last second.
  return Math.floor(msg.at / 1000) * 1000 + EDIT_WINDOW_MS + 999;
}

export function canEditMessage(msg: DmMessage, now: number = Date.now()): boolean {
  const until = editableUntil(msg);
  return until != null && now <= until;
}

/** Text the author edits: the mention-envelope body, or the raw content. */
export function editableBody(content: string): string {
  return parseMessageContent(content).body;
}

function mentionStillPresent(body: string, mention: Mention): boolean {
  return body.includes(`@${mention.alias}`);
}

/**
 * Wire content for an edit. Mention envelopes stay envelopes so recipients
 * keep rendering pills; mentions whose `@alias` was removed are dropped.
 */
export function buildEditedContent(originalContent: string, newBody: string): string {
  const parsed = parseMessageContent(originalContent);
  if (!parsed.isEnvelope) return newBody;
  const mentions = parsed.mentions.filter((m) => mentionStillPresent(newBody, m));
  return buildMentionEnvelope(newBody, mentions, parsed.pacto_virtual_bucket ?? '');
}

/** True when the edited body would change what recipients see. */
export function isMeaningfulEdit(originalContent: string, newBody: string): boolean {
  if (!newBody.trim()) return false;
  return editableBody(originalContent) !== newBody;
}

/** User-facing message for a failed `edit_message` call. */
export function editErrorMessage(e: unknown): string {
  const raw = getInvokeErrorMessage(e, get(t)('errors.dm.editFailed'));
  if (raw.toLowerCase().includes(EDIT_WINDOW_CLOSED)) return get(t)('errors.dm.editWindowClosed');
  return friendlyMessage(raw, 'dm_send');
}

/**
 * Prior versions, newest first, excluding the current text. Empty when the
 * message was never edited.
 */
export function previousVersions(history: EditEntry[] | null | undefined): EditEntry[] {
  if (!history || history.length < 2) return [];
  return [...history]
    .sort((a, b) => a.edited_at - b.edited_at)
    .slice(0, -1)
    .reverse();
}

/** When the current text was written: the newest history entry. */
export function lastEditedAt(history: EditEntry[] | null | undefined): number | null {
  if (!history || history.length < 2) return null;
  return history.reduce((max, e) => (e.edited_at > max ? e.edited_at : max), 0);
}

/** Locale time of an edit, e.g. "3:42 PM". Edits land within a minute of the send, so no date. */
export function formatEditTime(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(get(locale) ?? 'en-US', { hour: 'numeric', minute: '2-digit' });
}
