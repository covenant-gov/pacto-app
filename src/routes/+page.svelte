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
  import SquadInviteCard from '../components/SquadInviteCard.svelte';
  import ChannelInSquadCard from '../components/ChannelInSquadCard.svelte';
  import ChannelInNetworkCard from '../components/ChannelInNetworkCard.svelte';
  import NetworkInviteCard from '../components/NetworkInviteCard.svelte';
  import NetworkNavbar from '../components/NetworkNavbar.svelte';
  import { getDmMessages, getChatMessageCount, sendDmMessage, queueProfileSync, fetchMessages, markAsRead, startTyping, setNickname, listPendingMlsWelcomes, acceptMlsWelcome, parseSquadInviteMessage, parseChannelInSquadMessage, parseChannelInNetworkMessage, parseNetworkInviteMessage, syncMlsGroupsNow } from '../lib/api/nostr';
  import { getInvokeErrorMessage, friendlyMessage } from '../lib/utils/tauri-errors';
  import { getProfileAvatarSrc, getProfileDisplayName } from '../lib/utils/profile';
  import { dmLog, dmError } from '../lib/utils/dm-debug';
  import chevronDownIcon from '../icons/chevron-down.svg';
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
    pinnedList,
    lastOpenedDmByTab,
    lastOpenedSquadId,
    lastOpenedChannelId,
    networks,
    activeNetworkId,
    lastOpenedNetworkId,
    lastOpenedNetworkChannelId,
    acceptedSquadInviteIds,
    declinedSquadInviteIds,
    acceptedNetworkInviteIds,
    declinedNetworkInviteIds,
    acceptedChannelInviteMessageIds,
    declinedChannelInviteMessageIds,
    dmChatsByNpub,
    pinnedDmNpubs,
    dmSendError,
    type DmMessage,
    type DmTab,
    type Channel,
    type Network,
  } from '../stores/app';

  const PAGE_SIZE = 100;
  const LOAD_OLDER_PAGE_SIZE = 50;

  /** Group IDs we just accepted as squad invites — skip "Add to squad" modal for these. */
  let acceptedSquadInviteGroupIds = new Set<string>();

  /** When user accepts a channel invite (squad or network) we store mapping so mls_welcome_accepted can add channel to the right parent. */
  let channelInvitePendingAccept = new Map<
    string,
    { parentType: 'squad' | 'network'; parentId: string; channelName: string }
  >();

  /** Add a channel to a squad (parentId = announcementsGroupId) or network (parentId = network id). */
  function addChannelToParent(
    parentType: 'squad' | 'network',
    parentId: string,
    channelGroupId: string,
    channelName: string
  ) {
    const newChannel: Channel = {
      id: channelGroupId,
      name: channelName,
      groupId: channelGroupId,
      order: 0,
    };
    if (parentType === 'squad') {
      const list = get(squads);
      const squad = list.find((s) => {
        const ann = s.channels?.slice().sort((a, b) => a.order - b.order)[0];
        return ann?.groupId === parentId;
      });
      if (squad) {
        newChannel.order = squad.channels.length;
        squads.update((l) =>
          l.map((s) => (s.id !== squad.id ? s : { ...s, channels: [...s.channels, newChannel] }))
        );
      }
    } else {
      const list = get(networks);
      const network = list.find((n) => n.id === parentId);
      if (network) {
        newChannel.order = network.channels.length;
        networks.update((l) =>
          l.map((n) => (n.id !== network.id ? n : { ...n, channels: [...n.channels, newChannel] }))
        );
      }
    }
  }

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
      const list =
        tab === 'friends'
          ? $dmList
          : tab === 'requests'
            ? $requestsList
            : tab === 'pending'
              ? $pendingList
              : $pinnedList;
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

  // Remember last opened squad/channel (so switching to Squads view restores it)
  $: if ($activeTopNavTab === 'squads' && $activeSquadId) {
    lastOpenedSquadId.set($activeSquadId);
    if ($activeChannelId) lastOpenedChannelId.set($activeChannelId);
  }
  $: if ($activeTopNavTab === 'squads' && $activeChannelId && !$activeChannelId.startsWith('creating-')) {
    lastOpenedChannelId.set($activeChannelId);
  }

  // Persist last-opened network/channel when user selects in Networks tab (also set in NetworkNavbar)
  $: if ($activeTopNavTab === 'networks' && $activeNetworkId) {
    lastOpenedNetworkId.set($activeNetworkId);
    if ($activeChannelId) lastOpenedNetworkChannelId.set($activeChannelId);
  }
  $: if ($activeTopNavTab === 'networks' && $activeChannelId && !$activeChannelId.startsWith('creating-')) {
    lastOpenedNetworkChannelId.set($activeChannelId);
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
    const squadInviteCount = list.filter((m) => parseSquadInviteMessage(m.content ?? '') !== null).length;
    if (list.length > 0 || npub) console.log('[Squad/Invite] mergedDmMessages for', npub?.slice(0, 24) + '…', 'count=', list.length, 'squadInviteMsgs=', squadInviteCount);
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

  // Load group messages when opening a channel (Squads tab). Skip placeholder "creating-*" channels.
  $: if ($activeChannelId && $activeTopNavTab === 'squads' && !$activeChannelId.startsWith('creating-')) {
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

  // Squad/network/channel-in-squad invite cards: accepted/declined are persisted in app store; accepting is transient
  let acceptingSquadInviteId: string | null = null;
  let acceptingChannelInSquadId: string | null = null;
  let acceptingChannelInNetworkId: string | null = null;
  let acceptingNetworkInviteId: string | null = null;

  // Message bubbles show sender avatar and display name from profiles
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
      // Mark before accept so mls_welcome_accepted listener skips "Add to squad" modal (channel is already this squad)
      acceptedSquadInviteGroupIds.add(groupId);
      await acceptMlsWelcome(welcome.id);
      acceptedSquadInviteIds.update((ids) => (ids.includes(msg.id) ? ids : [...ids, msg.id]));
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

  async function handleAcceptChannelInSquad(msg: DmMessage, payload: { channelGroupId: string; announcementsGroupId: string; channelName: string }) {
    if (acceptingChannelInSquadId) return;
    acceptingChannelInSquadId = msg.id;
    try {
      const welcomes = await listPendingMlsWelcomes();
      const welcome = welcomes.find((w) => w.nostr_group_id === payload.channelGroupId);
      if (!welcome) {
        dmError('Accept channel in squad: no pending welcome for channel', payload.channelGroupId);
        return;
      }
      channelInvitePendingAccept.set(payload.channelGroupId, {
        parentType: 'squad',
        parentId: payload.announcementsGroupId,
        channelName: payload.channelName,
      });
      acceptedSquadInviteGroupIds.add(payload.channelGroupId);
      await acceptMlsWelcome(welcome.id);
      acceptedChannelInviteMessageIds.update((ids) => (ids.includes(msg.id) ? ids : [...ids, msg.id]));
    } catch (e) {
      dmError('Accept channel invite failed', e);
      channelInvitePendingAccept.delete(payload.channelGroupId);
      acceptedSquadInviteGroupIds.delete(payload.channelGroupId);
    } finally {
      acceptingChannelInSquadId = null;
    }
  }

  async function handleAcceptChannelInNetwork(
    msg: DmMessage,
    payload: { networkId: string; channelGroupId: string; channelName: string }
  ) {
    if (acceptingChannelInNetworkId) return;
    acceptingChannelInNetworkId = msg.id;
    try {
      const welcomes = await listPendingMlsWelcomes();
      const welcome = welcomes.find((w) => w.nostr_group_id === payload.channelGroupId);
      if (!welcome) {
        dmError('Accept channel in network: no pending welcome for channel', payload.channelGroupId);
        return;
      }
      channelInvitePendingAccept.set(payload.channelGroupId, {
        parentType: 'network',
        parentId: payload.networkId,
        channelName: payload.channelName,
      });
      acceptedSquadInviteGroupIds.add(payload.channelGroupId);
      await acceptMlsWelcome(welcome.id);
      acceptedChannelInviteMessageIds.update((ids) => (ids.includes(msg.id) ? ids : [...ids, msg.id]));
    } catch (e) {
      dmError('Accept channel in network invite failed', e);
      channelInvitePendingAccept.delete(payload.channelGroupId);
      acceptedSquadInviteGroupIds.delete(payload.channelGroupId);
    } finally {
      acceptingChannelInNetworkId = null;
    }
  }

  async function handleAcceptNetworkInvite(
    msg: DmMessage,
    payload: { networkName: string; groupId: string; memberSquads: { id: string; name: string }[] }
  ) {
    if (acceptingNetworkInviteId) return;
    acceptingNetworkInviteId = msg.id;
    dmSendError.set(null);
    try {
      const welcomes = await listPendingMlsWelcomes();
      const welcome = welcomes.find((w) => w.nostr_group_id === payload.groupId);
      if (!welcome) {
        dmSendError.set('No pending invite for this network. The invite may have expired.');
        return;
      }
      acceptedSquadInviteGroupIds.add(payload.groupId);
      await acceptMlsWelcome(welcome.id);
      const now = Date.now();
      const announcementsChannel: Channel = {
        id: payload.groupId,
        name: 'Announcements',
        groupId: payload.groupId,
        order: 0,
      };
      const newNetwork: Network = {
        id: crypto.randomUUID(),
        name: payload.networkName,
        channels: [announcementsChannel],
        memberSquads: payload.memberSquads,
        createdAt: now,
        updatedAt: now,
      };
      networks.update((list) => [...list, newNetwork]);
      activeNetworkId.set(newNetwork.id);
      activeChannelId.set(payload.groupId);
      activeTopNavTab.set('networks');
      activeView.set('hub');
      acceptedNetworkInviteIds.update((ids) => (ids.includes(msg.id) ? ids : [...ids, msg.id]));
    } catch (e) {
      dmError('Accept network invite failed', e);
      dmSendError.set(friendlyMessage(getInvokeErrorMessage(e)) || 'Failed to accept network invite.');
    } finally {
      acceptingNetworkInviteId = null;
    }
  }

  let dmTypingTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Timeouts that clear "Typing" after no updates (backend doesn't emit when typing expires). */
  const typingClearTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  const TYPING_EXPIRY_SEC = 15;

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

  let dmThreadMenuOpen = false;

  function openNicknameEdit() {
    dmThreadMenuOpen = false;
    nicknameEditValue = contactProfile?.nickname ?? '';
    nicknameError = null;
    showNicknameEdit = true;
  }

  function pinDm() {
    const npub = $activeDmId;
    if (!npub) return;
    pinnedDmNpubs.update((s) => {
      if (s.has(npub)) return s;
      const next = new Set(s);
      next.add(npub);
      return next;
    });
    dmThreadMenuOpen = false;
  }

  function unpinDm() {
    const npub = $activeDmId;
    if (!npub) return;
    pinnedDmNpubs.update((s) => {
      if (!s.has(npub)) return s;
      const next = new Set(s);
      next.delete(npub);
      return next;
    });
    dmThreadMenuOpen = false;
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
    // Restore last opened squad/channel (like DMs)
    const lastSquadId = $lastOpenedSquadId;
    const lastChannelId = $lastOpenedChannelId;
    const squad = lastSquadId ? $squads.find((s) => s.id === lastSquadId) : null;
    if (squad) {
      activeSquadId.set(squad.id);
      const channel =
        lastChannelId && squad.channels.some((c) => c.groupId === lastChannelId)
          ? squad.channels.find((c) => c.groupId === lastChannelId)
          : squad.channels[0];
      activeChannelId.set(channel?.groupId ?? null);
    } else if ($squads.length > 0 && !$activeSquadId) {
      const first = $squads[0];
      activeSquadId.set(first.id);
      activeChannelId.set(first.channels.length > 0 ? first.channels[0].groupId : null);
    }
  } else if ($activeTopNavTab === 'networks' && prevTopNavTab !== 'networks') {
    prevTopNavTab = 'networks';
    // Restore last-opened network/channel when switching to Networks tab
    const lastNetId = $lastOpenedNetworkId;
    const lastChanId = $lastOpenedNetworkChannelId;
    const net = lastNetId ? $networks.find((n) => n.id === lastNetId) : null;
    if (net) {
      activeNetworkId.set(net.id);
      const sorted = [...net.channels].sort((a, b) => a.order - b.order);
      const ch =
        lastChanId && sorted.some((c) => c.groupId === lastChanId)
          ? sorted.find((c) => c.groupId === lastChanId)
          : sorted[0];
      activeChannelId.set(ch?.groupId ?? sorted[0]?.groupId ?? null);
    } else if ($networks.length > 0) {
      // No valid last-opened, or last-opened was removed: ensure valid selection
      const currentNet = $activeNetworkId ? $networks.find((n) => n.id === $activeNetworkId) : null;
      if (!currentNet) {
        const first = $networks[0];
        const firstCh = first.channels.slice().sort((a, b) => a.order - b.order)[0];
        activeNetworkId.set(first.id);
        activeChannelId.set(firstCh?.groupId ?? null);
      }
    }
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
      // Squad/network/channel-in-squad invites are normal DMs: no friend check. Receiver sees in Requests, sender in Pending; Accept/Decline in thread.
      const isSquadInvite = parseSquadInviteMessage(message.content ?? '') !== null;
      const isNetworkInvite = parseNetworkInviteMessage(message.content ?? '') !== null;
      const isInviteDm = isSquadInvite || isNetworkInvite || parseChannelInSquadMessage(message.content ?? '') !== null;
      console.log('[Squad/Invite] message_new: chat_id=', chat_id?.slice(0, 24) + '…', 'mine=', message.mine, 'isInviteDm=', isInviteDm, 'contentPreview=', (message.content ?? '').slice(0, 60) + (message.content && message.content.length > 60 ? '…' : ''));
      if (!chat_id.startsWith('npub1')) return;
      const m: DmMessage = {
        id: message.id,
        content: message.content,
        at: message.at,
        mine: message.mine,
        npub: message.npub,
        pending: message.pending,
        failed: message.failed,
        replied_to: (message as { replied_to?: string }).replied_to,
        replied_to_content: (message as { replied_to_content?: string | null }).replied_to_content,
        replied_to_npub: (message as { replied_to_npub?: string | null }).replied_to_npub,
        replied_to_has_attachment: (message as { replied_to_has_attachment?: boolean | null }).replied_to_has_attachment,
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
        const hadChat = chat_id in map;
        const next = {
          npub: chat_id,
          name: cur?.name,
          avatar: cur?.avatar,
          hasFromMe: (cur?.hasFromMe ?? false) || m.mine,
          hasFromThem: (cur?.hasFromThem ?? false) || !m.mine,
          lastAt: Math.max(cur?.lastAt ?? 0, m.at),
        };
        if (isInviteDm && !hadChat) console.log('[Squad/Invite] message_new: invite DM added chat (receiver=Requests, sender=Pending)', chat_id?.slice(0, 24) + '…');
        return { ...map, [chat_id]: next };
      });
      // Sender sent a message — clear "Typing" for this chat and cancel expiry timeout
      const clearTimeoutId = typingClearTimeouts.get(chat_id);
      if (clearTimeoutId) {
        clearTimeout(clearTimeoutId);
        typingClearTimeouts.delete(chat_id);
      }
      typingByChat.update((by) => {
        if (!by[chat_id]?.length) return by;
        return { ...by, [chat_id]: [] };
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
          replied_to: (message as { replied_to?: string }).replied_to,
          replied_to_content: (message as { replied_to_content?: string | null }).replied_to_content,
          replied_to_npub: (message as { replied_to_npub?: string | null }).replied_to_npub,
          replied_to_has_attachment: (message as { replied_to_has_attachment?: boolean | null }).replied_to_has_attachment,
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
      const list = typers ?? [];
      typingByChat.update((by) => ({ ...by, [conversation_id]: list }));

      // Clear "Typing" after TYPING_EXPIRY_SEC if we don't get another update (backend doesn't re-emit on expiry)
      const existing = typingClearTimeouts.get(conversation_id);
      if (existing) clearTimeout(existing);
      typingClearTimeouts.delete(conversation_id);
      if (list.length > 0) {
        const t = setTimeout(() => {
          typingClearTimeouts.delete(conversation_id);
          typingByChat.update((by) => {
            const next = { ...by };
            if (next[conversation_id]?.length) next[conversation_id] = [];
            return next;
          });
        }, TYPING_EXPIRY_SEC * 1000);
        typingClearTimeouts.set(conversation_id, t);
      }
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
        replied_to: (message as { replied_to?: string }).replied_to,
        replied_to_content: (message as { replied_to_content?: string | null }).replied_to_content,
        replied_to_npub: (message as { replied_to_npub?: string | null }).replied_to_npub,
        replied_to_has_attachment: (message as { replied_to_has_attachment?: boolean | null }).replied_to_has_attachment,
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
      console.log('[Squad/Invite] refreshPendingWelcomes: calling listPendingMlsWelcomes…');
      const list = await listPendingMlsWelcomes();
      pendingMlsWelcomes.set(list);
      console.log('[Squad/Invite] refreshPendingWelcomes: count=', list.length, 'welcomes=', list.map((w) => ({ groupId: w.nostr_group_id?.slice(0, 16) + '…', name: w.group_name, wrapperId: w.wrapper_event_id?.slice(0, 16) + '…' })));
    }

    refreshPendingWelcomes().catch((e) => dmError('refreshPendingWelcomes', e));

    const unlistenInviteReceived = listen('mls_invite_received', () => {
      console.log('[Squad/Invite] mls_invite_received event: refreshing pending welcomes');
      refreshPendingWelcomes().catch((e) => dmError('mls_invite_received refresh', e));
    });

    const unlistenWelcomeAccepted = listen<{ group_id: string }>('mls_welcome_accepted', (event) => {
      const group_id = event.payload.group_id;
      refreshPendingWelcomes().catch((e) => dmError('mls_welcome_accepted refresh', e));
      // Channel invite (squad or network): add this channel to the right parent
      const channelInviteInfo = channelInvitePendingAccept.get(group_id);
      if (channelInviteInfo) {
        channelInvitePendingAccept.delete(group_id);
        acceptedSquadInviteGroupIds.delete(group_id);
        addChannelToParent(
          channelInviteInfo.parentType,
          channelInviteInfo.parentId,
          group_id,
          channelInviteInfo.channelName
        );
        return;
      }
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

    // Backend auto-accepted a channel invite (user already in parent). addChannelToParent works for squad and network.
    const unlistenChannelAddedToSquad = listen<{
      announcements_group_id: string;
      channel_group_id: string;
      channel_name: string;
    }>('channel_added_to_squad', (event) => {
      const { announcements_group_id, channel_group_id, channel_name } = event.payload;
      refreshPendingWelcomes().catch((e) => dmError('channel_added_to_squad refresh', e));
      addChannelToParent('squad', announcements_group_id, channel_group_id, channel_name);
    });

    const unlistenChannelAddedToNetwork = listen<{
      network_id: string;
      channel_group_id: string;
      channel_name: string;
    }>('channel_added_to_network', (event) => {
      const { network_id, channel_group_id, channel_name } = event.payload;
      refreshPendingWelcomes().catch((e) => dmError('channel_added_to_network refresh', e));
      addChannelToParent('network', network_id, channel_group_id, channel_name);
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
      unlistenChannelAddedToSquad.then((fn) => fn());
      unlistenChannelAddedToNetwork.then((fn) => fn());
    };
  });
</script>

<svelte:window
  on:click={(e) => {
    const t = e.target as HTMLElement | null;
    if (dmThreadMenuOpen && t && !t.closest('.dm-thread-header-actions')) dmThreadMenuOpen = false;
  }}
/>
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
                  {#if $activeDmTab === 'friends' || $activeDmTab === 'pinned'}
                    <div class="dm-thread-header-actions">
                      <button
                        type="button"
                        class="dm-thread-dropdown-trigger"
                        title="Options"
                        on:click={() => (dmThreadMenuOpen = !dmThreadMenuOpen)}
                        aria-haspopup="true"
                        aria-expanded={dmThreadMenuOpen}
                      >
                        <img src={chevronDownIcon} alt="" class="dm-thread-chevron" />
                      </button>
                      {#if dmThreadMenuOpen}
                        <div class="dm-thread-dropdown" role="menu">
                          <button type="button" class="dm-thread-dropdown-item" role="menuitem" on:click={openNicknameEdit}>
                            Set Nickname
                          </button>
                          {#if $pinnedDmNpubs.has($activeDmId)}
                            <button type="button" class="dm-thread-dropdown-item" role="menuitem" on:click={unpinDm}>
                              Unpin DM
                            </button>
                          {:else}
                            <button type="button" class="dm-thread-dropdown-item" role="menuitem" on:click={pinDm}>
                              Pin DM
                            </button>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/if}
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
                {@const channelInSquadPayload = parseChannelInSquadMessage(msg.content ?? '')}
                {@const channelInNetworkPayload = parseChannelInNetworkMessage(msg.content ?? '')}
                {@const networkInvitePayload = parseNetworkInviteMessage(msg.content ?? '')}
                {@const invitePayload = parseSquadInviteMessage(msg.content ?? '')}
                {#if channelInSquadPayload}
                  {@const inviterNpub = msg.mine ? $activeDmId : msg.npub}
                  {@const inviterProfile = inviterNpub ? $profiles[inviterNpub] : null}
                  {@const inviterName = msg.mine ? (getProfileDisplayName($profiles[$activeDmId]) || $activeDmId?.slice(0, 12) + '…') : (msg.npub ? (getProfileDisplayName($profiles[msg.npub]) || msg.npub.slice(0, 12) + '…') : 'Someone')}
                  {@const inviterAvatarSrc = inviterProfile ? getProfileAvatarSrc(inviterProfile) : null}
                  {@const channelInviteStatus = $acceptedChannelInviteMessageIds.includes(msg.id) ? 'accepted' : $declinedChannelInviteMessageIds.includes(msg.id) ? 'declined' : 'pending'}
                  <ChannelInSquadCard
                    squadName={channelInSquadPayload.squadName}
                    channelName={channelInSquadPayload.channelName}
                    isMine={msg.mine}
                    inviterName={inviterName}
                    inviterAvatarSrc={inviterAvatarSrc}
                    status={channelInviteStatus}
                    accepting={acceptingChannelInSquadId === msg.id}
                    onAccept={() => handleAcceptChannelInSquad(msg, { channelGroupId: channelInSquadPayload.channelGroupId, announcementsGroupId: channelInSquadPayload.announcementsGroupId, channelName: channelInSquadPayload.channelName })}
                    onDecline={() => { declinedChannelInviteMessageIds.update((ids) => (ids.includes(msg.id) ? ids : [...ids, msg.id])); }}
                  />
                {:else if channelInNetworkPayload}
                  {@const inviterNpub = msg.mine ? $activeDmId : msg.npub}
                  {@const inviterProfile = inviterNpub ? $profiles[inviterNpub] : null}
                  {@const inviterName = msg.mine ? (getProfileDisplayName($profiles[$activeDmId]) || $activeDmId?.slice(0, 12) + '…') : (msg.npub ? (getProfileDisplayName($profiles[msg.npub]) || msg.npub.slice(0, 12) + '…') : 'Someone')}
                  {@const inviterAvatarSrc = inviterProfile ? getProfileAvatarSrc(inviterProfile) : null}
                  {@const channelInviteStatus = $acceptedChannelInviteMessageIds.includes(msg.id) ? 'accepted' : $declinedChannelInviteMessageIds.includes(msg.id) ? 'declined' : 'pending'}
                  <ChannelInNetworkCard
                    networkName={channelInNetworkPayload.networkName}
                    channelName={channelInNetworkPayload.channelName}
                    memberSquads={channelInNetworkPayload.memberSquads ?? []}
                    isMine={msg.mine}
                    inviterName={inviterName}
                    inviterAvatarSrc={inviterAvatarSrc}
                    status={channelInviteStatus}
                    accepting={acceptingChannelInNetworkId === msg.id}
                    onAccept={() => handleAcceptChannelInNetwork(msg, { networkId: channelInNetworkPayload.networkId, channelGroupId: channelInNetworkPayload.channelGroupId, channelName: channelInNetworkPayload.channelName })}
                    onDecline={() => { declinedChannelInviteMessageIds.update((ids) => (ids.includes(msg.id) ? ids : [...ids, msg.id])); }}
                  />
                {:else if networkInvitePayload}
                  {@const inviterNpub = msg.mine ? $activeDmId : msg.npub}
                  {@const inviterProfile = inviterNpub ? $profiles[inviterNpub] : null}
                  {@const inviterName = msg.mine ? (getProfileDisplayName($profiles[$activeDmId]) || $activeDmId?.slice(0, 12) + '…') : (msg.npub ? (getProfileDisplayName($profiles[msg.npub]) || msg.npub.slice(0, 12) + '…') : 'Someone')}
                  {@const inviterAvatarSrc = inviterProfile ? getProfileAvatarSrc(inviterProfile) : null}
                  {@const networkInviteStatus = $acceptedNetworkInviteIds.includes(msg.id) ? 'accepted' : $declinedNetworkInviteIds.includes(msg.id) ? 'declined' : 'pending'}
                  <NetworkInviteCard
                    networkName={networkInvitePayload.networkName}
                    memberSquads={networkInvitePayload.memberSquads}
                    isMine={msg.mine}
                    inviterName={inviterName}
                    inviterAvatarSrc={inviterAvatarSrc}
                    status={networkInviteStatus}
                    accepting={acceptingNetworkInviteId === msg.id}
                    onAccept={() => handleAcceptNetworkInvite(msg, networkInvitePayload)}
                    onDecline={() => { declinedNetworkInviteIds.update((ids) => (ids.includes(msg.id) ? ids : [...ids, msg.id])); }}
                  />
                {:else if invitePayload}
                  {@const inviterNpub = msg.mine ? $activeDmId : msg.npub}
                  {@const inviterProfile = inviterNpub ? $profiles[inviterNpub] : null}
                  {@const inviterName = msg.mine ? (getProfileDisplayName($profiles[$activeDmId]) || $activeDmId?.slice(0, 12) + '…') : (msg.npub ? (getProfileDisplayName($profiles[msg.npub]) || msg.npub.slice(0, 12) + '…') : 'Someone')}
                  {@const inviterAvatarSrc = inviterProfile ? getProfileAvatarSrc(inviterProfile) : null}
                  {@const inviteStatus = $acceptedSquadInviteIds.includes(msg.id) ? 'accepted' : $declinedSquadInviteIds.includes(msg.id) ? 'declined' : 'pending'}
                  <SquadInviteCard
                    squadName={invitePayload.squadName}
                    isMine={msg.mine}
                    inviterName={inviterName}
                    inviterAvatarSrc={inviterAvatarSrc}
                    status={inviteStatus}
                    accepting={acceptingSquadInviteId === msg.id}
                    onAccept={() => handleAcceptSquadInvite(msg, invitePayload.groupId)}
                    onDecline={() => { declinedSquadInviteIds.update((ids) => (ids.includes(msg.id) ? ids : [...ids, msg.id])); }}
                  />
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
      {:else if $activeTopNavTab === 'networks'}
        <div class="networks-area">
          <NetworkNavbar />
          <ChatView />
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

  .squads-area,
  .networks-area {
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
    background-color: var(--border-subtle);
  }

  .dm-thread-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 24px;
    border-bottom: 1px solid var(--bg-elevated);
  }

  .dm-thread-header-avatar {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    overflow: hidden;
    background-color: var(--bg-hover);
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
    background-color: var(--accent);
  }

  .dm-thread-header-info {
    min-width: 0;
  }

  .dm-thread-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dm-thread-npub {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .dm-thread-header-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .dm-thread-header-actions {
    position: relative;
    flex-shrink: 0;
  }

  .dm-thread-dropdown-trigger {
    padding: 4px 6px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    outline: none;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dm-thread-dropdown-trigger:hover {
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .dm-thread-chevron {
    width: 16px;
    height: 16px;
    display: block;
    filter: var(--icon-dropdown-filter);
  }

  .dm-thread-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    min-width: 140px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 50;
    padding: 4px 0;
  }

  .dm-thread-dropdown-item {
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

  .dm-thread-dropdown-item:hover {
    background: var(--bg-hover);
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
    color: var(--text-primary);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 4px;
    outline: none;
  }

  .dm-thread-nickname-input:focus {
    border-color: var(--accent);
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
    background: var(--accent);
    color: #fff;
  }

  .dm-thread-nickname-save:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .dm-thread-nickname-cancel {
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--border);
  }

  .dm-thread-nickname-cancel:hover:not(:disabled) {
    color: var(--text-primary);
  }

  .dm-thread-nickname-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .dm-thread-nickname-error {
    margin: 4px 0 0 0;
    font-size: 0.75rem;
    color: var(--danger);
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
    color: var(--text-secondary);
    background: var(--bg-hover);
    border: 1px solid var(--bg-elevated);
    border-radius: 4px;
    cursor: pointer;
    outline: none;
  }

  .load-older-btn:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--border);
  }

  .load-older-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .dm-thread-placeholder {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0;
  }

  .dm-thread-typing {
    font-size: 0.8125rem;
    color: var(--text-muted);
    margin: 0;
    padding: 4px 24px 8px;
    font-style: italic;
  }

  .dm-thread-error {
    font-size: 0.875rem;
    color: var(--danger);
    margin: 0;
    padding: 8px 24px;
    background-color: rgba(237, 66, 69, 0.1);
    border-top: 1px solid var(--bg-elevated);
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
    color: var(--text-secondary);
    background-color: var(--bg-elevated);
  }

  .dm-sync-finished {
    color: var(--text-muted);
    background-color: #24804620;
  }

  .dm-empty {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--border-subtle);
    color: var(--text-muted);
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
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    min-width: 280px;
    max-width: 90vw;
  }

  .add-to-squad-modal h2 {
    margin: 0 0 8px;
    font-size: 1.125rem;
    color: var(--text-primary);
  }

  .add-to-squad-modal-text {
    margin: 0 0 16px;
    font-size: 0.875rem;
    color: var(--text-muted);
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
    color: var(--text-secondary);
    background: var(--bg-hover);
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  .add-to-squad-modal-option:hover {
    background: var(--border);
  }

  .add-to-squad-modal-empty {
    margin: 0 0 16px;
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .add-to-squad-modal-skip {
    padding: 6px 14px;
    font-size: 0.875rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-muted);
    cursor: pointer;
  }

  .add-to-squad-modal-skip:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }
</style>
