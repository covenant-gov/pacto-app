<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { listen } from '@tauri-apps/api/event';
  import Navbar from '../components/Navbar.svelte';
  import TopNavbar from '../components/TopNavbar.svelte';
  import SquadNavbar from '../components/SquadNavbar.svelte';
  import ChatView from '../components/ChatView.svelte';
  import Profile from '../components/Profile.svelte';
  import MessengerNavbar from '../components/MessengerNavbar.svelte';
  import MessengerChatView from '../components/MessengerChatView.svelte';
  import Message from '../components/Message.svelte';
  import MessageInput from '../components/MessageInput.svelte';
  import { getDmMessages, getChatMessageCount, sendDmMessage, queueProfileSync, fetchMessages, markAsRead, startTyping, setNickname, listPendingMlsWelcomes, acceptMlsWelcome, parseSquadInviteMessage, syncMlsGroupsNow } from '../lib/api/nostr';
  import { getInvokeErrorMessage, friendlyMessage } from '../lib/utils/tauri-errors';
  import { getProfileAvatarSrc, getProfileDisplayName } from '../lib/utils/profile';
  import { dmLog, dmError } from '../lib/utils/dm-debug';
  import { isAuthenticated, currentUser } from '../stores/auth';
  import { profiles } from '../stores/profiles';
  import {
    squads,
    activeSquadId,
    activeChannelId,
    activeView,
    activeTopNavTab,
    activeDmTab,
    activeDmId,
    composingNewChat,
    backendDmMessages,
    backendGroupMessages,
    pendingMlsWelcomes,
    ungroupedChannels,
    messageCountByChat,
    loadedOffsetByChat,
    dmSyncStatus,
    typingByChat,
    dmList,
    requestsList,
    pendingList,
    lastOpenedDmByTab,
    dmChatsByNpub,
    dmSendError,
    type DmMessage,
    type DmTab,
    type Channel,
  } from '../stores/app';

  const PAGE_SIZE = 100;
  const LOAD_OLDER_PAGE_SIZE = 50;

  /** Group IDs we just accepted as squad invites — skip "Add to squad" modal for these. */
  let acceptedSquadInviteGroupIds = new Set<string>();

  let pendingAddToSquadGroupId: string | null = null;
  function addAcceptedChannelToSquad(squadId: string) {
    const groupId = pendingAddToSquadGroupId;
    if (!groupId) return;
    const squad = $squads.find((s) => s.id === squadId);
    if (!squad) return;
    const name = groupId.slice(0, 12) + '…';
    const newChannel: Channel = { id: groupId, name, groupId, order: squad.channels.length };
    squads.update((list) =>
      list.map((s) => (s.id !== squadId ? s : { ...s, channels: [...s.channels, newChannel] }))
    );
    pendingAddToSquadGroupId = null;
  }

  let dmMessagesContainer: HTMLDivElement;
  let prevDmId: string | null = null;
  let prevDmTab: DmTab | undefined = undefined;
  let loadingOlder = false;

  // When switching Friends / Requests / Pending, show the last opened chat in that section (or first if none / no longer in list)
  $: {
    const tab = $activeDmTab;
    if (prevDmTab !== tab && $activeTopNavTab === 'dms') {
      prevDmTab = tab;
      const list = tab === 'friends' ? $dmList : tab === 'requests' ? $requestsList : $pendingList;
      const lastOpened = $lastOpenedDmByTab[tab];
      const stillInList = lastOpened && list.some((e) => e.npub === lastOpened);
      const npub = stillInList ? lastOpened : list[0]?.npub ?? null;
      activeDmId.set(npub);
    }
  }

  // Remember which chat was last opened per tab (so tab switch restores it)
  $: if ($activeTopNavTab === 'dms' && $activeDmId) {
    lastOpenedDmByTab.update((byTab) => ({
      ...byTab,
      [$activeDmTab]: $activeDmId,
    }));
  }

  // Nickname edit for current DM contact
  let showNicknameEdit = false;
  let nicknameEditValue = '';
  let nicknameSaving = false;
  let nicknameError: string | null = null;

  // Clear send error and nickname edit when user switches to a different DM
  $: if (prevDmId !== $activeDmId) {
    prevDmId = $activeDmId;
    if (prevDmId != null) $dmSendError = null;
    showNicknameEdit = false;
    nicknameError = null;
  }

  function truncateNpub(n: string): string {
    if (n.length <= 16) return n;
    return n.slice(0, 8) + '…' + n.slice(-4);
  }

  // Contact for current DM (conversation header)
  $: contactProfile = $activeDmId ? $profiles[$activeDmId] : null;
  $: contactAvatarSrc = getProfileAvatarSrc(contactProfile);
  $: contactDisplayName = contactProfile ? getProfileDisplayName(contactProfile) : ($activeDmId ? truncateNpub($activeDmId) : 'Unknown');

  // Backend messages for active DM, sorted by at (oldest first). Backend emits message_new on send.
  $: mergedDmMessages = (() => {
    const npub = $activeDmId;
    if (!npub) return [];
    const list = [...($backendDmMessages[npub] ?? [])];
    list.sort((a, b) => a.at - b.at);
    return list;
  })();

  // Load backend messages when active DM changes; queue profile sync, get total count.
  $: if ($activeDmId && $activeTopNavTab === 'dms') {
    const npub = $activeDmId;
    dmLog('open conversation', { npub: npub.slice(0, 20) + '…', tab: 'dms' });
    queueProfileSync(npub).catch(() => {});
    getChatMessageCount(npub)
      .then((count) => {
        messageCountByChat.update((byChat) => ({ ...byChat, [npub]: count }));
      })
      .catch((err) => {
        dmError('open conversation: getChatMessageCount failed', err);
      });
    getDmMessages(npub, PAGE_SIZE, 0)
      .then((msgs) => {
        dmLog('open conversation: messages loaded', { npub: npub.slice(0, 20) + '…', count: msgs.length });
        const loaded = msgs as DmMessage[];
        backendDmMessages.update((byNpub) => {
          const existing = byNpub[npub] ?? [];
          const loadedIds = new Set(loaded.map((m) => m.id));
          // Keep messages from state that aren't in the loaded set (e.g. just-sent squad invite from message_new)
          const fromExisting = existing.filter((m) => !loadedIds.has(m.id));
          const merged = [...loaded, ...fromExisting];
          return { ...byNpub, [npub]: merged };
        });
        loadedOffsetByChat.update((by) => ({ ...by, [npub]: PAGE_SIZE }));
        // Mark as read up to the latest message (backend returns newest first)
        const lastMessageId = msgs.length > 0 ? (msgs[0] as DmMessage).id : null;
        markAsRead(npub, lastMessageId).catch(() => {});
      })
      .catch((err) => {
        dmError('open conversation: getDmMessages failed', err);
      });
  }

  // Load group messages when opening a channel (Squads tab)
  $: if ($activeChannelId && $activeTopNavTab === 'squads') {
    const groupId = $activeChannelId;
    dmLog('open channel', { groupId: groupId.slice(0, 20) + '…' });
    getChatMessageCount(groupId)
      .then((count) => {
        messageCountByChat.update((by) => ({ ...by, [groupId]: count }));
      })
      .catch((err) => dmError('open channel: getChatMessageCount failed', err));
    getDmMessages(groupId, PAGE_SIZE, 0)
      .then((msgs) => {
        dmLog('open channel: messages loaded', { groupId: groupId.slice(0, 20) + '…', count: msgs.length });
        backendGroupMessages.update((byGroup) => ({
          ...byGroup,
          [groupId]: msgs as DmMessage[],
        }));
        loadedOffsetByChat.update((by) => ({ ...by, [groupId]: PAGE_SIZE }));
      })
      .catch((err) => dmError('open channel: getDmMessages failed', err));
  }

  async function loadOlder() {
    const npub = $activeDmId;
    if (!npub || loadingOlder) return;
    const currentOffset = $loadedOffsetByChat[npub] ?? PAGE_SIZE;
    loadingOlder = true;
    dmLog('loadOlder', { npub: npub.slice(0, 20) + '…', offset: currentOffset });
    try {
      const older = await getDmMessages(npub, LOAD_OLDER_PAGE_SIZE, currentOffset);
      backendDmMessages.update((byNpub) => {
        const list = byNpub[npub] ?? [];
        const ids = new Set(list.map((m) => m.id));
        const newMsgs = (older as DmMessage[]).filter((m) => !ids.has(m.id));
        if (newMsgs.length === 0) return byNpub;
        dmLog('loadOlder: prepending', { count: newMsgs.length });
        return { ...byNpub, [npub]: [...newMsgs, ...list] };
      });
      loadedOffsetByChat.update((by) => ({ ...by, [npub]: currentOffset + LOAD_OLDER_PAGE_SIZE }));
    } catch (err) {
      dmError('loadOlder failed', err);
    } finally {
      loadingOlder = false;
    }
  }

  $: canLoadOlder =
    $activeDmId &&
    !loadingOlder &&
    (($messageCountByChat[$activeDmId] ?? 0) > ($backendDmMessages[$activeDmId]?.length ?? 0));

  // Squad invite cards in DM: track accepted/declined so we show status and hide buttons
  let acceptedSquadInviteIds: Set<string> = new Set();
  let declinedSquadInviteIds: Set<string> = new Set();
  let acceptingSquadInviteId: string | null = null;

  // Message bubbles show sender avatar and display name from profiles
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

  async function handleAcceptSquadInvite(msg: DmMessage, groupId: string) {
    const payload = parseSquadInviteMessage(msg.content);
    if (!payload) return;
    if (acceptingSquadInviteId) return;
    acceptingSquadInviteId = msg.id;
    try {
      const welcomes = await listPendingMlsWelcomes();
      const welcome = welcomes.find((w) => w.nostr_group_id === groupId);
      if (!welcome) {
        dmError('Accept squad invite: no pending welcome for group', groupId);
        return;
      }
      await acceptMlsWelcome(welcome.id);
      acceptedSquadInviteIds = new Set(acceptedSquadInviteIds).add(msg.id);
      acceptedSquadInviteGroupIds.add(groupId);
      const now = Date.now();
      const announcementsChannel: Channel = {
        id: groupId,
        name: 'announcements',
        groupId,
        order: 0,
      };
      const newSquad = {
        id: crypto.randomUUID(),
        name: payload.squadName,
        channels: [announcementsChannel],
        createdAt: now,
        updatedAt: now,
      };
      squads.update((list) => [...list, newSquad]);
      activeSquadId.set(newSquad.id);
      activeChannelId.set(groupId);
      activeView.set('hub');
    } catch (e) {
      dmError('Accept squad invite failed', e);
    } finally {
      acceptingSquadInviteId = null;
    }
  }

  let dmTypingTimeout: ReturnType<typeof setTimeout> | null = null;
  function handleDmTyping() {
    const npub = $activeDmId;
    if (!npub) return;
    if (dmTypingTimeout) clearTimeout(dmTypingTimeout);
    dmTypingTimeout = setTimeout(() => {
      dmTypingTimeout = null;
      startTyping(npub).catch(() => {});
    }, 400);
  }

  async function handleDmSend(content: string) {
    const id = $activeDmId;
    if (!id) return;
    dmLog('handleDmSend', { receiver: id.slice(0, 20) + '…', contentLen: content.length });
    $dmSendError = null;
    try {
      const ok = await sendDmMessage(id, content);
      dmLog('handleDmSend result', { ok });
      if (!ok) {
        $dmSendError = friendlyMessage(
          'Could not deliver to relays. Message may appear as pending or failed.',
          'dm_send'
        );
      }
    } catch (e: unknown) {
      const raw = getInvokeErrorMessage(e, 'Failed to send message');
      $dmSendError = friendlyMessage(raw, 'dm_send');
      dmError('handleDmSend error', e);
    }
  }

  function openNicknameEdit() {
    nicknameEditValue = contactProfile?.nickname ?? '';
    nicknameError = null;
    showNicknameEdit = true;
  }

  function cancelNicknameEdit() {
    showNicknameEdit = false;
    nicknameError = null;
  }

  async function saveNickname() {
    const npub = $activeDmId;
    if (!npub || nicknameSaving) return;
    nicknameError = null;
    nicknameSaving = true;
    try {
      await setNickname(npub, nicknameEditValue.trim());
      showNicknameEdit = false;
      // profile_nick_changed will update store and UI
    } catch (e: unknown) {
      nicknameError = getInvokeErrorMessage(e, 'Failed to set nickname');
      dmError('saveNickname error', e);
    } finally {
      nicknameSaving = false;
    }
  }

  /** Ungrouped channels UI removed; keep store empty. */
  function clearUngroupedChannels() {
    ungroupedChannels.set([]);
  }

  let prevTopNavTab: string | undefined = undefined;
  $: if ($activeTopNavTab === 'squads' && prevTopNavTab !== 'squads') {
    prevTopNavTab = 'squads';
    syncMlsGroupsNow(null).catch(() => {});
    clearUngroupedChannels();
  } else if ($activeTopNavTab !== 'squads') {
    prevTopNavTab = $activeTopNavTab;
  }

  onMount(() => {
    // Gate selection: only set squad/channel when we have squads
    if ($squads.length > 0 && !$activeSquadId) {
      const first = $squads[0];
      $activeSquadId = first.id;
      $activeChannelId = first.channels.length > 0 ? first.channels[0].groupId : null;
    }

    // Pull DMs from Nostr relays when app loads (if already authenticated)
    if ($isAuthenticated) {
      dmLog('onMount: authenticated, calling fetchMessages(true)');
      dmSyncStatus.set('syncing');
      fetchMessages(true).catch((e) => dmError('onMount: fetchMessages(true) failed', e));
      clearUngroupedChannels();
    }

    const unlistenNew = listen<{ message: DmMessage; chat_id: string }>('message_new', (event) => {
      const { message, chat_id } = event.payload;
      dmLog('message_new', { chat_id: chat_id.slice(0, 20) + '…', messageId: message.id?.slice(0, 12), mine: message.mine });
      if (!chat_id.startsWith('npub1')) return;
      const m: DmMessage = {
        id: message.id,
        content: message.content,
        at: message.at,
        mine: message.mine,
        npub: message.npub,
        pending: message.pending,
        failed: message.failed,
      };
      backendDmMessages.update((byNpub) => {
        const list = byNpub[chat_id] ?? [];
        if (list.some((x) => x.id === m.id)) return byNpub;
        // Replace optimistic message (opt-*) with same content when backend confirms (avoids duplicate)
        const withoutOpt = list.filter(
          (x) => !(x.id.startsWith('opt-') && x.mine && x.content === m.content)
        );
        return { ...byNpub, [chat_id]: [...withoutOpt, m] };
      });
      // Update Friends/Requests/Pending: OR in message flags so we never lose a true (chat can move to Friends when they reply)
      dmChatsByNpub.update((map) => {
        const cur = map[chat_id];
        const next = {
          npub: chat_id,
          name: cur?.name,
          avatar: cur?.avatar,
          hasFromMe: (cur?.hasFromMe ?? false) || m.mine,
          hasFromThem: (cur?.hasFromThem ?? false) || !m.mine,
          lastAt: Math.max(cur?.lastAt ?? 0, m.at),
        };
        return { ...map, [chat_id]: next };
      });
    });

    const unlistenUpdate = listen<{ old_id: string; message: DmMessage; chat_id: string }>(
      'message_update',
      (event) => {
        const { old_id, message, chat_id } = event.payload;
        dmLog('message_update', { chat_id: chat_id.slice(0, 20) + '…', old_id: old_id?.slice(0, 12), new_id: message.id?.slice(0, 12) });
        if (!chat_id.startsWith('npub1')) return;
        const m: DmMessage = {
          id: message.id,
          content: message.content,
          at: message.at,
          mine: message.mine,
          npub: message.npub,
          pending: message.pending,
          failed: message.failed,
        };
        backendDmMessages.update((byNpub) => {
          const list = byNpub[chat_id] ?? [];
          const out = list.filter((x) => x.id !== old_id && x.id !== m.id);
          return { ...byNpub, [chat_id]: [...out, m].sort((a, b) => a.at - b.at) };
        });
      }
    );

    // Drive historical sync: backend emits sync_slice_finished after each 2-day window; we must call fetch_messages(init: false) to get the next window.
    const unlistenSyncSlice = listen('sync_slice_finished', () => {
      dmLog('sync_slice_finished → fetchMessages(false)');
      dmSyncStatus.set('syncing');
      fetchMessages(false).catch((e) => {
        dmError('sync_slice_finished: fetchMessages(false) failed', e);
      });
    });

    const unlistenSyncProgress = listen('sync_progress', () => {
      dmSyncStatus.update((s) => (s === 'idle' ? 'syncing' : s));
    });

    const unlistenSyncFinished = listen('sync_finished', () => {
      dmLog('sync_finished (historical sync complete)');
      dmSyncStatus.set('finished');
      setTimeout(() => dmSyncStatus.set('idle'), 2500);
    });

    const unlistenTyping = listen<{ conversation_id: string; typers: string[] }>('typing-update', (e) => {
      const { conversation_id, typers } = e.payload;
      if (!conversation_id.startsWith('npub1')) return;
      typingByChat.update((by) => ({ ...by, [conversation_id]: typers ?? [] }));
    });

    const unlistenMlsNew = listen<{ group_id: string; message: DmMessage }>('mls_message_new', (event) => {
      const { group_id, message } = event.payload;
      const m: DmMessage = {
        id: message.id,
        content: message.content,
        at: message.at,
        mine: message.mine,
        npub: message.npub,
        pending: message.pending,
        failed: message.failed,
      };
      backendGroupMessages.update((byGroup) => {
        const list = byGroup[group_id] ?? [];
        if (list.some((x) => x.id === m.id)) return byGroup;
        const withoutOpt = list.filter(
          (x) => !(x.id.startsWith('opt-') && x.mine && x.content === m.content)
        );
        return { ...byGroup, [group_id]: [...withoutOpt, m] };
      });
    });

    async function refreshPendingWelcomes() {
      const list = await listPendingMlsWelcomes();
      pendingMlsWelcomes.set(list);
    }

    refreshPendingWelcomes().catch((e) => dmError('refreshPendingWelcomes', e));

    const unlistenInviteReceived = listen('mls_invite_received', () => {
      refreshPendingWelcomes().catch((e) => dmError('mls_invite_received refresh', e));
    });

    const unlistenWelcomeAccepted = listen<{ group_id: string }>('mls_welcome_accepted', (event) => {
      const group_id = event.payload.group_id;
      refreshPendingWelcomes().catch((e) => dmError('mls_welcome_accepted refresh', e));
      if (acceptedSquadInviteGroupIds.has(group_id)) {
        acceptedSquadInviteGroupIds.delete(group_id);
        return;
      }
      const list = get(squads);
      const singleChannelSquads = list.filter((s) => s.channels.length === 1);
      if (singleChannelSquads.length === 1) {
        const squad = singleChannelSquads[0];
        const name = group_id.slice(0, 12) + '…';
        const newChannel: Channel = { id: group_id, name, groupId: group_id, order: squad.channels.length };
        squads.update((l) =>
          l.map((s) => (s.id !== squad.id ? s : { ...s, channels: [...s.channels, newChannel] }))
        );
        return;
      }
      pendingAddToSquadGroupId = group_id;
    });

    return () => {
      unlistenNew.then((fn) => fn());
      unlistenUpdate.then((fn) => fn());
      unlistenSyncSlice.then((fn) => fn());
      unlistenSyncProgress.then((fn) => fn());
      unlistenSyncFinished.then((fn) => fn());
      unlistenTyping.then((fn) => fn());
      unlistenMlsNew.then((fn) => fn());
      unlistenInviteReceived.then((fn) => fn());
      unlistenWelcomeAccepted.then((fn) => fn());
    };
  });
</script>

<div class="page">
  <header class="top-navbar-slot">
    <TopNavbar />
  </header>
  <main class="container">
    <Navbar />
    <div class="content-wrap">
      {#if $activeView === 'profile'}
        <Profile />
      {:else if $activeTopNavTab === 'dms'}
        <div class="dm-area">
          <MessengerNavbar />
          <div class="dm-area-center">
            {#if $dmSyncStatus !== 'idle'}
              <p class="dm-sync-banner dm-sync-{$dmSyncStatus}" role="status">
                {$dmSyncStatus === 'syncing' ? 'Updating messages…' : 'Up to date'}
              </p>
            {/if}
            <div class="dm-main">
            {#if $composingNewChat}
              <MessengerChatView />
            {:else if $activeDmId}
              <div class="dm-thread">
          <div class="dm-thread-header">
            <div class="dm-thread-header-avatar">
              {#if contactAvatarSrc}
                <img src={contactAvatarSrc} alt="" class="dm-thread-header-avatar-img" />
              {:else}
                <span class="dm-thread-header-avatar-placeholder">{contactDisplayName.charAt(0).toUpperCase()}</span>
              {/if}
            </div>
            <div class="dm-thread-header-info">
              {#if showNicknameEdit}
                <div class="dm-thread-nickname-edit">
                  <input
                    type="text"
                    class="dm-thread-nickname-input"
                    placeholder="Nickname"
                    bind:value={nicknameEditValue}
                    on:keydown={(e) => e.key === 'Escape' && cancelNicknameEdit()}
                  />
                  <button type="button" class="dm-thread-nickname-btn dm-thread-nickname-save" on:click={saveNickname} disabled={nicknameSaving}>
                    {nicknameSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" class="dm-thread-nickname-btn dm-thread-nickname-cancel" on:click={cancelNicknameEdit} disabled={nicknameSaving}>
                    Cancel
                  </button>
                </div>
                {#if nicknameError}
                  <p class="dm-thread-nickname-error" role="alert">{nicknameError}</p>
                {/if}
              {:else}
                <div class="dm-thread-header-title-row">
                  <h3 class="dm-thread-title">{contactDisplayName}</h3>
                  <button type="button" class="dm-thread-set-nickname" on:click={openNicknameEdit} title="Set nickname for this contact">
                    Set nickname
                  </button>
                </div>
                <span class="dm-thread-npub">{truncateNpub($activeDmId)}</span>
              {/if}
            </div>
          </div>
          <div class="dm-thread-messages" bind:this={dmMessagesContainer}>
            {#if canLoadOlder}
              <div class="dm-thread-load-older">
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
            {#if mergedDmMessages.length > 0}
              {#each mergedDmMessages as msg (msg.id)}
                {@const invitePayload = parseSquadInviteMessage(msg.content)}
                {#if invitePayload}
                  {@const inviterName = msg.mine ? (getProfileDisplayName($profiles[$activeDmId]) || $activeDmId?.slice(0, 12) + '…') : (msg.npub ? (getProfileDisplayName($profiles[msg.npub]) || msg.npub.slice(0, 12) + '…') : 'Someone')}
                  <div class="squad-invite-card">
                    <p class="squad-invite-text">
                      {#if msg.mine}
                        You invited {inviterName} to <strong>{invitePayload.squadName}</strong>.
                      {:else}
                        {inviterName} invited you to <strong>{invitePayload.squadName}</strong>.
                      {/if}
                    </p>
                    {#if msg.mine}
                      <!-- Inviter: no actions -->
                    {:else if acceptedSquadInviteIds.has(msg.id)}
                      <p class="squad-invite-accepted">Accepted</p>
                    {:else if declinedSquadInviteIds.has(msg.id)}
                      <p class="squad-invite-declined">Declined</p>
                    {:else}
                      <div class="squad-invite-actions">
                        <button
                          type="button"
                          class="squad-invite-btn squad-invite-btn-accept"
                          disabled={acceptingSquadInviteId === msg.id}
                          on:click={() => handleAcceptSquadInvite(msg, invitePayload.groupId)}
                        >
                          {acceptingSquadInviteId === msg.id ? 'Accepting…' : 'Accept'}
                        </button>
                        <button
                          type="button"
                          class="squad-invite-btn squad-invite-btn-decline"
                          disabled={acceptingSquadInviteId === msg.id}
                          on:click={() => { declinedSquadInviteIds = new Set(declinedSquadInviteIds).add(msg.id); }}
                        >
                          Decline
                        </button>
                      </div>
                    {/if}
                  </div>
                {:else}
                  <Message {...toMessageProps(msg)} />
                {/if}
              {/each}
            {:else}
              <p class="dm-thread-placeholder">No messages yet</p>
            {/if}
          </div>
          {#if ($typingByChat[$activeDmId]?.length ?? 0) > 0}
            <p class="dm-thread-typing" role="status">Typing…</p>
          {/if}
          {#if $dmSendError}
            <p class="dm-thread-error" role="alert">{$dmSendError}</p>
          {/if}
          <MessageInput
            channelName={truncateNpub($activeDmId)}
            onSend={handleDmSend}
            onTyping={handleDmTyping}
          />
              </div>
            {:else}
              <div class="dm-empty">
                <p>Select a conversation or start a new chat</p>
              </div>
            {/if}
            </div>
          </div>
        </div>
      {:else}
        <div class="squads-area">
          <SquadNavbar />
          <ChatView />
        </div>
      {/if}
    </div>

    <!-- Add to squad modal (after accepting an invite) -->
    {#if pendingAddToSquadGroupId}
      <div class="add-to-squad-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="add-to-squad-modal-title">
        <div class="add-to-squad-modal">
          <h2 id="add-to-squad-modal-title">Add channel to a squad</h2>
          <p class="add-to-squad-modal-text">You joined a new channel. Add it to a squad to see it in the sidebar.</p>
          <div class="add-to-squad-modal-list">
            {#each $squads as squad (squad.id)}
              <button
                type="button"
                class="add-to-squad-modal-option"
                on:click={() => addAcceptedChannelToSquad(squad.id)}
              >
                {squad.name}
              </button>
            {/each}
          </div>
          {#if $squads.length === 0}
            <p class="add-to-squad-modal-empty">Create a squad first (Organize Squad).</p>
          {/if}
          <button type="button" class="add-to-squad-modal-skip" on:click={() => (pendingAddToSquadGroupId = null)}>
            Skip
          </button>
        </div>
      </div>
    {/if}
  </main>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
  }
  .top-navbar-slot {
    flex-shrink: 0;
    z-index: 10;
  }
  .page .container {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: row;
  }

  .content-wrap {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .squads-area {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: row;
  }

  .dm-area {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: row;
  }

  .dm-area-center {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .dm-main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .dm-thread {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background-color: #313338;
  }

  .dm-thread-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 24px;
    border-bottom: 1px solid #1e1f22;
  }

  .dm-thread-header-avatar {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    overflow: hidden;
    background-color: #383a40;
  }

  .dm-thread-header-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .dm-thread-header-avatar-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-weight: 600;
    font-size: 1.125rem;
    background-color: #5865f2;
  }

  .dm-thread-header-info {
    min-width: 0;
  }

  .dm-thread-title {
    font-size: 1rem;
    font-weight: 600;
    color: #f2f3f5;
    margin: 0 0 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dm-thread-npub {
    font-size: 0.8125rem;
    color: #b5bac1;
  }

  .dm-thread-header-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .dm-thread-set-nickname {
    flex-shrink: 0;
    padding: 4px 8px;
    font-size: 0.75rem;
    color: #949ba4;
    background: transparent;
    border: 1px solid #404249;
    border-radius: 4px;
    cursor: pointer;
    outline: none;
  }

  .dm-thread-set-nickname:hover {
    color: #f2f3f5;
    border-color: #5865f2;
  }

  .dm-thread-nickname-edit {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .dm-thread-nickname-input {
    flex: 1;
    min-width: 120px;
    padding: 6px 10px;
    font-size: 0.9375rem;
    color: #f2f3f5;
    background: #1e1f22;
    border: 1px solid #404249;
    border-radius: 4px;
    outline: none;
  }

  .dm-thread-nickname-input:focus {
    border-color: #5865f2;
  }

  .dm-thread-nickname-btn {
    padding: 6px 12px;
    font-size: 0.8125rem;
    border-radius: 4px;
    cursor: pointer;
    outline: none;
    border: none;
  }

  .dm-thread-nickname-save {
    background: #5865f2;
    color: #fff;
  }

  .dm-thread-nickname-save:hover:not(:disabled) {
    background: #4752c4;
  }

  .dm-thread-nickname-cancel {
    background: transparent;
    color: #949ba4;
    border: 1px solid #404249;
  }

  .dm-thread-nickname-cancel:hover:not(:disabled) {
    color: #f2f3f5;
  }

  .dm-thread-nickname-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .dm-thread-nickname-error {
    margin: 4px 0 0 0;
    font-size: 0.75rem;
    color: #f23f42;
  }

  .dm-thread-messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 24px;
  }

  .dm-thread-load-older {
    margin-bottom: 16px;
  }

  .load-older-btn {
    padding: 8px 16px;
    font-size: 0.875rem;
    color: #b5bac1;
    background: #383a40;
    border: 1px solid #1e1f22;
    border-radius: 4px;
    cursor: pointer;
    outline: none;
  }

  .load-older-btn:hover:not(:disabled) {
    color: #f2f3f5;
    background: #4e5058;
  }

  .load-older-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .dm-thread-placeholder {
    font-size: 0.875rem;
    color: #6d6f78;
    margin: 0;
  }

  .squad-invite-card {
    margin: 8px 16px;
    padding: 12px 16px;
    background: #2b2d31;
    border: 1px solid #404249;
    border-radius: 8px;
    max-width: 420px;
  }

  .squad-invite-text {
    margin: 0 0 12px;
    font-size: 0.9375rem;
    color: #dbdee1;
    line-height: 1.4;
  }

  .squad-invite-text strong {
    color: #f2f3f5;
  }

  .squad-invite-accepted {
    margin: 0;
    font-size: 0.8125rem;
    color: #57f287;
  }

  .squad-invite-declined {
    margin: 0;
    font-size: 0.8125rem;
    color: #949ba4;
  }

  .squad-invite-actions {
    display: flex;
    gap: 8px;
  }

  .squad-invite-btn {
    padding: 6px 14px;
    font-size: 0.8125rem;
    border-radius: 6px;
    cursor: pointer;
    border: none;
  }

  .squad-invite-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .squad-invite-btn-accept {
    background: #5865f2;
    color: #fff;
  }

  .squad-invite-btn-accept:hover:not(:disabled) {
    background: #4752c4;
  }

  .squad-invite-btn-decline {
    background: #4e5058;
    color: #dbdee1;
  }

  .squad-invite-btn-decline:hover:not(:disabled) {
    background: #5d6069;
  }

  .dm-thread-typing {
    font-size: 0.8125rem;
    color: #949ba4;
    margin: 0;
    padding: 4px 24px 8px;
    font-style: italic;
  }

  .dm-thread-error {
    font-size: 0.875rem;
    color: #ed4245;
    margin: 0;
    padding: 8px 24px;
    background-color: rgba(237, 66, 69, 0.1);
    border-top: 1px solid #1e1f22;
  }

  .dm-sync-banner {
    margin: 0;
    padding: 6px 24px;
    font-size: 0.8125rem;
    flex-shrink: 0;
    width: 100%;
    text-align: center;
    box-sizing: border-box;
  }

  .dm-sync-syncing {
    color: #b5bac1;
    background-color: #2b2d31;
  }

  .dm-sync-finished {
    color: #949ba4;
    background-color: #24804620;
  }

  .dm-empty {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #313338;
    color: #6d6f78;
    font-size: 0.9375rem;
  }

  .add-to-squad-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .add-to-squad-modal {
    background: #2b2d31;
    border: 1px solid #404249;
    border-radius: 8px;
    padding: 20px;
    min-width: 280px;
    max-width: 90vw;
  }

  .add-to-squad-modal h2 {
    margin: 0 0 8px;
    font-size: 1.125rem;
    color: #f2f3f5;
  }

  .add-to-squad-modal-text {
    margin: 0 0 16px;
    font-size: 0.875rem;
    color: #949ba4;
  }

  .add-to-squad-modal-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 16px;
  }

  .add-to-squad-modal-option {
    padding: 8px 12px;
    text-align: left;
    font-size: 0.9375rem;
    color: #dbdee1;
    background: #383a40;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  .add-to-squad-modal-option:hover {
    background: #4e5058;
  }

  .add-to-squad-modal-empty {
    margin: 0 0 16px;
    font-size: 0.875rem;
    color: #949ba4;
  }

  .add-to-squad-modal-skip {
    padding: 6px 14px;
    font-size: 0.875rem;
    background: transparent;
    border: 1px solid #4e5058;
    border-radius: 6px;
    color: #949ba4;
    cursor: pointer;
  }

  .add-to-squad-modal-skip:hover {
    background: #35373c;
    color: #dbdee1;
  }
</style>
