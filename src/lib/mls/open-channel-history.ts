import { get } from 'svelte/store';
import { getChatMessageCount, getDmMessages } from '../api/nostr';
import { ensureMlsAutomationReplayed } from '../app/hub-prefetch';
import { parentIdForChannelGroup } from '../squad-hub-nav';
import { isVirtualHubChannelId } from '../squad/hub-channel-names';
import { dmError, dmLog } from '../utils/dm-debug';
import { backendGroupMessages } from '../../stores/mls-chat';
import { activeChannelId, activeTopNavTab } from '../../stores/navigation';
import { loadedOffsetByChat, messageCountByChat, type DmMessage } from '../../stores/dm';
import { squads } from '../../stores/squads';

const PAGE_SIZE = 100;

let openChannelHistoryGen = 0;

/** Keep live rows when the first page is empty; otherwise union by id (page first). */
export function mergeOpenChannelPage(existing: DmMessage[], loaded: DmMessage[]): DmMessage[] {
  if (loaded.length === 0 && existing.length > 0) return existing;
  const loadedIds = new Set(loaded.map((m) => m.id));
  const fromExisting = existing.filter((m) => !loadedIds.has(m.id));
  return [...loaded, ...fromExisting];
}

/** Apply an in-flight open-channel read only while that request is still the visible Squads channel. */
export function shouldApplyChannelOpenLoad(
  requestGen: number,
  currentGen: number,
  requestGroupId: string,
  channelId: string | null,
  topNavTab: string
): boolean {
  return requestGen === currentGen && channelId === requestGroupId && topNavTab === 'squads';
}

function stillCurrent(requestGen: number, groupId: string): boolean {
  return shouldApplyChannelOpenLoad(
    requestGen,
    openChannelHistoryGen,
    groupId,
    get(activeChannelId),
    get(activeTopNavTab)
  );
}

/** Load the first page for an MLS channel; drop stale responses and do not wipe live rows. */
export function loadOpenChannelHistory(groupId: string): void {
  const requestGen = ++openChannelHistoryGen;
  const parentIdAtOpen = parentIdForChannelGroup(get(squads), groupId);
  dmLog('open channel', { groupId: groupId.slice(0, 20) + '…' });

  getChatMessageCount(groupId)
    .then((count) => {
      if (!stillCurrent(requestGen, groupId)) return;
      messageCountByChat.update((by) => ({ ...by, [groupId]: count }));
    })
    .catch((err) => {
      if (!stillCurrent(requestGen, groupId)) return;
      dmError('open channel: getChatMessageCount failed', err);
    });

  getDmMessages(groupId, PAGE_SIZE, 0)
    .then((msgs) => {
      if (!stillCurrent(requestGen, groupId)) return;
      const loaded = msgs as DmMessage[];
      dmLog('open channel: messages loaded', {
        groupId: groupId.slice(0, 20) + '…',
        count: loaded.length,
      });

      let ignoredEmpty = false;
      backendGroupMessages.update((byGroup) => {
        const existing = byGroup[groupId] ?? [];
        if (loaded.length === 0 && existing.length > 0) {
          ignoredEmpty = true;
          return byGroup;
        }
        return { ...byGroup, [groupId]: mergeOpenChannelPage(existing, loaded) };
      });

      if (ignoredEmpty) return;
      if (loaded.length > 0) {
        loadedOffsetByChat.update((by) => ({ ...by, [groupId]: PAGE_SIZE }));
      }
      const parentId = parentIdForChannelGroup(get(squads), groupId) ?? parentIdAtOpen;
      ensureMlsAutomationReplayed(groupId, parentId);
    })
    .catch((err) => {
      if (!stillCurrent(requestGen, groupId)) return;
      dmError('open channel: getDmMessages failed', err);
    });
}

/** Re-read the open MLS channel after sync so a pre-sync empty page cannot stick. */
export function reloadOpenChannelHistoryIfVisible(): void {
  const groupId = get(activeChannelId);
  if (get(activeTopNavTab) !== 'squads') return;
  if (!groupId || isVirtualHubChannelId(groupId) || groupId.startsWith('creating-')) return;
  loadOpenChannelHistory(groupId);
}
