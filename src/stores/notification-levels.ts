import { writable } from 'svelte/store';
import { listen } from '../lib/api';
import { setNotificationLevel, type NotificationLevel } from '../lib/api/notifications';

/** Per-chat notification level, keyed by chat id. A missing entry is the backend default (Mentions). */
export const notificationLevels = writable<Record<string, NotificationLevel>>({});

type InitFinishedChatsPayload = {
  chats?: Array<{ id?: string; notification_level?: NotificationLevel }>;
};

type LevelChangedPayload = {
  chat_id?: string;
  notification_level?: NotificationLevel;
};

// Hydrate every chat's level from the initial DB load (covers levels set in a prior session,
// before this client ever calls setChatNotificationLevel itself).
(async () => {
  try {
    await listen<InitFinishedChatsPayload>('init_finished', (event) => {
      const chats = event.payload?.chats;
      if (!Array.isArray(chats)) return;
      notificationLevels.update((levels) => {
        const next = { ...levels };
        for (const chat of chats) {
          if (chat?.id && chat.notification_level) next[chat.id] = chat.notification_level;
        }
        return next;
      });
    });
  } catch (error) {
    console.error('Failed to register init_finished event listener (notification levels):', error);
  }
})();

// Backend: `chat_notification_level_changed`, emitted by `set_notification_level` after it
// persists. Round-trips back to this client's own calls too, so `setChatNotificationLevel`
// below doesn't need to special-case its own writes.
(async () => {
  try {
    await listen<LevelChangedPayload>('chat_notification_level_changed', (event) => {
      const { chat_id, notification_level } = event.payload ?? {};
      if (!chat_id || !notification_level) return;
      notificationLevels.update((levels) => ({ ...levels, [chat_id]: notification_level }));
    });
  } catch (error) {
    console.error('Failed to register chat_notification_level_changed event listener:', error);
  }
})();

/** Persists a chat's level through the backend, then reflects it locally once the command confirms it. */
export async function setChatNotificationLevel(chatId: string, level: NotificationLevel): Promise<boolean> {
  const ok = await setNotificationLevel(chatId, level);
  if (ok) {
    notificationLevels.update((levels) => ({ ...levels, [chatId]: level }));
  }
  return ok;
}
