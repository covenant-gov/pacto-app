import { invoke } from './index';

/**
 * Backend: `CatchUpEntry` (src-tauri/src/catch_up.rs). References only —
 * no content, title, or sender name field exists, by design (KD1/KTD8).
 */
export interface CatchUpEntry {
  id: string;
  sourceEventId: string;
  kind: 'mention' | 'direct_message' | 'action_prompt' | 'welcome';
  chatId: string;
  createdAt: number;
  resolvedAt: number | null;
}

/**
 * Backend: `list_catch_up_entries`. Unresolved entries, newest first,
 * optionally narrowed to one kind (`'mention'` or `'action_prompt'` for the
 * needs-action filter) and/or one squad (R25).
 */
export async function listCatchUpEntries(kind?: string, squadId?: string): Promise<CatchUpEntry[]> {
  return await invoke<CatchUpEntry[]>('list_catch_up_entries', { kind: kind ?? null, squadId: squadId ?? null });
}

/**
 * Backend: `catch_up_count`. Unresolved count excluding entries whose chat
 * sits at Nothing (R24) — the same authority every other badge reads (R14).
 */
export async function getCatchUpCount(): Promise<number> {
  return await invoke<number>('catch_up_count');
}

/**
 * Backend: `resolve_catch_up_entry`. Clears one entry by its source event
 * id (R23's "clear individually"). Message-shaped entries also advance
 * that chat's read watermark so the canonical home agrees (Approach #5).
 * Returns whether a row was actually resolved.
 */
export async function resolveCatchUpEntry(sourceEventId: string): Promise<boolean> {
  return await invoke<boolean>('resolve_catch_up_entry', { sourceEventId });
}

/**
 * Backend: `resolve_all_catch_up_entries`. Resolves exactly the entries the
 * given filter currently lists (R23's "mark the whole surface read") —
 * never the whole table. Returns the count resolved.
 */
export async function resolveAllCatchUpEntries(kind?: string, squadId?: string): Promise<number> {
  return await invoke<number>('resolve_all_catch_up_entries', { kind: kind ?? null, squadId: squadId ?? null });
}

/**
 * Backend: `record_action_needed_entry`. For a derived "needs action"
 * condition with no backend event to hook (Approach #4 of U9) — currently
 * the per-squad roster-key-choice prompt and pending squad join requests.
 * Idempotent: reopens the entry if it was previously resolved while the
 * condition still holds, and is a no-op if it is already unresolved.
 */
export async function recordActionNeededEntry(chatId: string, sourceEventId: string): Promise<void> {
  await invoke('record_action_needed_entry', { chatId, sourceEventId });
}
