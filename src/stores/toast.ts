import { writable } from 'svelte/store';

const TOAST_DURATION_MS = 4000;

export interface ToastGoTo {
  type: 'squad';
  name: string;
  id: string;
  channelId: string;
  /** Selected hub row when channelId is shared by multiple sidebar channels. */
  hubChannelName?: string;
}

export interface ToastState {
  text: string;
  goTo?: ToastGoTo;
  retryLabel?: string;
}

export interface ToastRetryAction {
  label: string;
  action: () => void | Promise<void>;
}

/** Current toast; when set, Toast component shows it and auto-clears after TOAST_DURATION_MS. */
export const toastMessage = writable<ToastState | null>(null);

let clearTimeoutId: ReturnType<typeof setTimeout> | null = null;
let toastRetryAction: ToastRetryAction | null = null;

/** Clear the toast and any pending auto-dismiss timer. */
export function clearToast(): void {
  if (clearTimeoutId) {
    clearTimeout(clearTimeoutId);
    clearTimeoutId = null;
  }
  toastRetryAction = null;
  toastMessage.set(null);
}

export function runToastRetryAction(): void {
  const action = toastRetryAction?.action;
  if (!action) return;
  void action();
}

/** Show a short-lived toast (e.g. "[Squad name] is ready!"). Optionally pass goTo so the toast shows a "Go to [name]" button that navigates and closes. */
export function showToast(text: string, goTo?: ToastGoTo, retry?: ToastRetryAction): void {
  clearToast();
  toastRetryAction = retry ?? null;
  toastMessage.set({
    text,
    goTo,
    retryLabel: retry?.label,
  });
  const ms = goTo || retry ? Math.max(TOAST_DURATION_MS, 12_000) : TOAST_DURATION_MS;
  clearTimeoutId = setTimeout(() => {
    toastMessage.set(null);
    toastRetryAction = null;
    clearTimeoutId = null;
  }, ms);
}

/**
 * Pending "ready" toast to show from the root page. When set, +page.svelte subscribes and
 * calls showToast so the notification appears regardless of which view (DMs / Squads) is active.
 */
export const pendingReadyToast = writable<ToastState | null>(null);
