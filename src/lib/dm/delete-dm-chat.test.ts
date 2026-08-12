import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../api/nostr', () => ({
  deleteDmChatBackend: vi.fn(),
}));

vi.mock('../../stores/toast', () => ({
  showToast: vi.fn(),
}));

import { deleteDmChatBackend } from '../api/nostr';
import { showToast } from '../../stores/toast';
import {
  activeDmId,
  backendDmMessages,
  deletingDmNpubs,
  dmChatsByNpub,
  messageCountByChat,
  pinnedDmNpubs,
  typingByChat,
} from '../../stores/dm';
import { unreadCountsByChat } from '../../stores/unread';
import { startDeleteDmChat } from './delete-dm-chat';

const mockedDeleteBackend = vi.mocked(deleteDmChatBackend);
const mockedShowToast = vi.mocked(showToast);

describe('startDeleteDmChat', () => {
  beforeEach(() => {
    deletingDmNpubs.set(new Set());
    activeDmId.set('alice');
    dmChatsByNpub.set({
      alice: {
        npub: 'alice',
        name: 'alice',
        hasFromMe: true,
        hasFromThem: true,
        lastAt: 1,
      },
    });
    backendDmMessages.set({
      alice: [{ id: 'm1', content: 'hi', at: 1, mine: false }],
    });
    messageCountByChat.set({ alice: 1 });
    pinnedDmNpubs.set(new Set(['alice']));
    typingByChat.set({ alice: ['alice'] });
    unreadCountsByChat.set({ alice: 3 });
    vi.clearAllMocks();
  });

  it('clears frontend state immediately and still invokes backend', async () => {
    let resolveDelete!: () => void;
    mockedDeleteBackend.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveDelete = resolve;
      }),
    );

    startDeleteDmChat('alice');

    expect(get(deletingDmNpubs).has('alice')).toBe(true);
    expect(get(dmChatsByNpub)['alice']).toBeUndefined();
    expect(get(backendDmMessages)['alice']).toBeUndefined();
    expect(get(typingByChat)['alice']).toBeUndefined();
    expect(get(unreadCountsByChat)['alice']).toBe(0);
    expect(get(activeDmId)).toBeNull();
    expect(mockedDeleteBackend).toHaveBeenCalledWith('alice');

    resolveDelete();
    await vi.waitFor(() => {
      expect(get(deletingDmNpubs).has('alice')).toBe(false);
    });

    expect(get(dmChatsByNpub)['alice']).toBeUndefined();
    expect(get(activeDmId)).toBeNull();
    expect(mockedShowToast).not.toHaveBeenCalled();
  });

  it('reverts chat state, reselects peer, and toasts on unexpected backend failure', async () => {
    mockedDeleteBackend.mockRejectedValueOnce(new Error('boom'));

    startDeleteDmChat('alice');

    await vi.waitFor(() => {
      expect(get(deletingDmNpubs).has('alice')).toBe(false);
    });

    expect(get(dmChatsByNpub)['alice']).toBeDefined();
    expect(get(backendDmMessages)['alice']).toHaveLength(1);
    expect(get(unreadCountsByChat)['alice']).toBe(3);
    expect(get(activeDmId)).toBe('alice');
    expect(mockedShowToast).toHaveBeenCalledWith('Could not delete chat. Please try again.');
  });

  it('treats Chat not found as success without reverting or reselecting', async () => {
    mockedDeleteBackend.mockRejectedValueOnce(
      new Error('Chat not found: npub1alicexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'),
    );

    startDeleteDmChat('alice');

    await vi.waitFor(() => {
      expect(get(deletingDmNpubs).has('alice')).toBe(false);
    });

    expect(get(dmChatsByNpub)['alice']).toBeUndefined();
    expect(get(backendDmMessages)['alice']).toBeUndefined();
    expect(get(unreadCountsByChat)['alice']).toBe(0);
    expect(get(activeDmId)).toBeNull();
    expect(mockedShowToast).not.toHaveBeenCalled();
  });

  it('no-ops when a delete is already in flight for the peer', () => {
    deletingDmNpubs.set(new Set(['alice']));
    startDeleteDmChat('alice');
    expect(mockedDeleteBackend).not.toHaveBeenCalled();
  });
});
