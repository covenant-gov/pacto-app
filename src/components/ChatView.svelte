<script lang="ts">
  import Message from './Message.svelte';
  import MessageInput from './MessageInput.svelte';
  import {
    activeChannelId,
    squads,
    activeSquadId,
    ungroupedChannels,
    dmList,
    requestsList,
    pendingList,
    backendGroupMessages,
    messageCountByChat,
    loadedOffsetByChat,
    groupSendError,
    type DmMessage,
  } from '../stores/app';
  import { sendDmMessage, getDmMessages, leaveMlsGroup, getMlsGroupMembers, inviteMemberToGroup } from '../lib/api/nostr';
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
  $: isAnnouncementsChannel = activeSquad?.channels[0]?.groupId === $activeChannelId;
  $: isChannelCreating = (activeChannel?.groupId?.startsWith('creating-') ?? false);

  let channelMenuOpen = false;
  let showMembersModal = false;
  let showInviteToChannelModal = false;
  let channelMembers: string[] = [];
  let loadingMembers = false;
  let inviteToChannelCandidates: string[] = [];
  let loadingInviteCandidates = false;
  let selectedInviteNpub: string | null = null;
  let invitingToChannel = false;
  let inviteToChannelError = '';
  let leavingChannel = false;
  let leaveChannelError = '';

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

  function closeChannelMenu() {
    channelMenuOpen = false;
  }

  async function handleLeaveChannel() {
    const groupId = $activeChannelId;
    if (!groupId || leavingChannel) return;
    leavingChannel = true;
    leaveChannelError = '';
    try {
      if (groupId.startsWith('creating-')) {
        const inSquad = activeSquad?.channels.some((ch) => ch.groupId === groupId);
        if (inSquad && activeSquad) {
          squads.update((list) =>
            list.map((s) =>
              s.id !== activeSquad.id
                ? s
                : { ...s, channels: s.channels.filter((ch) => ch.groupId !== groupId) }
            )
          );
          const still = $squads.find((s) => s.id === activeSquad.id);
          activeChannelId.set(still?.channels[0]?.groupId ?? null);
          if (still?.channels.length === 0) activeSquadId.set(null);
        } else {
          activeChannelId.set(null);
        }
        closeChannelMenu();
        return;
      }
      await leaveMlsGroup(groupId);
      const inSquad = activeSquad?.channels.some((ch) => ch.groupId === groupId);
      if (inSquad && activeSquad) {
        squads.update((list) =>
          list.map((s) =>
            s.id !== activeSquad.id
              ? s
              : { ...s, channels: s.channels.filter((ch) => ch.groupId !== groupId) }
          )
        );
        const still = $squads.find((s) => s.id === activeSquad.id);
        activeChannelId.set(still?.channels[0]?.groupId ?? null);
        if (still?.channels.length === 0) activeSquadId.set(null);
      } else {
        ungroupedChannels.update((ch) => ch.filter((c) => c.groupId !== groupId));
        activeChannelId.set(null);
      }
      closeChannelMenu();
    } catch (e: unknown) {
      leaveChannelError = friendlyMessage(getInvokeErrorMessage(e, 'Failed to leave channel'));
    } finally {
      leavingChannel = false;
    }
  }

  function openMembersModal() {
    showMembersModal = true;
    channelMembers = [];
    closeChannelMenu();
    loadChannelMembers();
  }
  async function loadChannelMembers() {
    const groupId = $activeChannelId;
    if (!groupId) return;
    loadingMembers = true;
    try {
      const result = await getMlsGroupMembers(groupId);
      channelMembers = result.members ?? [];
    } catch {
      channelMembers = [];
    } finally {
      loadingMembers = false;
    }
  }

  function openInviteToChannelModal() {
    showInviteToChannelModal = true;
    selectedInviteNpub = null;
    inviteToChannelError = '';
    closeChannelMenu();
    loadInviteToChannelCandidates();
  }
  async function loadInviteToChannelCandidates() {
    const groupId = $activeChannelId;
    if (!groupId) return;
    loadingInviteCandidates = true;
    try {
      const result = await getMlsGroupMembers(groupId);
      const inChannel = new Set(result.members ?? []);
      const myNpub = $currentUser?.npub;
      if (activeSquad && !isAnnouncementsChannel) {
        const ann = activeSquad.channels[0];
        if (ann) {
          const annResult = await getMlsGroupMembers(ann.groupId);
          const squadNpubs = annResult.members ?? [];
          inviteToChannelCandidates = squadNpubs.filter((n) => n !== myNpub && !inChannel.has(n));
        } else inviteToChannelCandidates = [];
      } else if (!activeSquad) {
        const allDm = [...$dmList, ...$requestsList, ...$pendingList].map((e) => e.npub);
        const unique = [...new Set(allDm)];
        inviteToChannelCandidates = unique.filter((n) => n !== myNpub && !inChannel.has(n));
      } else {
        inviteToChannelCandidates = [];
      }
    } catch {
      inviteToChannelCandidates = [];
    } finally {
      loadingInviteCandidates = false;
    }
  }
  async function handleInviteToChannel() {
    const groupId = $activeChannelId;
    if (!groupId || !selectedInviteNpub || invitingToChannel) return;
    invitingToChannel = true;
    inviteToChannelError = '';
    try {
      await inviteMemberToGroup(groupId, selectedInviteNpub);
      showInviteToChannelModal = false;
    } catch (e: unknown) {
      inviteToChannelError = friendlyMessage(getInvokeErrorMessage(e, 'Failed to invite'));
    } finally {
      invitingToChannel = false;
    }
  }

  let messagesContainer: HTMLDivElement | null = null;
  $: if (currentMessages.length && messagesContainer) {
    const el = messagesContainer;
    setTimeout(() => {
      if (!el || !document.contains(el)) return;
      const isNearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      if (isNearBottom) {
        el.scrollTop = el.scrollHeight;
      }
    }, 0);
  }
</script>

<svelte:window
  on:click={(e) => {
    const t = e.target as HTMLElement | null;
    if (channelMenuOpen && t && !t.closest('.channel-header-actions')) closeChannelMenu();
  }}
/>
<div class="chat-view">
  {#if activeChannel}
    <div class="channel-header">
      <div class="channel-info">
        <span class="channel-icon">#</span>
        <h3 class="channel-name">{channelName}</h3>
      </div>
      <div class="channel-header-actions">
        <button
          type="button"
          class="channel-menu-btn"
          title="Channel options"
          on:click={() => (channelMenuOpen = !channelMenuOpen)}
        >
          ⋯
        </button>
        {#if channelMenuOpen}
          <div class="channel-menu-dropdown" role="menu">
            <button type="button" class="channel-menu-item" role="menuitem" on:click={openMembersModal}>
              Members
            </button>
            {#if !isAnnouncementsChannel}
              <button type="button" class="channel-menu-item" role="menuitem" on:click={openInviteToChannelModal}>
                Invite to channel
              </button>
            {/if}
            <button
              type="button"
              class="channel-menu-item channel-menu-item-danger"
              role="menuitem"
              disabled={leavingChannel}
              on:click={handleLeaveChannel}
            >
              {leavingChannel ? 'Leaving…' : 'Leave channel'}
            </button>
          </div>
        {/if}
      </div>
    </div>
    {#if leaveChannelError}
      <p class="channel-send-error" role="alert">{leaveChannelError}</p>
    {/if}

    <div class="messages-container" bind:this={messagesContainer}>
      <div class="messages-list">
        {#if isChannelCreating}
          <p class="channel-creating-message">Private group channel is being created.</p>
        {:else}
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
        {/if}
      </div>
    </div>
    {#if $groupSendError}
      <p class="channel-send-error" role="alert">{$groupSendError}</p>
    {/if}
    <MessageInput channelName={channelName} onSend={handleSendMessage} disabled={isChannelCreating} />

    <!-- Members modal -->
    {#if showMembersModal}
      <div class="channel-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="members-modal-title">
        <div class="channel-modal">
          <h2 id="members-modal-title">Members</h2>
          {#if loadingMembers}
            <p class="channel-modal-loading">Loading…</p>
          {:else}
            <ul class="channel-members-list">
              {#each channelMembers as npub (npub)}
                <li class="channel-member-item">{getProfileDisplayName($profiles[npub]) || npub.slice(0, 16) + '…'}</li>
              {/each}
            </ul>
          {/if}
          <button type="button" class="channel-modal-close" on:click={() => (showMembersModal = false)}>Close</button>
        </div>
      </div>
    {/if}

    <!-- Invite to channel modal -->
    {#if showInviteToChannelModal}
      <div class="channel-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="invite-channel-modal-title">
        <div class="channel-modal">
          <h2 id="invite-channel-modal-title">Invite to channel</h2>
          {#if loadingInviteCandidates}
            <p class="channel-modal-loading">Loading…</p>
          {:else if inviteToChannelCandidates.length === 0}
            <p class="channel-modal-empty">No one to invite. For squad channels, add members to the squad first.</p>
          {:else}
            <div class="channel-invite-list">
              {#each inviteToChannelCandidates as npub (npub)}
                <label class="channel-invite-row">
                  <input type="radio" name="inviteToChannel" bind:group={selectedInviteNpub} value={npub} />
                  <span>{getProfileDisplayName($profiles[npub]) || npub.slice(0, 16) + '…'}</span>
                </label>
              {/each}
            </div>
          {/if}
          {#if inviteToChannelError}
            <p class="channel-modal-error" role="alert">{inviteToChannelError}</p>
          {/if}
          <div class="channel-modal-actions">
            <button type="button" class="channel-modal-close" on:click={() => (showInviteToChannelModal = false)} disabled={invitingToChannel}>
              Cancel
            </button>
            <button
              type="button"
              class="channel-modal-primary"
              disabled={!selectedInviteNpub || invitingToChannel}
              on:click={handleInviteToChannel}
            >
              {invitingToChannel ? 'Inviting…' : 'Invite'}
            </button>
          </div>
        </div>
      </div>
    {/if}
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
    background: var(--bg-panel);
    height: 100%;
    min-width: 0;
    border-left: 1px solid var(--border-subtle);
  }

  .channel-header {
    height: 48px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    flex-shrink: 0;
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
  }

  .channel-header-actions {
    position: relative;
  }

  .channel-menu-btn {
    padding: 4px 8px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;
  }

  .channel-menu-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .channel-menu-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    min-width: 160px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 50;
    padding: 4px 0;
  }

  .channel-menu-item {
    display: block;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: none;
    color: var(--text-secondary);
    font-size: 0.875rem;
    text-align: left;
    cursor: pointer;
  }

  .channel-menu-item:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .channel-menu-item:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .channel-menu-item-danger {
    color: var(--danger);
  }

  .channel-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .channel-modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    min-width: 280px;
    max-width: 90vw;
    max-height: 80vh;
    overflow: auto;
  }

  .channel-modal h2 {
    margin: 0 0 16px;
    font-size: 1.125rem;
    color: var(--text-primary);
  }

  .channel-modal-loading,
  .channel-modal-empty {
    margin: 0 0 16px;
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .channel-members-list {
    list-style: none;
    margin: 0 0 16px;
    padding: 0;
  }

  .channel-member-item {
    padding: 6px 0;
    font-size: 0.9375rem;
    color: var(--text-secondary);
  }

  .channel-invite-list {
    margin: 0 0 16px;
    max-height: 200px;
    overflow-y: auto;
  }

  .channel-invite-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    cursor: pointer;
    font-size: 0.9375rem;
    color: var(--text-secondary);
  }

  .channel-modal-error {
    margin: 0 0 12px;
    font-size: 0.875rem;
    color: var(--danger);
  }

  .channel-modal-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .channel-modal-close {
    padding: 6px 14px;
    font-size: 0.875rem;
    background: var(--border);
    border: none;
    border-radius: 6px;
    color: #fff;
    cursor: pointer;
  }

  .channel-modal-close:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .channel-modal-primary {
    padding: 6px 14px;
    font-size: 0.875rem;
    background: var(--accent);
    border: none;
    border-radius: 6px;
    color: #fff;
    cursor: pointer;
  }

  .channel-modal-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .channel-modal-close:disabled,
  .channel-modal-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .channel-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .channel-icon {
    color: var(--text-muted);
    font-size: 1.25rem;
    font-weight: 600;
  }

  .channel-name {
    color: var(--text-primary);
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
    color: var(--text-secondary);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
  }

  .load-older-btn:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--border);
  }

  .load-older-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .channel-creating-message {
    padding: 24px 16px;
    color: var(--text-muted);
    font-size: 0.9375rem;
  }

  .channel-send-error {
    font-size: 0.875rem;
    color: var(--danger);
    margin: 0 16px 8px;
  }

  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
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
    background: var(--bg-elevated);
    border-radius: 4px;
  }

  .messages-container::-webkit-scrollbar-thumb:hover {
    background: var(--border-subtle);
  }
</style>

