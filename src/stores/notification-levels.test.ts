import { describe, it, expect, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

const { handlers } = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown) => void>();
  return { handlers };
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: (event: unknown) => void) => {
    handlers.set(event, handler);
    return Promise.resolve(() => {});
  },
}));

vi.mock('../lib/api/notifications', () => ({
  setNotificationLevel: vi.fn(),
}));

import { notificationLevels, setChatNotificationLevel } from './notification-levels';
import { setNotificationLevel } from '../lib/api/notifications';

describe('notification-levels store', () => {
  const chatId = 'npub1alice';

  afterEach(() => {
    notificationLevels.set({});
    vi.clearAllMocks();
  });

  it('has an empty map initially', () => {
    expect(get(notificationLevels)).toEqual({});
  });

  it('setting a level persists it and updates the store', async () => {
    vi.mocked(setNotificationLevel).mockResolvedValue(true);

    const ok = await setChatNotificationLevel(chatId, 'all');

    expect(ok).toBe(true);
    expect(setNotificationLevel).toHaveBeenCalledWith(chatId, 'all');
    expect(get(notificationLevels)[chatId]).toBe('all');
  });

  it('does not update the store when the backend call fails', async () => {
    vi.mocked(setNotificationLevel).mockResolvedValue(false);

    const ok = await setChatNotificationLevel(chatId, 'nothing');

    expect(ok).toBe(false);
    expect(get(notificationLevels)[chatId]).toBeUndefined();
  });

  describe('event listeners', () => {
    it('chat_notification_level_changed updates the store for a chat not set directly by this client', () => {
      const handler = handlers.get('chat_notification_level_changed');
      expect(handler).toBeDefined();

      handler?.({ payload: { chat_id: 'npub1bob', notification_level: 'nothing' } });

      expect(get(notificationLevels)['npub1bob']).toBe('nothing');
    });

    it('ignores a chat_notification_level_changed payload missing an id or level', () => {
      const handler = handlers.get('chat_notification_level_changed');
      handler?.({ payload: { chat_id: 'npub1bob' } });
      handler?.({ payload: { notification_level: 'all' } });

      expect(get(notificationLevels)).toEqual({});
    });

    it('init_finished hydrates the known level for every chat', () => {
      const handler = handlers.get('init_finished');
      expect(handler).toBeDefined();

      handler?.({
        payload: {
          chats: [
            { id: 'group1', notification_level: 'all' },
            { id: 'group2', notification_level: 'nothing' },
            { id: 'group3' },
          ],
        },
      });

      expect(get(notificationLevels)).toEqual({ group1: 'all', group2: 'nothing' });
    });
  });
});
