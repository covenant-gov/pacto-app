import { get } from 'svelte/store';
import { startTyping } from '../api/nostr';
import { sendTypingIndicatorsEnabled } from '../../stores/typing-indicators';

const TYPING_DEBOUNCE_MS = 400;

let typingTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Notify the other party that we're typing, debounced and gated by the
 * "Send Typing Indicators" preference. No-ops when the preference is off
 * or there's no active chat.
 */
export function notifyTyping(npub: string | null): void {
  if (!npub) return;
  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    typingTimeout = null;
    if (!get(sendTypingIndicatorsEnabled)) return;
    startTyping(npub).catch(() => {});
  }, TYPING_DEBOUNCE_MS);
}

/** Test-only: reset debounce state between tests. */
export function resetTypingNotifierForTests(): void {
  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = null;
}
