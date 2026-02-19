import { writable } from 'svelte/store';

const TOAST_DURATION_MS = 4000;

export interface ToastGoTo {
  type: 'squad' | 'network';
  name: string;
  id: string;
  channelId: string;
}

export interface ToastState {
  text: string;
  goTo?: ToastGoTo;
}

/** Current toast; when set, Toast component shows it and auto-clears after TOAST_DURATION_MS. */
export const toastMessage = writable<ToastState | null>(null);

let clearTimeoutId: ReturnType<typeof setTimeout> | null = null;

/** Clear the toast and any pending auto-dismiss timer. */
export function clearToast(): void {
  if (clearTimeoutId) {
    clearTimeout(clearTimeoutId);
    clearTimeoutId = null;
  }
  toastMessage.set(null);
}

/** Show a short-lived toast (e.g. "[Squad name] is ready!"). Optionally pass goTo so the toast shows a "Go to [name]" button that navigates and closes. */
export function showToast(text: string, goTo?: ToastGoTo): void {
  clearToast();
  toastMessage.set(goTo ? { text, goTo } : { text });
  clearTimeoutId = setTimeout(() => {
    toastMessage.set(null);
    clearTimeoutId = null;
  }, TOAST_DURATION_MS);
}

/**
 * Pending "ready" toast to show from the root page. When set, +page.svelte subscribes and
 * calls showToast so the notification appears regardless of which view (DMs / Squads / Networks) is active.
 */
export const pendingReadyToast = writable<ToastState | null>(null);
