import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { sendVoiceMessage } from '../api/voice';
import { friendlyMessage, getInvokeErrorMessage } from '../utils/tauri-errors';
import { dmError } from '../utils/dm-debug';

/**
 * Sends a recorded clip to a DM (npub) or MLS channel (group id). Reports a
 * user-facing error through `onError` and resolves `false` instead of throwing,
 * so the recorder can keep the clip for a retry.
 */
export async function sendVoiceClip(
  receiver: string,
  bytes: Uint8Array,
  repliedTo: string,
  onError: (message: string) => void,
): Promise<boolean> {
  try {
    const ok = await sendVoiceMessage(receiver, repliedTo, bytes);
    if (!ok) onError(get(t)('errors.dm.voiceFailed'));
    return ok;
  } catch (e: unknown) {
    dmError('sendVoiceClip error', e);
    onError(friendlyMessage(getInvokeErrorMessage(e, get(t)('errors.dm.voiceFailed')), 'dm_send'));
    return false;
  }
}
