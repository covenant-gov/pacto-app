<script lang="ts">
  import { get } from 'svelte/store';
  import Message from '../dm/Message.svelte';
  import AnnounceCard from '../announcements/AnnounceCard.svelte';
  import MessageInput from '../dm/MessageInput.svelte';
  import Modal from '../ui/Modal.svelte';
  import { parseAnnouncement } from '../../lib/announcements';
  import { resolvePollsMlsGroupId } from '../../lib/parent-navbar';
  import {
    groupTimelineKey,
    defaultTrioSharesSingleMlsGroup,
    announceCardAllowedForTimelineBucket,
    type VirtualBucket,
  } from '../../lib/mls/virtual-channel-bucket';
  import DashboardPollsPanel from '../parent/DashboardPollsPanel.svelte';
  import SquadRosterKeyInboxCard from '../inbox/SquadRosterKeyInboxCard.svelte';
  import { needsSquadRosterKeyChoice } from '../../lib/squad/squad-roster-key-choice';
  import {
    activeChannelId,
    activeHubChannelName,
    squads,
    activeSquadId,
    activeTopNavTab,
    ungroupedChannels,
    dmList,
    requestsList,
    pendingList,
    backendGroupMessages,
    backendGroupTimelineMessages,
    messageCountByChat,
    loadedOffsetByChat,
    groupSendError,
    showMembersPanel,
    parentsCreatingAnnouncements,
    parentCreateErrorById,
    ANNOUNCEMENTS_CHANNEL_NAME,
    INBOX_CHANNEL_NAME,
    POLLS_CHANNEL_NAME,
    DASHBOARD_CHANNEL_ID,
    membershipVersionByGroupId,
    type DmMessage,
    type Squad,
  } from '../../stores/app';
  import { sendDmMessage, getDmMessages, leaveMlsGroup, getMlsGroupMembers, inviteMemberToGroup } from '../../lib/api/nostr';
  import { getInvokeErrorMessage, friendlyMessage } from '../../lib/utils/tauri-errors';
  import { getProfileAvatarSrc, getProfileDisplayName } from '../../lib/utils/profile';
  import { profiles } from '../../stores/profiles';
  import { currentUser } from '../../stores/auth';
  import chevronDownIcon from '../../icons/chevron-down.svg';
  import friendsIcon from '../../icons/friends.svg';

  const LOAD_OLDER_PAGE_SIZE = 50;

  // Active squad (or squad-pair) parent and channel from tab + ids.
  $: activeParent =
    $activeTopNavTab === 'squads' ? ($squads.find((c) => c.id === $activeSquadId) ?? null) : null;
  $: activeChannel = (() => {
    if (!activeParent || !$activeChannelId) return null;
    const sorted = [...activeParent.channels].sort((a, b) => a.order - b.order);
    const matches = sorted.filter((c) => c.groupId === $activeChannelId);
    if (matches.length === 0) {
      if ($activeTopNavTab === 'squads') return $ungroupedChannels.find((c) => c.groupId === $activeChannelId) ?? null;
      return null;
    }
    if (matches.length === 1) return matches[0];
    const pref = $activeHubChannelName?.trim();
    if (pref) {
      const hit = matches.find((c) => c.name === pref);
      if (hit) return hit;
    }
    return [...matches].sort((a, b) => a.order - b.order)[0];
  })();
  $: activeSquad = activeParent as Squad | null;

  /** MLS group used for the members sidebar: announcements membership for the dashboard pseudo-channel. */
  $: announcementsGroupIdForMembers =
    activeParent?.channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.groupId ??
    activeParent?.channels[0]?.groupId ??
    null;
  $: effectiveMembersGroupId = (() => {
    if (!$activeChannelId) return null;
    if ($activeChannelId === DASHBOARD_CHANNEL_ID) return announcementsGroupIdForMembers;
    return $activeChannelId;
  })();

  $: channelName = activeChannel?.name || 'channel';
  $: isAnnouncementsChannel =
    (activeParent && activeChannel?.name === ANNOUNCEMENTS_CHANNEL_NAME) ?? false;
  $: isInboxChannel = (activeParent && activeChannel?.name === INBOX_CHANNEL_NAME) ?? false;
  $: isPollsChannel = (activeParent && activeChannel?.name === POLLS_CHANNEL_NAME) ?? false;
  $: hideChannelOverflowMenu = isAnnouncementsChannel || isInboxChannel;
  $: channelParsesStructuredAnnounces = isAnnouncementsChannel || isInboxChannel;
  $: isChannelCreating = (activeChannel?.groupId?.startsWith('creating-') ?? false);
  $: parentSettingUp = activeParent && activeParent.channels.length === 0 && $parentsCreatingAnnouncements.has(activeParent.id);
  $: parentSettingUpError = (parentSettingUp && activeParent && $parentCreateErrorById[activeParent.id]) ?? '';

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

  let showRosterKeyCard = false;

  async function refreshRosterKeyCard(): Promise<void> {
    if (!isInboxChannel || !activeParent) {
      showRosterKeyCard = false;
      return;
    }
    showRosterKeyCard = await needsSquadRosterKeyChoice(activeParent.id, announcementsGroupIdForMembers);
  }

  $: if (isInboxChannel && activeParent && announcementsGroupIdForMembers) {
    void refreshRosterKeyCard();
  }

  function onRosterKeyChoiceComplete(): void {
    void refreshRosterKeyCard();
  }

  $: currentMessages = (() => {
    if (!$activeChannelId) return [];
    const list = [...($backendGroupMessages[$activeChannelId] ?? [])];
    list.sort((a, b) => a.at - b.at);
    return list;
  })();

  function channelNameToVirtualBucket(name: string): VirtualBucket | null {
    if (name === ANNOUNCEMENTS_CHANNEL_NAME) return 'announcements';
    if (name === INBOX_CHANNEL_NAME) return 'inbox';
    if (name === POLLS_CHANNEL_NAME) return 'polls';
    return null;
  }

  $: virtualBucketSingleGroup =
    !!activeParent &&
    !!$activeChannelId &&
    $activeChannelId !== DASHBOARD_CHANNEL_ID &&
    defaultTrioSharesSingleMlsGroup(activeParent.channels);

  $: selectedVirtualBucket = activeChannel ? channelNameToVirtualBucket(activeChannel.name) : null;

  $: virtualTimelineMessages =
    virtualBucketSingleGroup && selectedVirtualBucket && $activeChannelId
      ? [...($backendGroupTimelineMessages[groupTimelineKey($activeChannelId, selectedVirtualBucket)] ?? [])]
      : currentMessages;

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

  let prevTimelineKeyForSendError: string | null = null;
  $: messagesTimelineKey = `${$activeChannelId ?? ''}:${activeChannel?.name ?? ''}`;
  $: if (prevTimelineKeyForSendError !== messagesTimelineKey) {
    prevTimelineKeyForSendError = messagesTimelineKey;
    groupSendError.set(null);
  }

  // When members panel is open and the MLS group for the sidebar changes, refresh the list
  let prevMembersGroupIdForPanel: string | null = null;
  $: if ($showMembersPanel && effectiveMembersGroupId && prevMembersGroupIdForPanel !== effectiveMembersGroupId) {
    prevMembersGroupIdForPanel = effectiveMembersGroupId;
    loadChannelMembers();
  }
  $: if (!$showMembersPanel) prevMembersGroupIdForPanel = null;

  // When root bumps membership version for the active group (mls_group_updated / mls_group_left),
  // refetch members if the panel is open.
  $: if ($showMembersPanel && effectiveMembersGroupId) {
    const gid = effectiveMembersGroupId;
    const version = $membershipVersionByGroupId[gid] ?? 0;
    if (version > 0) {
      loadChannelMembers();
    }
  }

  let loadingOlder = false;
  function scrollMessagesToBottom() {
    const el = messagesContainer;
    if (el && document.contains(el)) el.scrollTop = el.scrollHeight;
  }

  async function handleSendMessage(content: string) {
    const groupId = $activeChannelId;
    if (!groupId || isInboxChannel) return;
    groupSendError.set(null);
    try {
      await sendDmMessage(groupId, content, '', { virtualBucket: 'announcements' });
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
          const sorted = still?.channels.slice().sort((a, b) => a.order - b.order) ?? [];
          activeChannelId.set(sorted[0]?.groupId ?? null);
          activeHubChannelName.set(sorted[0]?.name ?? null);
          if (still?.channels.length === 0) activeSquadId.set(null);
        } else {
          activeChannelId.set(null);
          activeHubChannelName.set(null);
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
        const sorted = still?.channels.slice().sort((a, b) => a.order - b.order) ?? [];
        activeChannelId.set(sorted[0]?.groupId ?? null);
        activeHubChannelName.set(sorted[0]?.name ?? null);
        if (still?.channels.length === 0) activeSquadId.set(null);
      } else {
        ungroupedChannels.update((ch) => ch.filter((c) => c.groupId !== groupId));
        activeChannelId.set(null);
        activeHubChannelName.set(null);
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
    prevMembersGroupIdForPanel = effectiveMembersGroupId;
    channelMembers = [];
    closeChannelMenu();
    loadChannelMembers();
  }
  function toggleMembersPanel() {
    if ($showMembersPanel) {
      showMembersPanel.set(false);
    } else {
      openMembersPanel();
    }
  }
  async function loadChannelMembers() {
    const groupId = effectiveMembersGroupId;
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
      if (activeSquad && !hideChannelOverflowMenu) {
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
  let scrollPrevTimelineKey: string | null = null;
  let lastScrolledToBottomTimelineKey: string | null = null;
  $: if (virtualTimelineMessages.length && messagesContainer) {
    const el = messagesContainer;
    const channelJustChanged = messagesTimelineKey !== scrollPrevTimelineKey;
    const firstTimeWithMessages = messagesTimelineKey !== lastScrolledToBottomTimelineKey;
    setTimeout(() => {
      if (!el || !document.contains(el)) return;
      const isNearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      if (channelJustChanged || firstTimeWithMessages) {
        el.scrollTop = el.scrollHeight;
        scrollPrevTimelineKey = messagesTimelineKey;
        lastScrolledToBottomTimelineKey = messagesTimelineKey;
      } else if (isNearBottom) {
        el.scrollTop = el.scrollHeight;
      }
    }, 0);
  }
  $: if (messagesTimelineKey !== scrollPrevTimelineKey && !virtualTimelineMessages.length) scrollPrevTimelineKey = messagesTimelineKey;
</script>

<svelte:window
  on:click={(e) => {
    const t = e.target as HTMLElement | null;
    if (channelMenuOpen && t && !t.closest('.channel-header-actions')) closeChannelMenu();
  }}
/>
<div class="chat-view">
  {#if parentSettingUp}
    <div class="squad-setting-up-state" role="status" aria-live="polite">
      <div class="squad-setting-up-spinner"></div>
      <p class="squad-setting-up-text">Setting up this space…</p>
      {#if parentSettingUpError}
        <p class="squad-setting-up-error" role="alert">{parentSettingUpError}</p>
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
          {#if !hideChannelOverflowMenu}
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
          {/if}
          <button
            type="button"
            class="channel-members-btn"
            title="Members"
            on:click={toggleMembersPanel}
            aria-label={$showMembersPanel ? 'Close channel members' : 'View channel members'}
            aria-expanded={$showMembersPanel}
          >
            <img src={friendsIcon} alt="" class="channel-members-btn-icon" />
          </button>
        </div>
        {#if channelMenuOpen}
          <div class="channel-menu-dropdown" role="menu">
            {#if !hideChannelOverflowMenu}
              <button type="button" class="channel-menu-item" role="menuitem" on:click={openInviteToChannelModal}>
                Invite to channel
              </button>
              <button
                type="button"
                class="channel-menu-item channel-menu-item-danger"
                role="menuitem"
                disabled={leavingChannel}
                on:click={openLeaveChannelConfirm}
              >
                Leave channel
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
    {#if leaveChannelError}
      <p class="channel-send-error" role="alert">{leaveChannelError}</p>
    {/if}

    {#if isPollsChannel && activeParent}
      <DashboardPollsPanel
        parentId={activeParent.id}
        pollsMlsGroupId={resolvePollsMlsGroupId(activeParent)}
        variant="channel"
      />
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
          {#if isInboxChannel && showRosterKeyCard && activeParent && announcementsGroupIdForMembers}
            <SquadRosterKeyInboxCard
              parentId={activeParent.id}
              announcementsGroupId={announcementsGroupIdForMembers}
              onComplete={onRosterKeyChoiceComplete}
            />
          {/if}
          {#each virtualTimelineMessages as message (message.id)}
            {@const props = toMessageProps(message)}
            {@const parsed = channelParsesStructuredAnnounces ? parseAnnouncement(message.content) : null}
            {@const announceForCard =
              parsed && announceCardAllowedForTimelineBucket(parsed, message) ? parsed : null}
            {#if announceForCard}
              <AnnounceCard
                id={message.id}
                announce={announceForCard}
                authorName={props.authorName}
                authorNpub={message.npub}
                timestamp={props.timestamp}
              />
            {:else}
              <Message {...props} />
            {/if}
          {/each}
        {/if}
      </div>
    </div>
    {#if $groupSendError}
      <p class="channel-send-error" role="alert">{$groupSendError}</p>
    {/if}
    <MessageInput channelName={channelName} onSend={handleSendMessage} disabled={isChannelCreating || isInboxChannel} />

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

