import { writable } from 'svelte/store';

const TOAST_DURATION_MS = 8_000;
const TOAST_ERROR_DURATION_MS = 20_000;
const TOAST_ACTION_DURATION_MS = 12_000;

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
  /** When true, toast stays longer and uses error styling. */
  error?: boolean;
}

export interface ToastRetryAction {
  label: string;
  action: () => void | Promise<void>;
}

export interface ShowToastOptions {
  durationMs?: number;
  error?: boolean;
}

/** Current toast; when set, Toast component shows it and auto-clears after the duration. */
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

/** Show a toast. Errors stay longer so they can be read/copied. */
export function showToast(
  text: string,
  goTo?: ToastGoTo,
  retry?: ToastRetryAction,
  opts?: ShowToastOptions,
): void {
  clearToast();
  toastRetryAction = retry ?? null;
  const error = opts?.error === true;
  toastMessage.set({
    text,
    goTo,
    retryLabel: retry?.label,
    error: error || undefined,
  });
  const ms =
    opts?.durationMs ??
    (error
      ? TOAST_ERROR_DURATION_MS
      : goTo || retry
        ? Math.max(TOAST_DURATION_MS, TOAST_ACTION_DURATION_MS)
        : TOAST_DURATION_MS);
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
