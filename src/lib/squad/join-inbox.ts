import { invoke } from '@tauri-apps/api/core';
import { get, writable } from 'svelte/store';
import { sendDmMessage } from '../api/nostr';
import { getInvokeErrorMessage } from '../utils/tauri-errors';

export const JOIN_INBOX_META_SCHEMA = 'pacto.squad.join_inbox.meta.v1';
export const JOIN_INBOX_KEY_ROTATED_SCHEMA = 'pacto.squad.join_inbox.key_rotated.v1';
export const JOIN_INBOX_ROTATE_PROMPT_SCHEMA = 'pacto.squad.join_inbox.rotate_prompt.v1';
export const JOIN_INBOX_KEY_SHARE_SCHEMA = 'pacto.squad.join_inbox.key_share.v1';

/** Squad ids with an add/remove/rotate holder mutation in flight (survives remount). */
export const joinInboxHolderActionInFlight = writable<Set<string>>(new Set());
export const joinInboxHolderActionInFlightRevision = writable(0);

export function resetJoinInboxHolderActionInFlight(): void {
  joinInboxHolderActionInFlight.set(new Set());
  joinInboxHolderActionInFlightRevision.set(0);
}

export function isJoinInboxHolderActionInFlight(squadId: string): boolean {
  const id = squadId.trim();
  return id.length > 0 && get(joinInboxHolderActionInFlight).has(id);
}

function markJoinInboxHolderActionInFlight(squadId: string): boolean {
  const id = squadId.trim();
  if (!id) return false;
  if (get(joinInboxHolderActionInFlight).has(id)) return false;
  joinInboxHolderActionInFlight.update((s) => {
    const next = new Set(s);
    next.add(id);
    return next;
  });
  joinInboxHolderActionInFlightRevision.update((n) => n + 1);
  return true;
}

function clearJoinInboxHolderActionInFlight(squadId: string): void {
  const id = squadId.trim();
  if (!id) return;
  let removed = false;
  joinInboxHolderActionInFlight.update((s) => {
    if (!s.has(id)) return s;
    removed = true;
    const next = new Set(s);
    next.delete(id);
    return next;
  });
  if (removed) joinInboxHolderActionInFlightRevision.update((n) => n + 1);
}

const HOLDER_ACTION_BUSY = 'Join inbox holder update already in progress.';

export interface JoinInboxState {
  squadId: string;
  inboxNpub: string;
  holders: string[];
  keyEpoch: number;
  updatedAt: number;
  hasLocalSecret: boolean;
  iAmHolder: boolean;
}

export interface JoinInboxKeyShareOut {
  recipientNpub: string;
  content: string;
}

export interface JoinInboxPublishBundle {
  state: JoinInboxState;
  mlsAnnouncements: string[];
  mlsInbox: string[];
  keyShares: JoinInboxKeyShareOut[];
}

export function formatJoinInboxMeta(state: JoinInboxState): string {
  return JSON.stringify({
    schema: JOIN_INBOX_META_SCHEMA,
    pacto_virtual_bucket: 'announcements',
    squadId: state.squadId,
    inboxNpub: state.inboxNpub,
    holders: state.holders,
    keyEpoch: state.keyEpoch,
    updatedAt: state.updatedAt,
  });
}

async function publishBundle(squadId: string, bundle: JoinInboxPublishBundle): Promise<void> {
  const gid = squadId.trim();
  for (const content of bundle.mlsAnnouncements ?? []) {
    await sendDmMessage(gid, content, '', { virtualBucket: 'announcements' });
  }
  for (const content of bundle.mlsInbox ?? []) {
    await sendDmMessage(gid, content, '', { virtualBucket: 'inbox' });
  }
  for (const share of bundle.keyShares ?? []) {
    await sendDmMessage(share.recipientNpub, share.content);
  }
}

export async function getJoinInboxState(squadId: string): Promise<JoinInboxState | null> {
  const id = squadId.trim();
  if (!id) return null;
  return invoke<JoinInboxState | null>('join_inbox_get_state', { squadId: id });
}

/** Init on create (or no-op if already present). Publishes MLS meta when newly created. */
export async function initJoinInbox(squadId: string): Promise<JoinInboxState | null> {
  const id = squadId.trim();
  if (!id) return null;
  try {
    const bundle = await invoke<JoinInboxPublishBundle>('join_inbox_init', { squadId: id });
    await publishBundle(id, bundle);
    return bundle.state;
  } catch (e) {
    console.warn('[join-inbox] init failed', e);
    return null;
  }
}

/** Restore creator identity after a same-epoch overwrite. No-op when not split. */
export async function reclaimJoinInboxIfSplit(squadId: string): Promise<JoinInboxState | null> {
  const id = squadId.trim();
  if (!id) return null;
  try {
    const bundle = await invoke<JoinInboxPublishBundle>('join_inbox_reclaim_if_split', {
      squadId: id,
    });
    await publishBundle(id, bundle);
    return bundle.state;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!message.toLowerCase().includes('not initialized')) {
      console.warn('[join-inbox] reclaim failed', e);
    }
    return getJoinInboxState(id);
  }
}

export async function addJoinInboxHolder(
  squadId: string,
  holderNpub: string
): Promise<{ ok: true; state: JoinInboxState } | { ok: false; error: string }> {
  const id = squadId.trim();
  if (!markJoinInboxHolderActionInFlight(id)) {
    return { ok: false, error: HOLDER_ACTION_BUSY };
  }
  try {
    const bundle = await invoke<JoinInboxPublishBundle>('join_inbox_add_holder', {
      squadId: id,
      holderNpub: holderNpub.trim(),
    });
    await publishBundle(id, bundle);
    return { ok: true, state: bundle.state };
  } catch (e: unknown) {
    return { ok: false, error: getInvokeErrorMessage(e, 'Could not add Join inbox holder.') };
  } finally {
    clearJoinInboxHolderActionInFlight(id);
  }
}

export async function removeJoinInboxHolder(
  squadId: string,
  holderNpub: string
): Promise<{ ok: true; state: JoinInboxState } | { ok: false; error: string }> {
  const id = squadId.trim();
  if (!markJoinInboxHolderActionInFlight(id)) {
    return { ok: false, error: HOLDER_ACTION_BUSY };
  }
  try {
    const bundle = await invoke<JoinInboxPublishBundle>('join_inbox_remove_holder', {
      squadId: id,
      holderNpub: holderNpub.trim(),
    });
    await publishBundle(id, bundle);
    return { ok: true, state: bundle.state };
  } catch (e: unknown) {
    return { ok: false, error: getInvokeErrorMessage(e, 'Could not remove Join inbox holder.') };
  } finally {
    clearJoinInboxHolderActionInFlight(id);
  }
}

export async function rotateJoinInboxKey(
  squadId: string
): Promise<{ ok: true; state: JoinInboxState } | { ok: false; error: string }> {
  const id = squadId.trim();
  if (!markJoinInboxHolderActionInFlight(id)) {
    return { ok: false, error: HOLDER_ACTION_BUSY };
  }
  try {
    const bundle = await invoke<JoinInboxPublishBundle>('join_inbox_rotate_key', {
      squadId: id,
    });
    await publishBundle(id, bundle);
    return { ok: true, state: bundle.state };
  } catch (e: unknown) {
    return { ok: false, error: getInvokeErrorMessage(e, 'Could not rotate Join inbox key.') };
  } finally {
    clearJoinInboxHolderActionInFlight(id);
  }
}

/** When SquadAdmin is live, holder management requires Full executor scope on roster EVM. */
export function hasSquadAdminHolderManageRights(executorRolesLabel: string | undefined): boolean {
  const label = executorRolesLabel?.trim();
  if (!label || label === '—') return false;
  const lower = label.toLowerCase();
  if (lower.includes('(paused)')) return false;
  return lower.startsWith('full') || /\bfull\b/.test(lower);
}

export function canManageJoinInboxHolders(input: {
  squadAdminActive: boolean;
  executorRolesLabel?: string;
  state: JoinInboxState | null;
}): boolean {
  if (!input.state?.iAmHolder || !input.state?.hasLocalSecret) return false;
  if (!input.squadAdminActive) return true;
  return hasSquadAdminHolderManageRights(input.executorRolesLabel);
}

/** Pure eligibility: actor and target must be MLS members; actor must already be a holder. */
export function canAddJoinInboxHolder(
  members: string[],
  actorNpub: string,
  targetNpub: string,
  holders: string[],
  options?: { squadAdminActive?: boolean; executorRolesLabel?: string }
): string | null {
  if (
    options?.squadAdminActive &&
    !hasSquadAdminHolderManageRights(options.executorRolesLabel)
  ) {
    return 'Squad Admin Full executor scope is required to manage Join inbox holders.';
  }
  if (!members.includes(actorNpub)) return 'You must be a squad member.';
  if (!members.includes(targetNpub)) return 'That person is not a current squad member.';
  if (!holders.includes(actorNpub)) return 'Only Join inbox holders can add holders.';
  if (holders.includes(targetNpub)) return 'Already a key holder.';
  return null;
}
