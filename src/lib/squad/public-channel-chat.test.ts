import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/nostr', () => ({
  sendDmMessage: vi.fn().mockResolvedValue(true),
  sendPublicChannelMessage: vi.fn().mockResolvedValue(true),
}));

vi.mock('svelte-i18n', async () => {
  const { readable } = await import('svelte/store');
  return { t: readable((key: string) => key) };
});

import { sendDmMessage, sendPublicChannelMessage } from '../api/nostr';
import { blockedOnPublicChannel, isPublicChannelAccess, sendChannelText } from './public-channel-chat';

describe('public channel chat helpers', () => {
  beforeEach(() => {
    vi.mocked(sendDmMessage).mockClear();
    vi.mocked(sendPublicChannelMessage).mockClear();
  });

  it('detects public access only', () => {
    expect(isPublicChannelAccess('public')).toBe(true);
    expect(isPublicChannelAccess('open')).toBe(false);
    expect(isPublicChannelAccess(undefined)).toBe(false);
  });

  it('blocks and notifies on public channels only', () => {
    const notify = vi.fn();
    expect(blockedOnPublicChannel(false, notify)).toBe(false);
    expect(notify).not.toHaveBeenCalled();
    expect(blockedOnPublicChannel(true, notify)).toBe(true);
    expect(notify).toHaveBeenCalledWith('messaging.channel.publicTextOnly');
  });

  it('public send uses the raw body and never the MLS path', async () => {
    await sendChannelText({
      isPublic: true,
      groupId: 'ab'.repeat(32),
      body: 'hi',
      mlsContent: '{"mention":"envelope"}',
      repliedTo: 'r1',
      virtualBucket: 'announcements',
    });
    expect(sendPublicChannelMessage).toHaveBeenCalledWith('ab'.repeat(32), 'hi', 'r1');
    expect(sendDmMessage).not.toHaveBeenCalled();
  });

  it('non-public send uses the MLS content and bucket', async () => {
    await sendChannelText({
      isPublic: false,
      groupId: 'g1',
      body: 'hi',
      mlsContent: 'mls-hi',
      repliedTo: '',
      virtualBucket: 'announcements',
    });
    expect(sendDmMessage).toHaveBeenCalledWith('g1', 'mls-hi', '', { virtualBucket: 'announcements' });
    expect(sendPublicChannelMessage).not.toHaveBeenCalled();
  });
});
