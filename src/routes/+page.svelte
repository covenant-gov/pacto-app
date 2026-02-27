<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { listen } from '@tauri-apps/api/event';
  import Navbar from '../components/Navbar.svelte';
  import TopNavbar from '../components/TopNavbar.svelte';
  import ParentNavbar from '../components/ParentNavbar.svelte';
  import ChatView from '../components/ChatView.svelte';
  import Profile from '../components/Profile.svelte';
  import MessengerNavbar from '../components/MessengerNavbar.svelte';
  import MessengerChatView from '../components/MessengerChatView.svelte';
  import DmThread from '../components/DmThread.svelte';
  import Toast from '../components/Toast.svelte';
  import { getDmMessages, getChatMessageCount, sendDmMessage, queueProfileSync, fetchMessages, markAsRead, startTyping, setNickname, listPendingMlsWelcomes, acceptMlsWelcome, parseSquadInviteMessage, parseChannelInSquadMessage, parseChannelInNetworkMessage, parseNetworkInviteMessage, syncMlsGroupsNow, deleteDmChatBackend } from '../lib/api/nostr';
  import { getInvokeErrorMessage, friendlyMessage } from '../lib/utils/tauri-errors';
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
    pinnedList,
    lastOpenedDmByTab,
    lastOpenedSquadId,
    lastOpenedChannelId,
    lastChannelBySquadId,
    lastChannelByNetworkId,
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
    deleteDmChat,
    revertDmChat,
    type DmChatSnapshot,
    updateChannelNameIfPlaceholder,
    bumpMembershipVersion,
    ANNOUNCEMENTS_CHANNEL_NAME,
    type DmMessage,
    type DmTab,
    type Channel,
    type Network,
  } from '../stores/app';
  import { pendingReadyToast, showToast } from '../stores/toast';
  import { portal } from '../lib/utils/portal';

  const PAGE_SIZE = 100;

  // Show "X is ready!" toast from root so it appears regardless of active view (DMs / Squads / Networks)
  $: if ($pendingReadyToast) {
    showToast($pendingReadyToast.text, $pendingReadyToast.goTo);
    pendingReadyToast.set(null);
  }
  const LOAD_OLDER_PAGE_SIZE = 50;

  /** Group IDs we just accepted as squad invites — skip "Add to squad" modal for these. */
  let acceptedSquadInviteGroupIds = new Set<string>();

  /** When user accepts a channel invite (squad or network) we store mapping so mls_welcome_accepted can add channel to the right parent. */
  let channelInvitePendingAccept = new Map<
    string,
    { parentType: 'squad' | 'network'; parentId: string; channelName: string }
  >();

  /** Add a channel to a squad or network. parentId is the parent's id (announcements group id for both). */
  function addChannelToParent(
    parentType: 'squad' | 'network',
    parentId: string,
    channelGroupId: string,
    channelName: string
  ) {
    const newChannel: Channel = {
      name: channelName,
      groupId: channelGroupId,
      order: 0,
    };
    if (parentType === 'squad') {
      const list = get(squads);
      const squad = list.find((s) => s.id === parentId);
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

  const SQUAD_CHANNEL_DEBUG = false; // [SquadChannel] set true to trace squad channel persistence
  // Remember last opened squad/channel (so switching to Squads view restores it) and per-squad last channel.
  // Only write channel when it belongs to this squad (avoid overwriting with network channel when we've just switched to Squads and activeChannelId is still the network channel).
  $: if ($activeTopNavTab === 'squads' && $activeSquadId) {
    const sid = $activeSquadId;
    lastOpenedSquadId.set(sid);
    const cid = $activeChannelId;
    if (cid && !cid.startsWith('creating-')) {
      const squad = $squads.find((s) => s.id === sid);
      const cidBelongsToSquad = squad?.channels.some((c) => c.groupId === cid) ?? false;
      if (cidBelongsToSquad) {
        lastOpenedChannelId.set(cid);
        lastChannelBySquadId.update((m) => {
          const next = { ...m, [sid]: cid };
          if (SQUAD_CHANNEL_DEBUG) console.log('[SquadChannel] +page on-squads persist', { sid: sid.slice(0, 12), cid: cid.slice(0, 20) });
          return next;
        });
      } else if (SQUAD_CHANNEL_DEBUG) console.log('[SquadChannel] +page on-squads skip persist (cid not in squad)', { sid: sid.slice(0, 12), cid: cid.slice(0, 20) });
    }
  }

  // Persist last-opened network/channel and per-network last channel when user selects in Networks tab (only network stores).
  // Only write channel when it belongs to this network (avoid overwriting with squad channel when we've just switched to Networks and activeChannelId is still a squad channel).
  $: if ($activeTopNavTab === 'networks' && $activeNetworkId) {
    const nid = $activeNetworkId;
    lastOpenedNetworkId.set(nid);
    const networkCid = $activeChannelId;
    if (networkCid && !networkCid.startsWith('creating-')) {
      const net = $networks.find((n) => n.id === nid);
      const cidBelongsToNetwork = net?.channels.some((c) => c.groupId === networkCid) ?? false;
      if (cidBelongsToNetwork) {
        if (SQUAD_CHANNEL_DEBUG) console.log('[SquadChannel] +page on-networks persist (network only)', { nid: nid?.slice(0, 12), networkCid: networkCid?.slice(0, 20) });
        lastOpenedNetworkChannelId.set(networkCid);
        lastChannelByNetworkId.update((m) => ({ ...m, [nid]: networkCid }));
      }
    }
  }

  // Never leave channel empty when a squad is selected: restore last channel for this squad or default to first (announcements)
  $: if ($activeTopNavTab === 'squads' && $activeSquadId && $squads.length > 0) {
    const sid = $activeSquadId;
    const squad = $squads.find((s) => s.id === sid);
    if (squad) {
      const sorted = [...squad.channels].sort((a, b) => a.order - b.order);
      const firstCh = sorted[0];
      const lastForSquad = $lastChannelBySquadId[sid];
      const activeInSquad = $activeChannelId && sorted.some((c) => c.groupId === $activeChannelId);
      const lastInSquad = lastForSquad && sorted.some((c) => c.groupId === lastForSquad);
      const validChannel =
        activeInSquad ? $activeChannelId
          : lastInSquad ? lastForSquad
            : firstCh?.groupId ?? null;
      if (validChannel && $activeChannelId !== validChannel) {
        if (SQUAD_CHANNEL_DEBUG) console.log('[SquadChannel] +page never-empty correct', { sid: sid.slice(0, 12), from: $activeChannelId?.slice(0, 20), to: validChannel?.slice(0, 20), reason: activeInSquad ? 'active' : lastInSquad ? 'lastForSquad' : 'firstCh', lastForSquad: lastForSquad?.slice(0, 20) });
        activeChannelId.set(validChannel);
      }
    }
  }

  // Never leave channel empty when a network is selected: restore last channel for this network or default to first (announcements)
  $: if ($activeTopNavTab === 'networks' && $activeNetworkId && $networks.length > 0) {
    const nid = $activeNetworkId;
    const net = $networks.find((n) => n.id === nid);
    if (net) {
      const sorted = [...net.channels].sort((a, b) => a.order - b.order);
      const firstCh = sorted[0];
      const lastForNet = $lastChannelByNetworkId[nid];
      const validChannel =
        $activeChannelId && sorted.some((c) => c.groupId === $activeChannelId)
          ? $activeChannelId
          : (lastForNet && sorted.some((c) => c.groupId === lastForNet)
            ? lastForNet
            : firstCh?.groupId ?? null);
      if (validChannel && $activeChannelId !== validChannel) {
        activeChannelId.set(validChannel);
      }
    }
  }

  // Nickname edit for current DM contact
  let showNicknameEdit = false;
  let nicknameEditValue = '';
  let nicknameSaving = false;
  let nicknameError: string | null = null;

  // Clear send error when user switches to a different DM
  $: if (prevDmId !== $activeDmId) {
    prevDmId = $activeDmId;
    if (prevDmId != null) $dmSendError = null;
  }

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

  // Load group messages when opening a squad or network channel. Skip placeholder "creating-*" channels.
  $: if ($activeChannelId && !$activeChannelId.startsWith('creating-')) {
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

  async function acceptAnnouncementsInvite(
    type: 'squad' | 'network',
    payload: { groupId: string; name: string; memberSquads?: { id: string; name: string }[] },
    messageId: string
  ): Promise<void> {
    const welcomes = await listPendingMlsWelcomes();
    const welcome = welcomes.find((w) => w.nostr_group_id === payload.groupId);
    if (!welcome) {
      const err = new Error('No pending welcome') as Error & { noWelcome?: boolean };
      err.noWelcome = true;
      throw err;
    }
    acceptedSquadInviteGroupIds.add(payload.groupId);
    await acceptMlsWelcome(welcome.id);
    const now = Date.now();
    const announcementsChannel: Channel = {
      name: ANNOUNCEMENTS_CHANNEL_NAME,
      groupId: payload.groupId,
      order: 0,
    };
    if (type === 'squad') {
      const newSquad = {
        id: payload.groupId,
        name: payload.name,
        channels: [announcementsChannel],
        createdAt: now,
        updatedAt: now,
      };
      squads.update((list) => [...list, newSquad]);
      activeSquadId.set(newSquad.id);
      activeChannelId.set(payload.groupId);
      activeView.set('hub');
      acceptedSquadInviteIds.update((ids) => (ids.includes(messageId) ? ids : [...ids, messageId]));
    } else {
      const newNetwork: Network = {
        id: payload.groupId,
        name: payload.name,
        channels: [announcementsChannel],
        memberSquads: payload.memberSquads ?? [],
        createdAt: now,
        updatedAt: now,
      };
      networks.update((list) => [...list, newNetwork]);
      activeNetworkId.set(newNetwork.id);
      activeChannelId.set(payload.groupId);
      activeTopNavTab.set('networks');
      activeView.set('hub');
      acceptedNetworkInviteIds.update((ids) => (ids.includes(messageId) ? ids : [...ids, messageId]));
    }
  }

  async function handleAcceptSquadInvite(msg: DmMessage, groupId: string) {
    const payload = parseSquadInviteMessage(msg.content);
    if (!payload) return;
    if (acceptingSquadInviteId) return;
    acceptingSquadInviteId = msg.id;
    try {
      await acceptAnnouncementsInvite('squad', { groupId: payload.groupId, name: payload.squadName }, msg.id);
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
      await acceptAnnouncementsInvite('network', {
        groupId: payload.groupId,
        name: payload.networkName,
        memberSquads: payload.memberSquads,
      }, msg.id);
    } catch (e) {
      const err = e as Error & { noWelcome?: boolean };
      if (err?.noWelcome) {
        dmSendError.set('No pending invite for this network. The invite may have expired.');
      } else {
        dmError('Accept network invite failed', e);
        dmSendError.set(friendlyMessage(getInvokeErrorMessage(e)) || 'Failed to accept network invite.');
      }
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

  /** Ungrouped channels UI removed; keep store empty. */
  function clearUngroupedChannels() {
    ungroupedChannels.set([]);
  }

  let prevTopNavTab: string | undefined = undefined;
  $: if ($activeTopNavTab === 'squads' && prevTopNavTab !== 'squads') {
    prevTopNavTab = 'squads';
    syncMlsGroupsNow(null).catch(() => {});
    clearUngroupedChannels();
    // Restore last opened squad/channel: use per-squad last channel only (so Networks tab can't overwrite it), else first (announcements)
    const lastSquadId = $lastOpenedSquadId;
    const squad = lastSquadId ? $squads.find((s) => s.id === lastSquadId) : null;
    const mapSnapshot = { ...$lastChannelBySquadId };
    if (SQUAD_CHANNEL_DEBUG) console.log('[SquadChannel] +page restore-to-squads', { lastSquadId: lastSquadId?.slice(0, 12), squadId: squad?.id?.slice(0, 12), lastChannelBySquadId: mapSnapshot, lastForSquad: squad ? mapSnapshot[squad.id]?.slice(0, 20) : undefined });
    if (squad) {
      const sorted = [...squad.channels].sort((a, b) => a.order - b.order);
      const firstCh = sorted[0];
      const lastForSquad = $lastChannelBySquadId[squad.id];
      const lastValid = lastForSquad && sorted.some((c) => c.groupId === lastForSquad);
      const ch = lastValid ? sorted.find((c) => c.groupId === lastForSquad) : firstCh;
      const setChannelId = ch?.groupId ?? firstCh?.groupId ?? null;
      if (SQUAD_CHANNEL_DEBUG) console.log('[SquadChannel] +page restore-to-squads set', { squadId: squad.id.slice(0, 12), lastForSquad: lastForSquad?.slice(0, 20), lastValid, setChannelId: setChannelId?.slice(0, 20), firstChId: firstCh?.groupId?.slice(0, 20) });
      activeSquadId.set(squad.id);
      activeChannelId.set(setChannelId);
    } else if ($squads.length > 0 && !$activeSquadId) {
      const first = $squads[0];
      const sorted = [...first.channels].sort((a, b) => a.order - b.order);
      activeSquadId.set(first.id);
      activeChannelId.set(sorted[0]?.groupId ?? null);
    }
  } else if ($activeTopNavTab === 'networks' && prevTopNavTab !== 'networks') {
    prevTopNavTab = 'networks';
    // Restore last-opened network/channel: prefer per-network last channel, then global last, then first (announcements)
    const lastNetId = $lastOpenedNetworkId;
    const net = lastNetId ? $networks.find((n) => n.id === lastNetId) : null;
    if (net) {
      activeNetworkId.set(net.id);
      const sorted = [...net.channels].sort((a, b) => a.order - b.order);
      const firstCh = sorted[0];
      const lastChanId = $lastOpenedNetworkChannelId;
      const lastForNet = $lastChannelByNetworkId[net.id];
      const ch =
        lastChanId && sorted.some((c) => c.groupId === lastChanId)
          ? sorted.find((c) => c.groupId === lastChanId)
          : lastForNet && sorted.some((c) => c.groupId === lastForNet)
            ? sorted.find((c) => c.groupId === lastForNet)
            : firstCh;
      activeChannelId.set(ch?.groupId ?? firstCh?.groupId ?? null);
    } else if ($networks.length > 0) {
      const currentNet = $activeNetworkId ? $networks.find((n) => n.id === $activeNetworkId) : null;
      if (!currentNet) {
        const first = $networks[0];
        const firstCh = first.channels.slice().sort((a, b) => a.order - b.order)[0];
        activeNetworkId.set(first.id);
        activeChannelId.set(firstCh?.groupId ?? null);
      }
    }
  } else if ($activeTopNavTab !== 'squads') {
    // Persist squad channel when leaving Squads tab so it restores correctly when returning
    if (prevTopNavTab === 'squads' && $activeSquadId) {
      const sid = $activeSquadId;
      const cid = $activeChannelId;
      if (SQUAD_CHANNEL_DEBUG) console.log('[SquadChannel] +page leave-squads reactive', { prevTopNavTab, activeTopNavTab: $activeTopNavTab, sid: sid?.slice(0, 12), cid: cid?.slice(0, 20) });
      if (cid && !cid.startsWith('creating-')) {
        lastOpenedSquadId.set(sid);
        lastOpenedChannelId.set(cid);
        lastChannelBySquadId.update((m) => ({ ...m, [sid]: cid }));
      }
    }
    // Persist network channel when leaving Networks tab so it restores correctly when returning
    if (prevTopNavTab === 'networks' && $activeNetworkId) {
      const nid = $activeNetworkId;
      const cid = $activeChannelId;
      if (cid && !cid.startsWith('creating-')) {
        lastOpenedNetworkId.set(nid);
        lastOpenedNetworkChannelId.set(cid);
        lastChannelByNetworkId.update((m) => ({ ...m, [nid]: cid }));
      }
    }
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

    const unlistenMlsNew = listen<{ group_id: string; message: DmMessage; group_name?: string }>('mls_message_new', (event) => {
      const { group_id, message, group_name } = event.payload;
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
      if (group_name) updateChannelNameIfPlaceholder(group_id, group_name);
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
        const newChannel: Channel = { name, groupId: group_id, order: squad.channels.length };
        squads.update((l) =>
          l.map((s) => (s.id !== squad.id ? s : { ...s, channels: [...s.channels, newChannel] }))
        );
        return;
      }
      // Unattributed MLS welcome: do not add to app (potential attack vector).
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
      announcements_group_id?: string;
      network_id: string;
      channel_group_id: string;
      channel_name: string;
    }>('channel_added_to_network', (event) => {
      const { announcements_group_id, network_id, channel_group_id, channel_name } = event.payload;
      const parentId = announcements_group_id ?? network_id;
      refreshPendingWelcomes().catch((e) => dmError('channel_added_to_network refresh', e));
      addChannelToParent('network', parentId, channel_group_id, channel_name);
    });

    const unlistenGroupUpdated = listen<{ group_id?: string }>('mls_group_updated', (event) => {
      const gid = event.payload?.group_id;
      if (gid) bumpMembershipVersion(gid);
    });
    const unlistenGroupLeft = listen<{ group_id?: string }>('mls_group_left', (event) => {
      const gid = event.payload?.group_id;
      if (gid) bumpMembershipVersion(gid);
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
      unlistenGroupUpdated.then((fn) => fn());
      unlistenGroupLeft.then((fn) => fn());
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
              <DmThread
                npub={$activeDmId}
                messages={mergedDmMessages}
                canLoadOlder={!!canLoadOlder}
                loadingOlder={loadingOlder}
                onLoadOlder={loadOlder}
                onSend={handleDmSend}
                onTyping={handleDmTyping}
                onAcceptSquadInvite={handleAcceptSquadInvite}
                onAcceptChannelInSquad={handleAcceptChannelInSquad}
                onAcceptChannelInNetwork={handleAcceptChannelInNetwork}
                onAcceptNetworkInvite={handleAcceptNetworkInvite}
                onDeclineSquad={(msg) => declinedSquadInviteIds.update((ids) => (ids.includes(msg.id) ? ids : [...ids, msg.id]))}
                onDeclineNetwork={(msg) => declinedNetworkInviteIds.update((ids) => (ids.includes(msg.id) ? ids : [...ids, msg.id]))}
                onDeclineChannelInSquad={(msg) => declinedChannelInviteMessageIds.update((ids) => (ids.includes(msg.id) ? ids : [...ids, msg.id]))}
                onDeclineChannelInNetwork={(msg) => declinedChannelInviteMessageIds.update((ids) => (ids.includes(msg.id) ? ids : [...ids, msg.id]))}
                acceptingSquadInviteId={acceptingSquadInviteId}
                acceptingChannelInSquadId={acceptingChannelInSquadId}
                acceptingChannelInNetworkId={acceptingChannelInNetworkId}
                acceptingNetworkInviteId={acceptingNetworkInviteId}
                showOptionsMenu={true}
                showPinOption={$activeDmTab !== 'requests' && $activeDmTab !== 'pending'}
                onSaveNickname={async (value) => {
                  const id = $activeDmId;
                  if (!id) return;
                  try {
                    await setNickname(id, value);
                  } catch (e) {
                    throw new Error(getInvokeErrorMessage(e, 'Failed to set nickname'));
                  }
                }}
                onDeleteChat={() => {
                  const id = $activeDmId;
                  if (!id) return;
                  const snapshot: DmChatSnapshot = {
                    chatState: $dmChatsByNpub[id],
                    messages: $backendDmMessages[id] ?? [],
                    messageCount: $messageCountByChat[id],
                    loadedOffset: $loadedOffsetByChat[id],
                    wasPinned: $pinnedDmNpubs.has(id),
                  };
                  deleteDmChat(id);
                  deleteDmChatBackend(id).catch(() => {
                    revertDmChat(id, snapshot);
                    showToast('Could not delete chat. Please try again.');
                  });
                }}
              />
            {:else}
              <div class="dm-empty">
                <p>Select a conversation or start a new chat</p>
              </div>
            {/if}
            </div>
          </div>
        </div>
      {:else}
        <div class="parent-area">
          <ParentNavbar type={$activeTopNavTab === 'networks' ? 'network' : 'squad'} />
          <ChatView />
        </div>
      {/if}
    </div>
  </main>
  <div class="toast-portal-wrapper" use:portal>
    <Toast />
  </div>
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

  .parent-area,
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
    padding: 0 16px 0 16px;
  }

  .dm-main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
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

  /* Portal wrapper must not block hover on the rest of the app (Navbar tabs, etc.) */
  :global(.toast-portal-wrapper) {
    pointer-events: none;
  }
</style>
