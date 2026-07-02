<script lang="ts">
  import { onMount } from 'svelte';
  import type { Component } from 'svelte';
  import { get } from 'svelte/store';
  import Navbar from '../components/layout/Navbar.svelte';
  import TopNavbar from '../components/layout/TopNavbar.svelte';
  import CommonsView from '../components/commons/CommonsView.svelte';
  import PersonalBroadcastModal from '../components/commons/PersonalBroadcastModal.svelte';
  import ParentNavbar from '../components/layout/ParentNavbar.svelte';
  import ParentDashboard from '../components/parent/ParentDashboard.svelte';
  import Profile from '../components/profile/Profile.svelte';
  import MessengerNavbar from '../components/dm/MessengerNavbar.svelte';
  import MessengerChatView from '../components/dm/MessengerChatView.svelte';
  import DmThread from '../components/dm/DmThread.svelte';
  import WalletBar from '../components/wallet/WalletBar.svelte';
  import ResizableSidebar from '../components/ui/ResizableSidebar.svelte';
  import Toast from '../components/ui/Toast.svelte';
  import { createLazyComponent } from '../lib/ui/lazy-svelte-component';
  import {
    getDmMessages,
    getChatMessageCount,
    sendDmMessage,
    queueProfileSync,
    fetchMessages,
    markAsRead,
    startTyping,
    setNickname,
    syncMlsGroupsNow,
    deleteDmChatBackend,
    addParentTreasurySafe,
  } from '../lib/api/nostr';
  import { buildAnnounceContent, ANNOUNCE_TYPE_SAFE_UPDATED, ANNOUNCE_TYPE_GOVERNANCE_UPDATED } from '../lib/announcements';
  import { getExplorerTxUrl } from '../lib/wallet/assets';
  import { resumePendingWalletTxConfirmations } from '../lib/wallet/wallet-dm-transfer';
  import { getAddress } from 'viem';
  import {
    formatWalletPeerInfoGrant,
    formatWalletPeerInfoDecline,
    type WalletPeerInfoRequestPayload,
  } from '../lib/wallet/dm-messages';
  import { getEvmAddress } from '../lib/api/auth';
  import { setDmPeerEvmAddress } from '../lib/api/wallet-peers';
  import { scheduleWalletSummaryBackgroundPrefetch } from '../lib/wallet/wallet-summary-prefetch';
  import { getActiveEvmSignerAddress } from '../lib/wallet/evm-accounts';
  import { getInvokeErrorMessage, friendlyMessage } from '../lib/utils/tauri-errors';
  import { parseWalletTxRequest } from '../lib/wallet/dm-messages';
  import { dmLog, dmError } from '../lib/utils/dm-debug';
  import {
    isPactoAppThreadId,
    filterPeerThreadMessages,
  } from '../lib/pacto-app-inbox';
  import { isAuthenticated, currentUser } from '../stores/auth';
  import { profiles } from '../stores/profiles';
  import {
    squads,
    activeSquadId,
    activeChannelId,
    activeHubChannelName,
    activeView,
    activeTopNavTab,
    activeDmTab,
    activeDmId,
    composingNewChat,
    walletSidebarOpen,
    backendDmMessages,
    dmThreadAnnouncementsByNpub,
    appendPendingOutboundDmMessage,
    removeOutboundDmMessage,
    pactoAppInboxMessages,
    reconcilePeerThreadInvites,
    backendGroupMessages,
    ungroupedChannels,
    messageCountByChat,
    loadedOffsetByChat,
    dmSyncStatus,
    dmList,
    requestsList,
    pendingList,
    pinnedList,
    allDmEntriesUnified,
    dmSidebarCategoryForNpub,
    lastOpenedDmByTab,
    lastOpenedSquadId,
    lastOpenedChannelId,
    lastChannelBySquadId,
    lastHubChannelNameBySquadId,
    declinedSquadInviteIds,
    declinedChannelInviteMessageIds,
    dmChatsByNpub,
    pinnedDmNpubs,
    blockedDmNpubs,
    dmSendError,
    deleteDmChat,
    revertDmChat,
    type DmChatSnapshot,
    DASHBOARD_CHANNEL_ID,
    treasurySafesByParentId,
    squadInfraByParentId,
    type TreasurySafeEntry,
    type SquadInfraDto,
    type DmMessage,
    type DmTab,
    type DmEntry,
    type Channel,
    type Squad,
    acceptedWalletPeerInfoRequestMessageIds,
    declinedWalletPeerInfoRequestMessageIds,
    dmWalletPeerExchangeTick,
  } from '../stores/app';
  import {
    clearDmUnread,
    clearPactoAppInboxUnread,
    syncUnreadCountForNpub,
  } from '../stores/dm-unread';
  import { pendingReadyToast, showToast } from '../stores/toast';
  import {
    closeCommonsBroadcastModal,
    commonsBroadcastModalOpen,
    commonsUserHasActiveBroadcast,
  } from '../stores/commons-ui';
  import {
    listSquadInfra,
    upsertSquadInfra,
    pactoGovInfraId,
    squadSponsorInfraId,
    buildSponsorGovernanceAnnouncePayload,
    buildPactoGovGovernanceAnnouncePayload,
    buildStandaloneSafeGovernanceAnnouncePayload,
    buildSquadAdminGovernanceAnnouncePayload,
    squadAdminInfraId,
    pactoGovTreasuryEntryId,
    primaryGovernanceView,
  } from '../lib/governance/api';
  import {
    buildStandaloneSafeProviderPayload,
    isPactoGovTreasurySafe,
    pactoGovPayloadFromInfra,
  } from '../lib/governance/standalone-safe-payload';
  import { resolveAutomatedAnnounceGroupId } from '../lib/parent-navbar';
  import { resolveHubChannelNameForGroupSelection } from '../lib/mls/virtual-channel-bucket';
  import { resolveOpenHubParent, syncSquadsHubSelection, resolveEffectiveHubChannel } from '../lib/squad-hub-nav';
  import { portal } from '../lib/utils/portal';
  import { subscribeAppEvents } from '../lib/app/tauri-subscriptions';
  import {
    scheduleAllSquadsHubWarmup,
    scheduleHubParentPrefetch,
  } from '../lib/app/hub-prefetch';
  import { scheduleDashboardPrefetch } from '../lib/app/dashboard-prefetch';
  import {
    syncSquadInfraForParent as mergeSquadInfraForParent,
    syncTreasurySafesForParent as mergeTreasurySafesForParent,
  } from '../lib/dashboard/dashboard-data-sync';
  import {
    acceptSquadOrPairInvite,
    acceptChannelInSquadInvite,
    acceptingSquadInviteId,
    acceptingChannelInSquadId,
  } from '../lib/invites/accept-invite';

  const loadChatView = createLazyComponent(() => import('../components/channel/ChatView.svelte'));

  let ChatViewComponent: Component | null = null;
  let chatViewLoadToken = 0;

  $: openHubParent = resolveOpenHubParent($squads, $activeSquadId);
  $: effectiveHubChannel = resolveEffectiveHubChannel(
    openHubParent,
    $activeChannelId,
    $lastChannelBySquadId,
    $lastHubChannelNameBySquadId,
  );

  $: showParentDashboard =
    openHubParent != null &&
    (!effectiveHubChannel.channelId || effectiveHubChannel.channelId === DASHBOARD_CHANNEL_ID);
  $: showMlsChatView =
    openHubParent != null &&
    !!effectiveHubChannel.channelId &&
    effectiveHubChannel.channelId !== DASHBOARD_CHANNEL_ID;

  $: if ($activeTopNavTab === 'squads' && $squads.length > 0) {
    syncSquadsHubSelection();
  }

  $: if (
    $activeTopNavTab === 'squads' &&
    openHubParent &&
    effectiveHubChannel.channelId &&
    ($activeChannelId !== effectiveHubChannel.channelId ||
      $activeHubChannelName !== effectiveHubChannel.hubChannelName)
  ) {
    activeChannelId.set(effectiveHubChannel.channelId);
    activeHubChannelName.set(effectiveHubChannel.hubChannelName);
  }

  $: if (showMlsChatView) {
    const token = ++chatViewLoadToken;
    void loadChatView().then((component) => {
      if (token === chatViewLoadToken) ChatViewComponent = component;
    });
  }

  const PAGE_SIZE = 100;

  // Show "X is ready!" toast from root so it appears regardless of active view (DMs / Squads)
  $: if ($pendingReadyToast) {
    showToast($pendingReadyToast.text, $pendingReadyToast.goTo);
    pendingReadyToast.set(null);
  }

  $: if (
    $commonsBroadcastModalOpen &&
    ($activeTopNavTab !== 'commons' ||
      $activeView === 'profile' ||
      $commonsUserHasActiveBroadcast)
  ) {
    closeCommonsBroadcastModal();
  }

  /** When true, the DM wallet panel is not shown (other top nav, DM tab, or new chat), but open state stays until the user closes it. */
  $: walletSidebarInvalidContext =
    $activeTopNavTab !== 'dms' ||
    $activeView !== 'hub' ||
    ($activeDmTab !== 'friends' && $activeDmTab !== 'pinned') ||
    $composingNewChat ||
    isPactoAppThreadId($activeDmId);

  $: dmWalletSidebarVisible =
    $walletSidebarOpen && !!$activeDmId && !walletSidebarInvalidContext;

  /** Pin control: hidden on Requests/Pending tabs; on Search tab only for Friends/Pinned conversations. */
  $: showDmPinOption = (() => {
    const tab = $activeDmTab;
    if (tab === 'requests' || tab === 'pending') return false;
    if (tab === 'search') {
      const id = $activeDmId;
      if (!id) return false;
      const cat = dmSidebarCategoryForNpub(id, $dmChatsByNpub, $pinnedDmNpubs);
      return cat === 'friends' || cat === 'pinned';
    }
    return true;
  })();

  const LOAD_OLDER_PAGE_SIZE = 50;

  function governanceCanonicalSafeRef(rawAddress: string): string {
    try {
      return getAddress(rawAddress.trim() as `0x${string}`);
    } catch {
      return rawAddress.trim();
    }
  }

  /** Persist a standalone vault Safe infra row (one row per treasury entry; skips pacto-gov treasury). */
  async function syncGovernanceAfterTreasurySafe(
    p: Squad,
    params: {
      safeAddress: string;
      chain: string;
      entryId: string;
      label?: string;
      txHash?: string;
    },
  ) {
    if (params.entryId === pactoGovTreasuryEntryId(p.id)) {
      return;
    }

    const rows = await listSquadInfra(p.id);
    const pactoPayload = pactoGovPayloadFromInfra(rows);
    const canonicalRef = governanceCanonicalSafeRef(params.safeAddress);
    if (isPactoGovTreasurySafe(canonicalRef, pactoPayload)) {
      return;
    }

    const providerPayload = buildStandaloneSafeProviderPayload({
      treasuryEntryId: params.entryId,
      safeAddress: canonicalRef,
      label: params.label,
      txHash: params.txHash,
    });
    await upsertSquadInfra({
      id: params.entryId,
      parentId: p.id,
      infraType: 'standalone_safe',
      chain: params.chain,
      canonicalRef,
      providerPayload,
    });
    const gid = resolveAutomatedAnnounceGroupId(p);
    if (gid) {
      await sendDmMessage(
        gid,
        buildAnnounceContent({
          type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
          payload: buildStandaloneSafeGovernanceAnnouncePayload({
            parentId: p.id,
            safeAddress: canonicalRef,
            chain: params.chain,
            providerPayload,
            entryId: params.entryId,
          }),
        }),
        '',
        { virtualBucket: 'inbox' },
      );
    }
  }

  async function finalizePactoGovDeploy(params: {
    parentId: string;
    announcementsGroupId: string;
    chain: string;
    topHatId: string;
    providerPayload: string;
    safeAddress: string;
    txHash: string;
  }) {
    const entryId = pactoGovInfraId(params.parentId);
    await upsertSquadInfra({
      id: entryId,
      parentId: params.parentId,
      infraType: 'pacto_gov',
      chain: params.chain,
      canonicalRef: params.topHatId,
      providerPayload: params.providerPayload,
    });
    const row = get(squads).find((s: Squad) => s.id === params.parentId);
    const gid =
      (row ? resolveAutomatedAnnounceGroupId(row) : null) ?? params.announcementsGroupId.trim();

    const safeCanonical = governanceCanonicalSafeRef(params.safeAddress);
    const treasuryEntryId = pactoGovTreasuryEntryId(params.parentId);
    await addParentTreasurySafe(params.parentId, safeCanonical, {
      chain: params.chain,
      label: '',
      entryId: treasuryEntryId,
    });

    if (gid) {
      const chainKey = parseSupportedChainId(params.chain);
      const txHex = params.txHash?.trim();
      const explorerTxUrl = txHex && txHex.length > 0 ? getExplorerTxUrl(chainKey, txHex) : null;
      await sendDmMessage(
        gid,
        buildAnnounceContent({
          type: ANNOUNCE_TYPE_SAFE_UPDATED,
          payload: {
            squad_id: params.parentId,
            safe_address: safeCanonical,
            chain: params.chain,
            entry_id: treasuryEntryId,
            tx_hash: txHex || undefined,
            explorer_tx_url: explorerTxUrl ?? undefined,
          },
        }),
        '',
        { virtualBucket: 'inbox' },
      );
      await sendDmMessage(
        gid,
        buildAnnounceContent({
          type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
          payload: buildPactoGovGovernanceAnnouncePayload({
            parentId: params.parentId,
            topHatId: params.topHatId,
            chain: params.chain,
            providerPayload: params.providerPayload,
            entryId,
          }),
        }),
        '',
        { virtualBucket: 'inbox' },
      );
    }
    await mergeTreasurySafesForParent(params.parentId);
    await mergeSquadInfraForParent(params.parentId);
  }

  async function finalizeSponsorDeploy(params: {
    parentId: string;
    announcementsGroupId: string;
    chain: string;
    sponsorAddress: string;
    providerPayload: string;
    infraRowId: string;
  }) {
    await upsertSquadInfra({
      id: params.infraRowId || squadSponsorInfraId(params.parentId),
      parentId: params.parentId,
      infraType: 'sponsor',
      chain: params.chain,
      canonicalRef: params.sponsorAddress,
      providerPayload: params.providerPayload,
    });
    const row = get(squads).find((s: Squad) => s.id === params.parentId);
    const gid =
      (row ? resolveAutomatedAnnounceGroupId(row) : null) ?? params.announcementsGroupId.trim();
    const entryId = params.infraRowId || squadSponsorInfraId(params.parentId);
    if (gid) {
      await sendDmMessage(
        gid,
        buildAnnounceContent({
          type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
          payload: buildSponsorGovernanceAnnouncePayload({
            parentId: params.parentId,
            sponsorAddress: params.sponsorAddress,
            chain: params.chain,
            providerPayload: params.providerPayload,
            entryId,
          }),
        }),
        '',
        { virtualBucket: 'announcements' },
      );
    }
    await mergeSquadInfraForParent(params.parentId);
  }

  async function finalizeSquadAdminDeploy(params: {
    parentId: string;
    announcementsGroupId: string;
    chain: string;
    squadAdminProxy: string;
    providerPayload: string;
    infraRowId: string;
  }) {
    const entryId = params.infraRowId || squadAdminInfraId(params.parentId);
    await upsertSquadInfra({
      id: entryId,
      parentId: params.parentId,
      infraType: 'squad_admin',
      chain: params.chain,
      canonicalRef: params.squadAdminProxy,
      providerPayload: params.providerPayload,
    });
    const row = get(squads).find((s: Squad) => s.id === params.parentId);
    const gid =
      (row ? resolveAutomatedAnnounceGroupId(row) : null) ?? params.announcementsGroupId.trim();
    if (gid) {
      await sendDmMessage(
        gid,
        buildAnnounceContent({
          type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
          payload: buildSquadAdminGovernanceAnnouncePayload({
            parentId: params.parentId,
            squadAdminProxy: params.squadAdminProxy,
            chain: params.chain,
            providerPayload: params.providerPayload,
            entryId,
          }),
        }),
        '',
        { virtualBucket: 'inbox' },
      );
    }
    await mergeSquadInfraForParent(params.parentId);
  }

  $: dashboardParentId =
    effectiveHubChannel.channelId === DASHBOARD_CHANNEL_ID ? openHubParent?.id ?? null : null;
  $: if ($activeTopNavTab === 'squads' && openHubParent) {
    scheduleHubParentPrefetch(openHubParent);
  }
  $: if (dashboardParentId && openHubParent) {
    scheduleDashboardPrefetch(openHubParent);
  }
  $: if ($isAuthenticated && $currentUser && $squads.length > 0) {
    scheduleAllSquadsHubWarmup($squads);
  }

  /** After login, refresh embedded wallet balances in the background (cache only; no DM open). */
  let walletSummaryPrefetchKey: string | null = null;
  $: {
    const npub = $isAuthenticated && $currentUser ? $currentUser.npub : null;
    if (!npub) {
      walletSummaryPrefetchKey = null;
    } else if (walletSummaryPrefetchKey !== npub) {
      walletSummaryPrefetchKey = npub;
      scheduleWalletSummaryBackgroundPrefetch(npub);
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
              : tab === 'search'
                ? $allDmEntriesUnified
                : $pinnedList;
      const lastOpened = $lastOpenedDmByTab[tab];
      const stillInList = lastOpened && list.some((e: DmEntry) => e.npub === lastOpened);
      const npub = stillInList ? lastOpened : list[0]?.npub ?? null;
      activeDmId.set(npub);
    }
  }

  // Remember which chat was last opened per tab (so tab switch restores it)
  $: if ($activeTopNavTab === 'dms' && $activeDmId) {
    lastOpenedDmByTab.update((byTab: Record<DmTab, string | null>) => ({
      ...byTab,
      [$activeDmTab]: $activeDmId,
    }));
  }

  // Highlight the tab that matches the open thread (e.g. Pending → Friends when they reply). Skip Search so the unified list stays active.
  // While viewing a locally blocked peer, do not auto-switch tabs (conversation can be hidden from the list but stay open).
  $: if (
    $activeTopNavTab === 'dms' &&
    $activeDmId &&
    $activeDmTab !== 'search' &&
    !$blockedDmNpubs.has($activeDmId)
  ) {
    const desiredTab = dmSidebarCategoryForNpub($activeDmId, $dmChatsByNpub, $pinnedDmNpubs) as DmTab;
    if ($activeDmTab !== desiredTab) {
      lastOpenedDmByTab.update((byTab: Record<DmTab, string | null>) => ({
        ...byTab,
        [desiredTab]: $activeDmId,
      }));
      activeDmTab.set(desiredTab);
    }
  }

  const SQUAD_CHANNEL_DEBUG = false; // [SquadChannel] set true to trace squad channel persistence
  // Remember last opened squad/channel (so switching to Squads view restores it) and per-squad last channel.
  $: if ($activeTopNavTab === 'squads' && $activeSquadId) {
    const sid = $activeSquadId;
    lastOpenedSquadId.set(sid);
    const cid = $activeChannelId;
    if (cid && !cid.startsWith('creating-')) {
      const squad = $squads.find((s: Squad) => s.id === sid);
      const cidBelongsToSquad =
        cid === DASHBOARD_CHANNEL_ID ||
        (squad?.channels.some((c: Channel) => c.groupId === cid) ?? false);
      if (cidBelongsToSquad && squad) {
        lastOpenedChannelId.set(cid);
        lastChannelBySquadId.update((m: Record<string, string>) => {
          const next = { ...m, [sid]: cid };
          if (SQUAD_CHANNEL_DEBUG) console.log('[SquadChannel] +page on-squads persist', { sid: sid.slice(0, 12), cid: cid.slice(0, 20) });
          return next;
        });
        const hub =
          resolveHubChannelNameForGroupSelection(squad.channels, cid, $activeHubChannelName) ?? '';
        lastHubChannelNameBySquadId.update((m) => {
          const next = { ...m };
          if (!hub) delete next[sid];
          else next[sid] = hub;
          return next;
        });
      } else if (SQUAD_CHANNEL_DEBUG) console.log('[SquadChannel] +page on-squads skip persist (cid not in squad)', { sid: sid.slice(0, 12), cid: cid.slice(0, 20) });
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
    const id = $activeDmId;
    if (!id) return [];
    if (isPactoAppThreadId(id)) {
      return [...$pactoAppInboxMessages].sort((a: DmMessage, b: DmMessage) => a.at - b.at);
    }
    const backend = filterPeerThreadMessages([...($backendDmMessages[id] ?? [])]);
    const announcements = [...($dmThreadAnnouncementsByNpub[id] ?? [])];
    const list = [...backend, ...announcements];
    list.sort((a: DmMessage, b: DmMessage) => a.at - b.at);
    return list;
  })();

  $: if ($activeTopNavTab === 'dms' && $activeDmId && $currentUser?.npub && !isPactoAppThreadId($activeDmId)) {
    resumePendingWalletTxConfirmations($activeDmId, mergedDmMessages, {
      fromNpub: $currentUser.npub,
      sendDm: handleDmSend,
    });
  }

  function handleMarkReadUpTo(messageId: string) {
    const id = get(activeDmId);
    if (!id || !messageId) return;
    if (isPactoAppThreadId(id)) {
      clearPactoAppInboxUnread(messageId);
      return;
    }
    clearDmUnread(id, messageId);
    markAsRead(id, messageId).catch(() => {});
  }

  // Load backend messages when active DM changes; queue profile sync, get total count.
  $: if ($activeDmId && $activeTopNavTab === 'dms' && !isPactoAppThreadId($activeDmId)) {
    const npub = $activeDmId;
    dmLog('open conversation', { npub: npub.slice(0, 20) + '…', tab: 'dms' });
    queueProfileSync(npub).catch(() => {});
    getChatMessageCount(npub)
      .then((count) => {
        messageCountByChat.update((byChat: Record<string, number>) => ({ ...byChat, [npub]: count }));
      })
      .catch((err) => {
        dmError('open conversation: getChatMessageCount failed', err);
      });
    getDmMessages(npub, PAGE_SIZE, 0)
      .then((msgs) => {
        dmLog('open conversation: messages loaded', { npub: npub.slice(0, 20) + '…', count: msgs.length });
        const loaded = filterPeerThreadMessages(msgs as DmMessage[]);
        backendDmMessages.update((byNpub: Record<string, DmMessage[]>) => {
          const existing = byNpub[npub] ?? [];
          const loadedIds = new Set(loaded.map((m) => m.id));
          // Keep messages from state that aren't in the loaded set (e.g. just-sent from message_new)
          const fromExisting = existing.filter((m) => !loadedIds.has(m.id));
          const merged = [...loaded, ...fromExisting];
          return { ...byNpub, [npub]: merged };
        });
        reconcilePeerThreadInvites();
        loadedOffsetByChat.update((by: Record<string, number>) => ({ ...by, [npub]: PAGE_SIZE }));
        const merged = filterPeerThreadMessages(get(backendDmMessages)[npub] ?? loaded);
        syncUnreadCountForNpub(npub, merged);
      })
      .catch((err) => {
        dmError('open conversation: getDmMessages failed', err);
      });
  }

  // Load group messages when opening a squad channel. Skip placeholder "creating-*" and the
  // virtual #dashboard view (not an MLS group).
  // Only when Squads is active: `activeChannelId` persists when switching to DMs — do not call DM/group APIs from DMs tab.
  $: if (
    $activeChannelId &&
    $activeChannelId !== DASHBOARD_CHANNEL_ID &&
    !$activeChannelId.startsWith('creating-') &&
    $activeTopNavTab === 'squads'
  ) {
    const groupId = $activeChannelId;
    dmLog('open channel', { groupId: groupId.slice(0, 20) + '…' });
    getChatMessageCount(groupId)
      .then((count) => {
        messageCountByChat.update((by: Record<string, number>) => ({ ...by, [groupId]: count }));
      })
      .catch((err) => dmError('open channel: getChatMessageCount failed', err));
    getDmMessages(groupId, PAGE_SIZE, 0)
      .then((msgs) => {
        dmLog('open channel: messages loaded', { groupId: groupId.slice(0, 20) + '…', count: msgs.length });
        backendGroupMessages.update((byGroup: Record<string, DmMessage[]>) => ({
          ...byGroup,
          [groupId]: msgs as DmMessage[],
        }));
        loadedOffsetByChat.update((by: Record<string, number>) => ({ ...by, [groupId]: PAGE_SIZE }));
      })
      .catch((err) => dmError('open channel: getDmMessages failed', err));
  }

  async function loadOlder() {
    const npub = $activeDmId;
    if (!npub || loadingOlder || isPactoAppThreadId(npub)) return;
    const currentOffset = $loadedOffsetByChat[npub] ?? PAGE_SIZE;
    loadingOlder = true;
    dmLog('loadOlder', { npub: npub.slice(0, 20) + '…', offset: currentOffset });
    try {
      const older = await getDmMessages(npub, LOAD_OLDER_PAGE_SIZE, currentOffset);
      backendDmMessages.update((byNpub: Record<string, DmMessage[]>) => {
        const list = byNpub[npub] ?? [];
        const ids = new Set(list.map((m) => m.id));
        const newMsgs = filterPeerThreadMessages(older as DmMessage[]).filter((m) => !ids.has(m.id));
        if (newMsgs.length === 0) return byNpub;
        dmLog('loadOlder: prepending', { count: newMsgs.length });
        return { ...byNpub, [npub]: [...newMsgs, ...list] };
      });
      loadedOffsetByChat.update((by: Record<string, number>) => ({
        ...by,
        [npub]: currentOffset + LOAD_OLDER_PAGE_SIZE,
      }));
    } catch (err) {
      dmError('loadOlder failed', err);
    } finally {
      loadingOlder = false;
    }
  }

  $: canLoadOlder =
    $activeDmId &&
    !isPactoAppThreadId($activeDmId) &&
    !loadingOlder &&
    (($messageCountByChat[$activeDmId] ?? 0) > ($backendDmMessages[$activeDmId]?.length ?? 0));

  // Squad/channel invite cards: accepted/declined are persisted in app store; accepting is transient
  let acceptingWalletPeerInfoRequestId: string | null = null;

  async function handleAcceptWalletPeerInfoRequest(
    msg: DmMessage,
    payload: WalletPeerInfoRequestPayload
  ) {
    const peerNpub = $activeDmId;
    if (!peerNpub) return;
    if (payload.requester_npub !== peerNpub) {
      showToast('This request does not match this conversation.');
      return;
    }
    if (acceptingWalletPeerInfoRequestId) return;
    acceptingWalletPeerInfoRequestId = msg.id;
    try {
      // Request includes the other party's address; accepting saves it here immediately so this side can pay
      // them without a second request. WalletBar only refreshes when this tick runs.
      await setDmPeerEvmAddress(peerNpub, payload.requester_evm_address);
      dmWalletPeerExchangeTick.update((t: number) => t + 1);

      const myAddr =
        (await getActiveEvmSignerAddress())?.trim() || (await getEvmAddress())?.trim() || '';
      if (!myAddr) {
        showToast(
          'Their address is saved. Add or select a wallet, then tap Accept again to send yours.'
        );
        return;
      }
      const me = get(currentUser)?.npub;
      if (!me) return;
      const grantJson = formatWalletPeerInfoGrant({
        request_id: payload.request_id,
        grantor_npub: me,
        evm_address: myAddr.trim(),
      });
      const ok = await handleDmSend(grantJson);
      if (!ok) {
        showToast(
          'Could not send your address. Theirs is saved on this device; tap Accept to try again.'
        );
        return;
      }
      acceptedWalletPeerInfoRequestMessageIds.update((ids: string[]) =>
        ids.includes(msg.id) ? ids : [...ids, msg.id]
      );
      declinedWalletPeerInfoRequestMessageIds.update((ids: string[]) =>
        ids.filter((id) => id !== msg.id)
      );
      dmWalletPeerExchangeTick.update((t: number) => t + 1);
      showToast('Wallet addresses exchanged for this chat.');
    } catch (e: unknown) {
      dmError('Accept wallet peer info failed', e);
      showToast('Could not complete wallet exchange.');
    } finally {
      acceptingWalletPeerInfoRequestId = null;
    }
  }

  async function handleDeclineWalletPeerInfoRequest(
    msg: DmMessage,
    payload: WalletPeerInfoRequestPayload
  ) {
    declinedWalletPeerInfoRequestMessageIds.update((ids: string[]) =>
      ids.includes(msg.id) ? ids : [...ids, msg.id]
    );
    acceptedWalletPeerInfoRequestMessageIds.update((ids: string[]) =>
      ids.filter((id) => id !== msg.id)
    );
    const declineJson = formatWalletPeerInfoDecline({ request_id: payload.request_id });
    const ok = await handleDmSend(declineJson);
    if (!ok) showToast('Could not send decline.');
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

  async function handleDmSend(content: string): Promise<boolean> {
    const id = $activeDmId;
    if (!id || isPactoAppThreadId(id)) return false;
    if (parseWalletTxRequest(content)) {
      return sendWalletPaymentRequestDm(id, content);
    }
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
      return ok;
    } catch (e: unknown) {
      const raw = getInvokeErrorMessage(e, 'Failed to send message');
      $dmSendError = friendlyMessage(raw, 'dm_send');
      dmError('handleDmSend error', e);
      return false;
    }
  }

  /** Payment requests: optimistic card in chat; modal closes without blocking on relay delivery. */
  function sendWalletPaymentRequestDm(npub: string, content: string): boolean {
    dmLog('sendWalletPaymentRequestDm', { receiver: npub.slice(0, 20) + '…', contentLen: content.length });
    $dmSendError = null;
    const optimisticId = appendPendingOutboundDmMessage(npub, content);
    void (async () => {
      try {
        const ok = await sendDmMessage(npub, content);
        dmLog('sendWalletPaymentRequestDm result', { ok });
        if (!ok) {
          removeOutboundDmMessage(npub, optimisticId);
          const msg = 'Could not deliver the payment request. Check your connection and try again.';
          $dmSendError = friendlyMessage(msg, 'dm_send');
          showToast(msg);
        }
      } catch (e: unknown) {
        removeOutboundDmMessage(npub, optimisticId);
        const raw = getInvokeErrorMessage(e, 'Failed to send payment request');
        const msg = friendlyMessage(raw, 'dm_send');
        $dmSendError = msg;
        showToast(msg);
        dmError('sendWalletPaymentRequestDm error', e);
      }
    })();
    return true;
  }

  function openInviterDm(inviterNpub: string) {
    if (!inviterNpub.startsWith('npub1')) return;
    queueProfileSync(inviterNpub).catch(() => {});
    activeDmId.set(inviterNpub);
    const tab = dmSidebarCategoryForNpub(inviterNpub, get(dmChatsByNpub), get(pinnedDmNpubs)) as DmTab;
    if (tab !== 'search') {
      activeDmTab.set(tab);
      lastOpenedDmByTab.update((m) => ({ ...m, [tab]: inviterNpub }));
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
    syncSquadsHubSelection();
  } else if ($activeTopNavTab !== 'squads') {
    // Persist squad channel when leaving Squads tab so it restores correctly when returning
    if (prevTopNavTab === 'squads' && $activeSquadId) {
      const sid = $activeSquadId;
      const cid = $activeChannelId;
      if (SQUAD_CHANNEL_DEBUG) console.log('[SquadChannel] +page leave-squads reactive', { prevTopNavTab, activeTopNavTab: $activeTopNavTab, sid: sid?.slice(0, 12), cid: cid?.slice(0, 20) });
      if (cid && !cid.startsWith('creating-')) {
        lastOpenedSquadId.set(sid);
        lastOpenedChannelId.set(cid);
        lastChannelBySquadId.update((m: Record<string, string>) => ({ ...m, [sid]: cid }));
        const squad = $squads.find((s: Squad) => s.id === sid);
        if (cid === DASHBOARD_CHANNEL_ID) {
          lastHubChannelNameBySquadId.update((m) => {
            const next = { ...m };
            delete next[sid];
            return next;
          });
        } else if (squad) {
          const hub =
            resolveHubChannelNameForGroupSelection(squad.channels, cid, $activeHubChannelName) ?? '';
          lastHubChannelNameBySquadId.update((m) => {
            const next = { ...m };
            if (!hub) delete next[sid];
            else next[sid] = hub;
            return next;
          });
        }
      }
    }
    prevTopNavTab = $activeTopNavTab;
  }

  onMount(() => {
    syncSquadsHubSelection();

    // Pull DMs from Nostr relays when app loads (if already authenticated)
    if ($isAuthenticated) {
      dmLog('onMount: authenticated, calling fetchMessages(true)');
      dmSyncStatus.set('syncing');
      fetchMessages(true).catch((e) => dmError('onMount: fetchMessages(true) failed', e));
      clearUngroupedChannels();
    }

    return subscribeAppEvents({
      mergeTreasurySafesForParent,
      mergeSquadInfraForParent,
    });
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
      {:else if $activeTopNavTab === 'commons'}
        <CommonsView />
      {:else if $activeTopNavTab === 'dms'}
        <div class="dm-area">
          <MessengerNavbar />
          <div class="dm-main-row">
            <div class="dm-area-center" class:dm-area-center--wallet-open={dmWalletSidebarVisible}>
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
                onAcceptSquadInvite={(msg) => acceptSquadOrPairInvite(msg)}
                onAcceptChannelInSquad={acceptChannelInSquadInvite}
                onDeclineSquad={(msg: DmMessage) =>
                  declinedSquadInviteIds.update((ids: string[]) => (ids.includes(msg.id) ? ids : [...ids, msg.id]))}
                onDeclineChannelInSquad={(msg: DmMessage) =>
                  declinedChannelInviteMessageIds.update((ids: string[]) =>
                    ids.includes(msg.id) ? ids : [...ids, msg.id]
                  )}
                onOpenInviterChat={openInviterDm}
                onMarkReadUpTo={handleMarkReadUpTo}
                acceptingSquadInviteId={$acceptingSquadInviteId}
                acceptingChannelInSquadId={$acceptingChannelInSquadId}
                onAcceptWalletPeerInfoRequest={handleAcceptWalletPeerInfoRequest}
                onDeclineWalletPeerInfoRequest={handleDeclineWalletPeerInfoRequest}
                acceptingWalletPeerInfoRequestId={acceptingWalletPeerInfoRequestId}
                showOptionsMenu={true}
                showPinOption={showDmPinOption}
                onSaveNickname={async (value: string) => {
                  const id = $activeDmId;
                  if (!id) return;
                  try {
                    await setNickname(id, value);
                  } catch (e) {
                    throw new Error(getInvokeErrorMessage(e, 'Failed to set nickname'));
                  }
                }}
                onDeleteChat={isPactoAppThreadId($activeDmId)
                  ? undefined
                  : () => {
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
                showWalletButton={($activeDmTab === 'friends' || $activeDmTab === 'pinned') &&
                  !isPactoAppThreadId($activeDmId) /* wallet: Friends + Pinned only; not Pending/Requests/new chat */ }
              />
            {:else}
              <div class="dm-empty">
                <p>Select a conversation or start a new chat</p>
              </div>
            {/if}
            </div>
            </div>
            {#if dmWalletSidebarVisible && $activeDmId}
              <ResizableSidebar
                edge="trailing"
                sidebarClass="dm-wallet-resizable"
                persistKey="pacto_dm_wallet_sidebar_width"
                minWidth={240}
                maxWidth={900}
                initialWidth={300}
              >
                <WalletBar npub={$activeDmId} postDmPlaintext={handleDmSend} />
              </ResizableSidebar>
            {/if}
          </div>
        </div>
      {:else}
        <div class="parent-area">
          <ParentNavbar />
          <div class="parent-main">
          {#if showParentDashboard && openHubParent}
            {#key `${openHubParent.id}:${effectiveHubChannel.channelId ?? DASHBOARD_CHANNEL_ID}`}
              <ParentDashboard
              parent={openHubParent}
              treasurySafes={$treasurySafesByParentId[openHubParent.id] ?? []}
              governanceConfig={(() => {
                const id = openHubParent.id;
                const rows = $squadInfraByParentId[id];
                return Object.prototype.hasOwnProperty.call($squadInfraByParentId, id)
                  ? primaryGovernanceView(rows)
                  : undefined;
              })()}
              squadInfraRows={(() => {
                const id = openHubParent.id;
                return Object.prototype.hasOwnProperty.call($squadInfraByParentId, id)
                  ? ($squadInfraByParentId[id] ?? [])
                  : undefined;
              })()}
              onConfirmImportSafe={async (params: {
                safeAddress: string;
                chain: string;
                label: string;
                entryId: string;
                txHash?: string;
              }) => {
                const p = openHubParent;
                await addParentTreasurySafe(p.id, params.safeAddress, {
                  chain: params.chain,
                  label: params.label,
                  entryId: params.entryId,
                });
                try {
                  await syncGovernanceAfterTreasurySafe(p, {
                    safeAddress: params.safeAddress,
                    chain: params.chain,
                    entryId: params.entryId,
                    label: params.label,
                    txHash: params.txHash,
                  });
                } catch (e) {
                  showToast(getInvokeErrorMessage(e, 'Treasury saved but governance sync failed.'));
                }
                const gid = resolveAutomatedAnnounceGroupId(p);
                if (gid) {
                  const chainKey = parseSupportedChainId(params.chain);
                  const txHex = params.txHash?.trim();
                  const explorerTxUrl =
                    txHex && txHex.length > 0 ? getExplorerTxUrl(chainKey, txHex) : null;
                  await sendDmMessage(
                    gid,
                    buildAnnounceContent({
                      type: ANNOUNCE_TYPE_SAFE_UPDATED,
                      payload: {
                        squad_id: p.id,
                        safe_address: params.safeAddress,
                        chain: params.chain,
                        label: params.label || undefined,
                        entry_id: params.entryId,
                        tx_hash: txHex || undefined,
                        explorer_tx_url: explorerTxUrl ?? undefined,
                      },
                    }),
                    '',
                    { virtualBucket: 'inbox' },
                  );
                }
                await mergeTreasurySafesForParent(p.id);
                await mergeSquadInfraForParent(p.id);
              }}
              onPactoGovDeployComplete={finalizePactoGovDeploy}
              onSponsorDeployComplete={finalizeSponsorDeploy}
              onSquadAdminDeployComplete={finalizeSquadAdminDeploy}
            />
            {/key}
          {:else if showMlsChatView}
            {#if ChatViewComponent}
              <svelte:component this={ChatViewComponent} />
            {:else}
              <p class="surface-loading muted" role="status">Loading channel…</p>
            {/if}
          {:else if $activeSquadId && !openHubParent}
            <p class="surface-loading muted" role="status">Loading squad…</p>
          {:else}
            <p class="surface-loading muted" role="status">Select a squad channel</p>
          {/if}
          </div>
        </div>
      {/if}
    </div>
  </main>
  <div class="toast-portal-wrapper" use:portal>
    <Toast />
  </div>
  {#if $commonsBroadcastModalOpen}
    <div use:portal>
      <PersonalBroadcastModal />
    </div>
  {/if}
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
  .squads-area {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: row;
  }

  .parent-main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .surface-loading {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .dm-area {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: row;
  }

  .dm-main-row {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: row;
    align-items: stretch;
  }

  .dm-area-center {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 0 16px 0 16px;
  }

  .dm-area-center--wallet-open {
    padding-right: 0;
  }

  :global(.dm-wallet-resizable) {
    background-color: var(--bg-hover);
  }

  .dm-main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
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
