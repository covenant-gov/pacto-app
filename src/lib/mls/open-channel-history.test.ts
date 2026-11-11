import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { DmMessage } from '../../stores/dm';

const getChatMessageCount = vi.fn();
const getDmMessages = vi.fn();
const ensureMlsAutomationReplayed = vi.fn();

vi.mock('../api/nostr', () => ({
  getChatMessageCount: (...args: unknown[]) => getChatMessageCount(...args),
  getDmMessages: (...args: unknown[]) => getDmMessages(...args),
}));

vi.mock('../app/hub-prefetch', () => ({
  ensureMlsAutomationReplayed: (...args: unknown[]) => ensureMlsAutomationReplayed(...args),
}));

vi.mock('../squad-hub-nav', () => ({
  parentIdForChannelGroup: () => 'parent-1',
}));

vi.mock('../utils/dm-debug', () => ({
  dmLog: vi.fn(),
  dmError: vi.fn(),
}));

import {
  loadOpenChannelHistory,
  mergeOpenChannelPage,
  shouldApplyChannelOpenLoad,
} from './open-channel-history';
import { backendGroupMessages } from '../../stores/mls-chat';
import { activeChannelId, activeTopNavTab } from '../../stores/navigation';
import { loadedOffsetByChat, messageCountByChat } from '../../stores/dm';

function msg(id: string): DmMessage {
  return { id, content: id, at: 0, mine: false };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('mergeOpenChannelPage', () => {
  it('does not wipe a non-empty list with an empty page', () => {
    const existing = [msg('a'), msg('b')];
    expect(mergeOpenChannelPage(existing, [])).toBe(existing);
  });

  it('keeps store rows whose ids are absent from the page', () => {
    const existing = [msg('live'), msg('page-1')];
    const loaded = [msg('page-1'), msg('page-2')];
    expect(mergeOpenChannelPage(existing, loaded)).toEqual([
      msg('page-1'),
      msg('page-2'),
      msg('live'),
    ]);
  });

  it('keeps a single row for overlapping ids', () => {
    const existing = [msg('a'), msg('b')];
    const loaded = [msg('a')];
    const merged = mergeOpenChannelPage(existing, loaded);
    expect(merged.map((m) => m.id)).toEqual(['a', 'b']);
    expect(merged.filter((m) => m.id === 'a')).toHaveLength(1);
  });
});

describe('shouldApplyChannelOpenLoad', () => {
  it('applies when generation, group, and squads tab match', () => {
    expect(shouldApplyChannelOpenLoad(3, 3, 'g1', 'g1', 'squads')).toBe(true);
  });

  it('does not apply a stale generation', () => {
    expect(shouldApplyChannelOpenLoad(1, 2, 'g1', 'g1', 'squads')).toBe(false);
  });

  it('does not apply when a different channel is open', () => {
    expect(shouldApplyChannelOpenLoad(1, 1, 'g1', 'g2', 'squads')).toBe(false);
    expect(shouldApplyChannelOpenLoad(1, 1, 'g1', null, 'squads')).toBe(false);
  });

  it('does not apply off the squads tab', () => {
    expect(shouldApplyChannelOpenLoad(1, 1, 'g1', 'g1', 'dms')).toBe(false);
    expect(shouldApplyChannelOpenLoad(1, 1, 'g1', 'g1', 'commons')).toBe(false);
  });
});

describe('loadOpenChannelHistory', () => {
  const groupId = 'group-1';

  beforeEach(() => {
    vi.clearAllMocks();
    backendGroupMessages.set({});
    loadedOffsetByChat.set({});
    messageCountByChat.set({});
    activeChannelId.set(groupId);
    activeTopNavTab.set('squads');
    getChatMessageCount.mockResolvedValue(0);
  });

  it('leaves live rows, offset, and replay untouched when the page is empty', async () => {
    const live = [msg('live')];
    backendGroupMessages.set({ [groupId]: live });
    getDmMessages.mockResolvedValue([]);

    loadOpenChannelHistory(groupId);
    await flush();

    expect(get(backendGroupMessages)[groupId]).toBe(live);
    expect(get(loadedOffsetByChat)[groupId]).toBeUndefined();
    expect(ensureMlsAutomationReplayed).not.toHaveBeenCalled();
  });

  it('merges a non-empty page with live rows and replays automation', async () => {
    backendGroupMessages.set({ [groupId]: [msg('live')] });
    getDmMessages.mockResolvedValue([msg('page-1')]);

    loadOpenChannelHistory(groupId);
    await flush();

    expect(get(backendGroupMessages)[groupId].map((m) => m.id)).toEqual(['page-1', 'live']);
    expect(get(loadedOffsetByChat)[groupId]).toBe(100);
    expect(ensureMlsAutomationReplayed).toHaveBeenCalledWith(groupId, 'parent-1');
  });

  it('does not lower an offset already advanced by loading older rows', async () => {
    loadedOffsetByChat.set({ [groupId]: 150 });
    getDmMessages.mockResolvedValue([msg('page-1')]);

    loadOpenChannelHistory(groupId);
    await flush();

    expect(get(loadedOffsetByChat)[groupId]).toBe(150);
  });

  it('drops a response superseded by a newer load', async () => {
    const first = Promise.withResolvers<DmMessage[]>();
    getDmMessages.mockReturnValueOnce(first.promise).mockResolvedValueOnce([msg('fresh')]);

    loadOpenChannelHistory(groupId);
    loadOpenChannelHistory(groupId);
    await flush();
    first.resolve([msg('stale')]);
    await flush();

    expect(get(backendGroupMessages)[groupId].map((m) => m.id)).toEqual(['fresh']);
  });

  it('drops a response when the active channel changed', async () => {
    const pending = Promise.withResolvers<DmMessage[]>();
    getDmMessages.mockReturnValue(pending.promise);

    loadOpenChannelHistory(groupId);
    activeChannelId.set('group-2');
    pending.resolve([msg('late')]);
    await flush();

    expect(get(backendGroupMessages)[groupId]).toBeUndefined();
  });

  it('drops a response when the squads tab is no longer active', async () => {
    const pending = Promise.withResolvers<DmMessage[]>();
    getDmMessages.mockReturnValue(pending.promise);

    loadOpenChannelHistory(groupId);
    activeTopNavTab.set('dms');
    pending.resolve([msg('late')]);
    await flush();

    expect(get(backendGroupMessages)[groupId]).toBeUndefined();
  });
});
