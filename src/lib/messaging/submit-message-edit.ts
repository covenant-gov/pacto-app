import { editMessage } from '../api/nostr';
import { showToast } from '../../stores/toast';
import type { DmMessage } from '../../stores/dm';
import { buildEditedContent, editErrorMessage, isMeaningfulEdit } from './message-edit';

/**
 * Send an edit for `msg` in `chatId` (DM npub or MLS group id). Resolves `true`
 * when the editor can close: sent, or nothing changed. Failures toast and keep
 * the editor open so the draft is not lost.
 */
export async function submitMessageEdit(
  chatId: string,
  msg: DmMessage | undefined,
  newBody: string
): Promise<boolean> {
  if (!chatId || !msg) return false;
  if (!isMeaningfulEdit(msg.content, newBody)) return newBody.trim().length > 0;
  try {
    await editMessage(msg.id, chatId, buildEditedContent(msg.content, newBody));
    return true;
  } catch (e: unknown) {
    showToast(editErrorMessage(e));
    return false;
  }
}
