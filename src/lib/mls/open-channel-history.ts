import { get } from 'svelte/store';
import { getChatMessageCount, getDmMessages, queueChatProfilesSync } from '../api/nostr';
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

  queueChatProfilesSync(groupId, true).catch((err) => {
    dmError('open channel: queueChatProfilesSync failed', err);
  });

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

      const existing = get(backendGroupMessages)[groupId] ?? [];
      const merged = mergeOpenChannelPage(existing, loaded);
      if (merged === existing) return;

      backendGroupMessages.update((byGroup) => ({ ...byGroup, [groupId]: merged }));
      if (loaded.length > 0) {
        loadedOffsetByChat.update((by) => ({
          ...by,
          [groupId]: Math.max(by[groupId] ?? 0, PAGE_SIZE),
        }));
      }
      const parentId = parentIdForChannelGroup(get(squads), groupId) ?? parentIdAtOpen;
      ensureMlsAutomationReplayed(groupId, parentId);
    })
    .catch((err) => {
      if (!stillCurrent(requestGen, groupId)) return;
      dmError('open channel: getDmMessages failed', err);
    });
}

function visibleMlsChannelId(): string | null {
  const groupId = get(activeChannelId);
  if (get(activeTopNavTab) !== 'squads') return null;
  if (!groupId || isVirtualHubChannelId(groupId) || groupId.startsWith('creating-')) return null;
  return groupId;
}

/** Re-read the open MLS channel after sync; skip the page read when rows exist and the count is unchanged. */
export async function reloadOpenChannelHistoryIfVisible(): Promise<void> {
  const groupId = visibleMlsChannelId();
  if (!groupId) return;

  let count: number | null = null;
  try {
    count = await getChatMessageCount(groupId);
  } catch (err) {
    dmError('open channel: reload getChatMessageCount failed', err);
  }
  if (visibleMlsChannelId() !== groupId) return;

  const hasRows = (get(backendGroupMessages)[groupId]?.length ?? 0) > 0;
  if (hasRows && count !== null && count === get(messageCountByChat)[groupId]) return;
  loadOpenChannelHistory(groupId);
}
