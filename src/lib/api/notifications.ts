import { invoke } from './index';

/**
 * Backend: `NotificationSound` (src-tauri/src/audio.rs). Adjacently tagged —
 * `{ type: 'Custom', path }` carries the custom file path; the other variants carry nothing.
 */
export type NotificationSound =
  | { type: 'Default' }
  | { type: 'Techno' }
  | { type: 'None' }
  | { type: 'Custom'; path: string };

/**
 * Backend: `NotificationSettings` (src-tauri/src/audio.rs). Field names are the raw wire
 * shape — the Rust struct has no camelCase rename, so `global_mute` travels as-is over IPC.
 */
export interface NotificationSettings {
  global_mute: boolean;
  sound: NotificationSound;
}

/** The fixed, non-custom sound choices the backend supports. */
export const BUILT_IN_NOTIFICATION_SOUNDS: readonly NotificationSound[] = [
  { type: 'Default' },
  { type: 'Techno' },
  { type: 'None' },
];

/** Backend: `get_notification_settings`. Returns defaults (unmuted, Default sound) if nothing was saved yet. */
export async function getNotificationSettings(): Promise<NotificationSettings> {
  return await invoke<NotificationSettings>('get_notification_settings');
}

/** Backend: `set_notification_settings`. Persists the sound choice and the global mute together. */
export async function setNotificationSettings(settings: NotificationSettings): Promise<void> {
  await invoke('set_notification_settings', { settings });
}

/** Backend: `preview_notification_sound`. Plays the sound once; never persists a settings change. */
export async function previewNotificationSound(sound: NotificationSound): Promise<void> {
  await invoke('preview_notification_sound', { sound });
}

/**
 * Backend: `select_custom_notification_sound`. Opens a native file dialog, validates and copies
 * the chosen file into the sound cache, and resolves with its stored path. Rejects with
 * "No file selected" if the dialog is cancelled, or "FILE_TOO_LARGE" over the 1MB limit.
 */
export async function selectCustomNotificationSound(): Promise<string> {
  return await invoke<string>('select_custom_notification_sound');
}

/**
 * OS notification permission, read from `window.Notification` — which
 * `tauri-plugin-notification` (already registered in `lib.rs`) backs with the native OS
 * answer via an injected webview script, so this reflects the plugin's own state with no
 * separate `@tauri-apps/plugin-notification` frontend dependency required.
 *
 * Per KTD10, desktop unconditionally reports "granted" even when the OS has notifications
 * switched off for Pacto — callers must present this as system state, not an app-controlled toggle.
 */
export type NotificationPermissionState = NotificationPermission | 'unsupported';

/** Current permission, without prompting. */
export function getNotificationPermissionState(): NotificationPermissionState {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** Settles an undetermined ("default") permission. Safe to call when already decided. */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported';
  return await Notification.requestPermission();
}

/**
 * Backend: `get_unread_counts`. The single per-chat unread map — keyed by
 * npub for DMs and by group id for MLS chats — every badge surface reads
 * from. No client-side filtering or counting; the backend already applies
 * the per-chat notification level and blocked-peer skips.
 */
export async function getUnreadCounts(): Promise<Record<string, number>> {
  return await invoke<Record<string, number>>('get_unread_counts');
}

/**
 * Backend: `NotificationLevel` (src-tauri/src/chat.rs). Serializes as its snake_case
 * variant name — the enum has no separate wire rename.
 */
export type NotificationLevel = 'all' | 'mentions' | 'nothing';

/** Column/backend default applied to every chat with no explicit choice (R10). */
export const DEFAULT_NOTIFICATION_LEVEL: NotificationLevel = 'mentions';

/**
 * Backend: `set_notification_level`. Persists the chat's level, emits
 * `chat_notification_level_changed` for every listening surface, and synchronously refreshes
 * unread badges before resolving (R17) — no debounce window to wait out. Returns false if the
 * chat id is unknown.
 */
export async function setNotificationLevel(chatId: string, level: NotificationLevel): Promise<boolean> {
  return await invoke<boolean>('set_notification_level', { chatId, level });
}
