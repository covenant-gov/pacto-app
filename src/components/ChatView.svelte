<script lang="ts">
  import { get } from 'svelte/store';
  import Message from './Message.svelte';
  import MessageInput from './MessageInput.svelte';
  import Modal from './Modal.svelte';
  import {
    activeChannelId,
    squads,
    activeSquadId,
    activeTopNavTab,
    activeNetworkId,
    networks,
    ungroupedChannels,
    dmList,
    requestsList,
    pendingList,
    backendGroupMessages,
    messageCountByChat,
    loadedOffsetByChat,
    groupSendError,
    showMembersPanel,
    squadsCreatingAnnouncements,
    squadCreateErrorBySquadId,
    networksCreatingAnnouncements,
    networkCreateErrorByNetworkId,
    type DmMessage,
  } from '../stores/app';
  import { sendDmMessage, getDmMessages, leaveMlsGroup, getMlsGroupMembers, inviteMemberToGroup } from '../lib/api/nostr';
  import { getInvokeErrorMessage, friendlyMessage } from '../lib/utils/tauri-errors';
  import { getProfileAvatarSrc, getProfileDisplayName } from '../lib/utils/profile';
  import { profiles } from '../stores/profiles';
  import { currentUser } from '../stores/auth';
  import chevronDownIcon from '../icons/chevron-down.svg';
  import friendsIcon from '../icons/friends.svg';

  const LOAD_OLDER_PAGE_SIZE = 50;

  $: activeSquad = $activeTopNavTab === 'squads' ? $squads.find((c) => c.id === $activeSquadId) : null;
  $: activeNetwork = $activeTopNavTab === 'networks' && $activeNetworkId ? $networks.find((n) => n.id === $activeNetworkId) : null;
  $: activeChannel = (() => {
    if ($activeTopNavTab === 'networks' && activeNetwork && $activeChannelId) {
      const sorted = [...activeNetwork.channels].sort((a, b) => a.order - b.order);
      return sorted.find((ch) => ch.groupId === $activeChannelId) ?? null;
    }
    if ($activeTopNavTab === 'squads') {
      return (
        activeSquad?.channels.find((ch) => ch.groupId === $activeChannelId) ??
        $ungroupedChannels.find((ch) => ch.groupId === $activeChannelId)
      ) ?? null;
    }
    return null;
  })();
  $: channelName = activeChannel?.name || 'channel';
  $: isAnnouncementsChannel = activeSquad
    ? activeSquad.channels[0]?.groupId === $activeChannelId
    : (activeNetwork ? [...activeNetwork.channels].sort((a, b) => a.order - b.order)[0]?.groupId === $activeChannelId : false);
  $: isChannelCreating = (activeChannel?.groupId?.startsWith('creating-') ?? false);
  $: squadSettingUp = $activeTopNavTab === 'squads' && activeSquad && activeSquad.channels.length === 0 && $squadsCreatingAnnouncements.has(activeSquad.id);
  $: squadSettingUpError = (squadSettingUp && activeSquad && $squadCreateErrorBySquadId[activeSquad.id]) ?? '';
  $: networkSettingUp = $activeTopNavTab === 'networks' && activeNetwork && activeNetwork.channels.length === 0 && $networksCreatingAnnouncements.has(activeNetwork.id);
  $: networkSettingUpError = (networkSettingUp && activeNetwork && $networkCreateErrorByNetworkId[activeNetwork.id]) ?? '';

  let channelMenuOpen = false;
  let showLeaveChannelConfirm = false;
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
    const base = {
      id: msg.id,
      authorName: '',
      content: msg.content,
      timestamp: new Date(msg.at).toISOString(),
      avatar: '',
      replyToId: msg.replied_to && msg.replied_to.length > 0 ? msg.replied_to : undefined,
      replyAuthorName: undefined as string | undefined,
      replyPreview: undefined as string | undefined,
    };
    if (msg.mine) {
      base.authorName = 'You';
      base.avatar = getProfileAvatarSrc(currentUserProfile) ?? '';
    } else {
      const senderProfile = msg.npub ? $profiles[msg.npub] : null;
      base.authorName = getProfileDisplayName(senderProfile);
      base.avatar = getProfileAvatarSrc(senderProfile) ?? '';
    }
    if (base.replyToId) {
      const replyNpub = msg.replied_to_npub ?? undefined;
      base.replyAuthorName =
        replyNpub && currentUserNpub && replyNpub === currentUserNpub
          ? 'You'
          : replyNpub
            ? getProfileDisplayName($profiles[replyNpub] ?? null)
            : 'Unknown';
      base.replyPreview =
        msg.replied_to_has_attachment === true
          ? 'Attachment'
          : msg.replied_to_content != null && msg.replied_to_content.length > 0
            ? msg.replied_to_content.slice(0, 80).trim() + (msg.replied_to_content.length > 80 ? '…' : '')
            : 'Message';
    }
    return base;
  }

  let prevChannelId: string | null = null;
  $: if (prevChannelId !== $activeChannelId) {
    prevChannelId = $activeChannelId;
    groupSendError.set(null);
  }

  // When members panel is open and user navigates to another squad/network/channel, refresh the list
  let prevChannelIdForMembers: string | null = null;
  $: if ($showMembersPanel && $activeChannelId && prevChannelIdForMembers !== $activeChannelId) {
    prevChannelIdForMembers = $activeChannelId;
    loadChannelMembers();
  }
  $: if (!$showMembersPanel) prevChannelIdForMembers = null;

  let loadingOlder = false;
  function scrollMessagesToBottom() {
    const el = messagesContainer;
    if (el && document.contains(el)) el.scrollTop = el.scrollHeight;
  }

  async function handleSendMessage(content: string) {
    const groupId = $activeChannelId;
    if (!groupId) return;
    groupSendError.set(null);
    try {
      await sendDmMessage(groupId, content, '');
      setTimeout(scrollMessagesToBottom, 0);
      setTimeout(scrollMessagesToBottom, 200);
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

  function openLeaveChannelConfirm() {
    closeChannelMenu();
    showLeaveChannelConfirm = true;
  }

  async function handleLeaveChannel() {
    const groupId = $activeChannelId;
    if (!groupId || leavingChannel) return;
    leavingChannel = true;
    leaveChannelError = '';
    showLeaveChannelConfirm = false;
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
      const netList = get(networks);
      const networkContaining = netList.find((n) => n.channels.some((ch) => ch.groupId === groupId));
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
      } else if (networkContaining) {
        networks.update((list) =>
          list.map((n) =>
            n.id !== networkContaining.id
              ? n
              : { ...n, channels: n.channels.filter((ch) => ch.groupId !== groupId) }
          )
        );
        const still = get(networks).find((n) => n.id === networkContaining.id);
        const remaining = still?.channels.slice().sort((a, b) => a.order - b.order) ?? [];
        activeChannelId.set(remaining[0]?.groupId ?? null);
        if (remaining.length === 0) activeNetworkId.set(null);
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

  function openMembersPanel() {
    showMembersPanel.set(true);
    prevChannelIdForMembers = $activeChannelId;
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
  let scrollPrevChannelId: string | null = null;
  let lastScrolledToBottomChannelId: string | null = null;
  $: if (currentMessages.length && messagesContainer) {
    const el = messagesContainer;
    const channelId = $activeChannelId;
    const channelJustChanged = channelId !== scrollPrevChannelId;
    const firstTimeWithMessages = channelId !== lastScrolledToBottomChannelId;
    setTimeout(() => {
      if (!el || !document.contains(el)) return;
      const isNearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      if (channelJustChanged || firstTimeWithMessages) {
        el.scrollTop = el.scrollHeight;
        scrollPrevChannelId = channelId;
        lastScrolledToBottomChannelId = channelId;
      } else if (isNearBottom) {
        el.scrollTop = el.scrollHeight;
      }
    }, 0);
  }
  $: if ($activeChannelId !== scrollPrevChannelId && !currentMessages.length) scrollPrevChannelId = $activeChannelId;
</script>

<svelte:window
  on:click={(e) => {
    const t = e.target as HTMLElement | null;
    if (channelMenuOpen && t && !t.closest('.channel-header-actions')) closeChannelMenu();
  }}
/>
<div class="chat-view">
  {#if squadSettingUp}
    <div class="squad-setting-up-state" role="status" aria-live="polite">
      <div class="squad-setting-up-spinner"></div>
      <p class="squad-setting-up-text">Setting up this space…</p>
      {#if squadSettingUpError}
        <p class="squad-setting-up-error" role="alert">{squadSettingUpError}</p>
      {/if}
    </div>
  {:else if networkSettingUp}
    <div class="squad-setting-up-state" role="status" aria-live="polite">
      <div class="squad-setting-up-spinner"></div>
      <p class="squad-setting-up-text">Setting up this space…</p>
      {#if networkSettingUpError}
        <p class="squad-setting-up-error" role="alert">{networkSettingUpError}</p>
      {/if}
    </div>
  {:else if activeChannel}
    <div class="chat-view-main">
    <div class="channel-header">
      <div class="channel-info">
        <span class="channel-icon">#</span>
        <h3 class="channel-name">{channelName}</h3>
      </div>
      <div class="channel-header-actions">
        <div class="channel-header-actions-inner">
          <button
            type="button"
            class="channel-menu-btn"
            title="Channel options"
            on:click={() => (channelMenuOpen = !channelMenuOpen)}
            aria-expanded={channelMenuOpen}
            aria-haspopup="menu"
          >
            <img src={chevronDownIcon} alt="" class="channel-menu-btn-icon" />
          </button>
          <button
            type="button"
            class="channel-members-btn"
            title="Members"
            on:click={openMembersPanel}
            aria-label="View channel members"
          >
            <img src={friendsIcon} alt="" class="channel-members-btn-icon" />
          </button>
        </div>
        {#if channelMenuOpen}
          <div class="channel-menu-dropdown" role="menu">
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
              on:click={openLeaveChannelConfirm}
            >
              Leave channel
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

    <!-- Leave channel confirm -->
    {#if showLeaveChannelConfirm}
      <Modal titleId="leave-channel-title" onClose={() => (showLeaveChannelConfirm = false)}>
        <h2 id="leave-channel-title">Leave channel?</h2>
        <p class="channel-leave-explainer">Channels are private groups and you will need to be re-invited to re-enter this channel.</p>
        <div class="channel-modal-actions">
          <button type="button" class="channel-modal-close" on:click={() => (showLeaveChannelConfirm = false)}>Cancel</button>
          <button
            type="button"
            class="channel-modal-primary channel-modal-danger"
            disabled={leavingChannel}
            on:click={handleLeaveChannel}
          >
            {leavingChannel ? 'Leaving…' : 'Leave channel'}
          </button>
        </div>
      </Modal>
    {/if}

    <!-- Invite to channel modal -->
    {#if showInviteToChannelModal}
      <Modal titleId="invite-channel-modal-title" onClose={() => (showInviteToChannelModal = false)}>
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
      </Modal>
    {/if}
    </div>
    <!-- Right-hand members panel (Discord-style) -->
    {#if $showMembersPanel}
      <aside class="members-panel" aria-label="Channel members">
        <div class="members-panel-header">
          <h3 class="members-panel-title">Members</h3>
          <button type="button" class="members-panel-close" aria-label="Close" on:click={() => showMembersPanel.set(false)}>×</button>
        </div>
        <div class="members-panel-list">
          {#if loadingMembers}
            <p class="members-panel-loading">Loading…</p>
          {:else}
            {#each channelMembers as npub (npub)}
              {@const avatarSrc = getProfileAvatarSrc($profiles[npub])}
              <div class="members-panel-member">
                {#if avatarSrc}
                  <img src={avatarSrc} alt="" class="members-panel-avatar" />
                {:else}
                  <div class="members-panel-avatar members-panel-avatar-placeholder" aria-hidden="true"></div>
                {/if}
                <span class="members-panel-name">{getProfileDisplayName($profiles[npub]) || npub.slice(0, 16) + '…'}</span>
              </div>
            {/each}
          {/if}
        </div>
      </aside>
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
    flex-direction: row;
    background: var(--bg-panel);
    height: 100%;
    min-width: 0;
    border-left: 1px solid var(--border-subtle);
  }

  .chat-view-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
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

  .channel-header-actions-inner {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .channel-menu-btn {
    padding: 6px 8px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .channel-menu-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .channel-menu-btn-icon {
    width: 18px;
    height: 18px;
    display: block;
    filter: var(--icon-dropdown-filter);
  }

  .channel-members-btn {
    padding: 6px 8px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .channel-members-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .channel-members-btn-icon {
    width: 20px;
    height: 20px;
    display: block;
    filter: var(--icon-dropdown-filter);
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

  /* Modal content (leave / invite) - overlay and content box in Modal.svelte */
  .channel-modal-loading,
  .channel-modal-empty {
    margin: 0 0 16px;
    font-size: 0.875rem;
    color: var(--text-muted);
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

  .channel-leave-explainer {
    margin: 0 0 16px;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .channel-modal-danger {
    background: var(--danger);
  }

  .channel-modal-danger:hover:not(:disabled) {
    background: var(--danger);
    filter: brightness(1.1);
  }

  /* Right-hand members panel (Discord-style) */
  .members-panel {
    width: 240px;
    min-width: 240px;
    background: var(--bg-elevated);
    border-left: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .members-panel-header {
    height: 48px;
    padding: 0 12px 0 16px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .members-panel-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .members-panel-close {
    padding: 4px 8px;
    font-size: 1.25rem;
    line-height: 1;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 4px;
  }

  .members-panel-close:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .members-panel-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .members-panel-loading {
    margin: 0 16px;
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .members-panel-member {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 16px;
    font-size: 0.9375rem;
    color: var(--text-secondary);
  }

  .members-panel-member:hover {
    background: var(--bg-hover);
  }

  .members-panel-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .members-panel-avatar-placeholder {
    background: var(--border);
  }

  .members-panel-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .squad-setting-up-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .squad-setting-up-spinner {
    width: 36px;
    height: 36px;
    border: 3px solid var(--border-subtle);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: chat-view-spin 0.9s linear infinite;
  }

  @keyframes chat-view-spin {
    to { transform: rotate(360deg); }
  }

  .squad-setting-up-text {
    margin: 0;
  }

  .squad-setting-up-error {
    margin: 0;
    color: var(--danger);
    font-size: 0.8125rem;
    text-align: center;
    max-width: 280px;
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

