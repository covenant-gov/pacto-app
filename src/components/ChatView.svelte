<script lang="ts">
  import Message from './Message.svelte';
  import MessageInput from './MessageInput.svelte';
  import {
    activeChannelId,
    squads,
    activeSquadId,
    ungroupedChannels,
    backendGroupMessages,
    messageCountByChat,
    loadedOffsetByChat,
    groupSendError,
    type DmMessage,
  } from '../stores/app';
  import { sendDmMessage, getDmMessages } from '../lib/api/nostr';
  import { getInvokeErrorMessage, friendlyMessage } from '../lib/utils/tauri-errors';
  import { getProfileAvatarSrc, getProfileDisplayName } from '../lib/utils/profile';
  import { profiles } from '../stores/profiles';
  import { currentUser } from '../stores/auth';

  const LOAD_OLDER_PAGE_SIZE = 50;

  $: activeSquad = $squads.find((c) => c.id === $activeSquadId);
  $: activeChannel =
    activeSquad?.channels.find((ch) => ch.id === $activeChannelId || ch.groupId === $activeChannelId) ??
    $ungroupedChannels.find((ch) => ch.groupId === $activeChannelId);
  $: channelName = activeChannel?.name || 'channel';

  $: currentMessages = (() => {
    if (!$activeChannelId) return [];
    const list = [...($backendGroupMessages[$activeChannelId] ?? [])];
    list.sort((a, b) => a.at - b.at);
    return list;
  })();

  function toMessageProps(msg: DmMessage) {
    const currentUserNpub = $currentUser?.npub;
    const currentUserProfile = currentUserNpub ? $profiles[currentUserNpub] : null;
    if (msg.mine) {
      return {
        authorName: 'You',
        content: msg.content,
        timestamp: new Date(msg.at).toISOString(),
        avatar: getProfileAvatarSrc(currentUserProfile) ?? '',
      };
    }
    const senderProfile = msg.npub ? $profiles[msg.npub] : null;
    return {
      authorName: getProfileDisplayName(senderProfile),
      content: msg.content,
      timestamp: new Date(msg.at).toISOString(),
      avatar: getProfileAvatarSrc(senderProfile) ?? '',
    };
  }

  let prevChannelId: string | null = null;
  $: if (prevChannelId !== $activeChannelId) {
    prevChannelId = $activeChannelId;
    groupSendError.set(null);
  }

  let loadingOlder = false;
  async function handleSendMessage(content: string) {
    const groupId = $activeChannelId;
    if (!groupId) return;
    groupSendError.set(null);
    try {
      await sendDmMessage(groupId, content, '');
    } catch (e: unknown) {
      const raw = getInvokeErrorMessage(e, 'Failed to send message');
      groupSendError.set(friendlyMessage(raw, 'dm_send'));
    }
  }

  $: canLoadOlder =
    $activeChannelId &&
    ($messageCountByChat[$activeChannelId] ?? 0) > ($backendGroupMessages[$activeChannelId]?.length ?? 0);

  async function loadOlder() {
    const groupId = $activeChannelId;
    if (!groupId || loadingOlder) return;
    loadingOlder = true;
    try {
      const offset = $loadedOffsetByChat[groupId] ?? 0;
      const older = await getDmMessages(groupId, LOAD_OLDER_PAGE_SIZE, offset);
      backendGroupMessages.update((byGroup) => {
        const list = byGroup[groupId] ?? [];
        const ids = new Set(list.map((m) => m.id));
        const newMsgs = (older as DmMessage[]).filter((m) => !ids.has(m.id));
        return { ...byGroup, [groupId]: [...newMsgs, ...list].sort((a, b) => a.at - b.at) };
      });
      loadedOffsetByChat.update((by) => ({ ...by, [groupId]: offset + older.length }));
    } finally {
      loadingOlder = false;
    }
  }

  let messagesContainer: HTMLDivElement;
  $: if (currentMessages.length && messagesContainer) {
    setTimeout(() => {
      const isNearBottom =
        messagesContainer.scrollHeight -
          messagesContainer.scrollTop -
          messagesContainer.clientHeight <
        100;
      if (isNearBottom) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }, 0);
  }
</script>

<div class="chat-view">
  {#if activeChannel}
    <div class="channel-header">
      <div class="channel-info">
        <span class="channel-icon">#</span>
        <h3 class="channel-name">{channelName}</h3>
      </div>
    </div>

    <div class="messages-container" bind:this={messagesContainer}>
      <div class="messages-list">
        {#if canLoadOlder}
          <div class="load-older-wrap">
            <button
              type="button"
              class="load-older-btn"
              on:click={loadOlder}
              disabled={loadingOlder}
            >
              {loadingOlder ? 'Loading…' : 'Load older messages'}
            </button>
          </div>
        {/if}
        {#each currentMessages as message (message.id)}
          <Message {...toMessageProps(message)} />
        {/each}
      </div>
    </div>
    {#if $groupSendError}
      <p class="channel-send-error" role="alert">{$groupSendError}</p>
    {/if}
    <MessageInput channelName={channelName} onSend={handleSendMessage} />
  {:else}
    <div class="empty-state">
      <p>Select a channel to start chatting</p>
    </div>
  {/if}
</div>

<style>
  .chat-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: #242424;
    height: 100%;
    min-width: 0;
    border-left: 1px solid #313338;
  }

  .channel-header {
    height: 48px;
    border-bottom: 1px solid #313338;
    display: flex;
    align-items: center;
    padding: 0 16px;
    flex-shrink: 0;
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
  }

  .channel-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .channel-icon {
    color: #80848e;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .channel-name {
    color: #f2f3f5;
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }

  .messages-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
  }

  .messages-list {
    display: flex;
    flex-direction: column;
    padding: 16px 0;
  }

  .load-older-wrap {
    margin-bottom: 16px;
  }

  .load-older-btn {
    padding: 8px 16px;
    font-size: 0.875rem;
    color: #b5bac1;
    background: #2b2d31;
    border: 1px solid #404249;
    border-radius: 8px;
    cursor: pointer;
  }

  .load-older-btn:hover:not(:disabled) {
    color: #f2f3f5;
    background: #4e5058;
  }

  .load-older-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .channel-send-error {
    font-size: 0.875rem;
    color: #ed4245;
    margin: 0 16px 8px;
  }

  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #949ba4;
    font-size: 0.875rem;
  }

  /* Scrollbar styling */
  .messages-container::-webkit-scrollbar {
    width: 8px;
  }

  .messages-container::-webkit-scrollbar-track {
    background: transparent;
  }

  .messages-container::-webkit-scrollbar-thumb {
    background: #1a1b1e;
    border-radius: 4px;
  }

  .messages-container::-webkit-scrollbar-thumb:hover {
    background: #1e1f22;
  }
</style>

