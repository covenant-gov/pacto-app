import { invoke } from '@tauri-apps/api/core';
import { sendDmMessage } from '../api/nostr';
import { getInvokeErrorMessage } from '../utils/tauri-errors';

export const SQUAD_BOT_META_SCHEMA = 'pacto.squad_bot.meta.v1';
export const SQUAD_BOT_KEY_ROTATED_SCHEMA = 'pacto.squad_bot.key_rotated.v1';
export const SQUAD_BOT_ROTATE_PROMPT_SCHEMA = 'pacto.squad_bot.rotate_prompt.v1';
export const SQUAD_BOT_KEY_SHARE_SCHEMA = 'pacto.squad_bot.key_share.v1';

export interface SquadBotState {
  squadId: string;
  botNpub: string;
  holders: string[];
  keyEpoch: number;
  updatedAt: number;
  hasLocalSecret: boolean;
  iAmHolder: boolean;
}

export interface SquadBotKeyShareOut {
  recipientNpub: string;
  content: string;
}

export interface SquadBotPublishBundle {
  state: SquadBotState;
  mlsAnnouncements: string[];
  mlsInbox: string[];
  keyShares: SquadBotKeyShareOut[];
}

async function publishBundle(squadId: string, bundle: SquadBotPublishBundle): Promise<void> {
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

export async function getSquadBotState(squadId: string): Promise<SquadBotState | null> {
  const id = squadId.trim();
  if (!id) return null;
  return invoke<SquadBotState | null>('squad_bot_get_state', { squadId: id });
}

/** Init bot on create (or no-op if already present). Publishes MLS meta when newly created. */
export async function initSquadBot(squadId: string): Promise<SquadBotState | null> {
  const id = squadId.trim();
  if (!id) return null;
  try {
    const bundle = await invoke<SquadBotPublishBundle>('squad_bot_init', { squadId: id });
    await publishBundle(id, bundle);
    return bundle.state;
  } catch (e) {
    console.warn('[squad-bot] init failed', e);
    return null;
  }
}

export async function ensureSquadBot(squadId: string): Promise<SquadBotState | null> {
  const existing = await getSquadBotState(squadId);
  if (existing) return existing;
  return initSquadBot(squadId);
}

export async function addSquadBotHolder(
  squadId: string,
  holderNpub: string
): Promise<{ ok: true; state: SquadBotState } | { ok: false; error: string }> {
  try {
    const bundle = await invoke<SquadBotPublishBundle>('squad_bot_add_holder', {
      squadId: squadId.trim(),
      holderNpub: holderNpub.trim(),
    });
    await publishBundle(squadId, bundle);
    return { ok: true, state: bundle.state };
  } catch (e: unknown) {
    return { ok: false, error: getInvokeErrorMessage(e, 'Could not add bot key holder.') };
  }
}

export async function removeSquadBotHolder(
  squadId: string,
  holderNpub: string
): Promise<{ ok: true; state: SquadBotState } | { ok: false; error: string }> {
  try {
    const bundle = await invoke<SquadBotPublishBundle>('squad_bot_remove_holder', {
      squadId: squadId.trim(),
      holderNpub: holderNpub.trim(),
    });
    await publishBundle(squadId, bundle);
    return { ok: true, state: bundle.state };
  } catch (e: unknown) {
    return { ok: false, error: getInvokeErrorMessage(e, 'Could not remove bot key holder.') };
  }
}

export async function rotateSquadBotKey(
  squadId: string
): Promise<{ ok: true; state: SquadBotState } | { ok: false; error: string }> {
  try {
    const bundle = await invoke<SquadBotPublishBundle>('squad_bot_rotate_key', {
      squadId: squadId.trim(),
    });
    await publishBundle(squadId, bundle);
    return { ok: true, state: bundle.state };
  } catch (e: unknown) {
    return { ok: false, error: getInvokeErrorMessage(e, 'Could not rotate bot key.') };
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

export function canManageBotHolders(input: {
  squadAdminActive: boolean;
  executorRolesLabel?: string;
  state: SquadBotState | null;
}): boolean {
  if (!input.state?.iAmHolder || !input.state?.hasLocalSecret) return false;
  if (!input.squadAdminActive) return true;
  return hasSquadAdminHolderManageRights(input.executorRolesLabel);
}

/** Pure eligibility: actor and target must be MLS members; actor must already be a holder. */
export function canAddBotHolder(
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
    return 'Squad Admin Full executor scope is required to manage bot key holders.';
  }
  if (!members.includes(actorNpub)) return 'You must be a squad member.';
  if (!members.includes(targetNpub)) return 'That person is not a current squad member.';
  if (!holders.includes(actorNpub)) return 'Only bot key holders can add holders.';
  if (holders.includes(targetNpub)) return 'Already a key holder.';
  return null;
}
