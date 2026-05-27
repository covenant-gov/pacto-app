<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { listen } from '@tauri-apps/api/event';
  import Navbar from '../components/layout/Navbar.svelte';
  import TopNavbar from '../components/layout/TopNavbar.svelte';
  import ParentNavbar from '../components/layout/ParentNavbar.svelte';
  import ChatView from '../components/channel/ChatView.svelte';
  import ParentDashboard from '../components/parent/ParentDashboard.svelte';
  import Profile from '../components/profile/Profile.svelte';
  import MessengerNavbar from '../components/dm/MessengerNavbar.svelte';
  import MessengerChatView from '../components/dm/MessengerChatView.svelte';
  import DmThread from '../components/dm/DmThread.svelte';
  import WalletBar from '../components/wallet/WalletBar.svelte';
  import ResizableSidebar from '../components/ui/ResizableSidebar.svelte';
  import Toast from '../components/ui/Toast.svelte';
  import {
    getDmMessages,
    getChatMessageCount,
    sendDmMessage,
    queueProfileSync,
    fetchMessages,
    markAsRead,
    startTyping,
    setNickname,
    listPendingMlsWelcomes,
    acceptMlsWelcome,
    parseSquadInviteMessage,
    parseChannelInSquadMessage,
    parseChannelInNetworkMessage,
    parseNetworkInviteMessage,
    syncMlsGroupsNow,
    getMlsGroupMembers,
    backfillSquadMemberEvmFromProfiles,
    deleteDmChatBackend,
    listParentTreasurySafes,
    addParentTreasurySafe,
    type PendingMlsWelcome,
  } from '../lib/api/nostr';
  import { buildAnnounceContent, ANNOUNCE_TYPE_SAFE_UPDATED, ANNOUNCE_TYPE_GOVERNANCE_UPDATED, parseAnnouncement } from '../lib/announcements';
  import { getExplorerTxUrl } from '../lib/wallet/assets';
  import { parseSupportedChainId } from '../lib/wallet/chains';
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
  import { dmLog, dmError } from '../lib/utils/dm-debug';
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
    allDmEntriesUnified,
    dmSidebarCategoryForNpub,
    lastOpenedDmByTab,
    lastOpenedSquadId,
    lastOpenedChannelId,
    lastChannelBySquadId,
    lastHubChannelNameBySquadId,
    lastChannelByNetworkId,
    lastHubChannelNameByNetworkId,
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
    blockedDmNpubs,
    dmSendError,
    deleteDmChat,
    revertDmChat,
    type DmChatSnapshot,
    updateChannelNameIfPlaceholder,
    bumpMembershipVersion,
    ANNOUNCEMENTS_CHANNEL_NAME,
    DASHBOARD_CHANNEL_ID,
    treasurySafesByParentId,
    squadInfraByParentId,
    dashboardPollReplicaNonceByParentId,
    type TreasurySafeEntry,
    type SquadInfraDto,
    type DmMessage,
    type DmTab,
    type DmEntry,
    type DmChatState,
    type SyncStatus,
    type Channel,
    type Network,
    type Squad,
    acceptedWalletPeerInfoRequestMessageIds,
    declinedWalletPeerInfoRequestMessageIds,
    dmWalletPeerExchangeTick,
  } from '../stores/app';
  import { pendingReadyToast, showToast } from '../stores/toast';
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
  import { portal } from '../lib/utils/portal';

  const PAGE_SIZE = 100;

  // Show "X is ready!" toast from root so it appears regardless of active view (DMs / Squads / Networks)
  $: if ($pendingReadyToast) {
    showToast($pendingReadyToast.text, $pendingReadyToast.goTo);
    pendingReadyToast.set(null);
  }

  /** When true, the DM wallet panel is not shown (other top nav, DM tab, or new chat), but open state stays until the user closes it. */
  $: walletSidebarInvalidContext =
    $activeTopNavTab !== 'dms' ||
    $activeView !== 'hub' ||
    ($activeDmTab !== 'friends' && $activeDmTab !== 'pinned') ||
    $composingNewChat;

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

  /** Group IDs we just accepted as squad invites — skip "Add to squad" modal for these. */
  let acceptedSquadInviteGroupIds = new Set<string>();

  /** Hydrate treasury Safes from backend when dashboard is shown or via background prefetch (once per squad/network). */
  let treasuryHydratedIds = new Set<string>();
  async function mergeTreasurySafesForParent(parentId: string) {
    if (!parentId) return;
    try {
      const rows = await listParentTreasurySafes(parentId);
      treasurySafesByParentId.update((m: Record<string, TreasurySafeEntry[]>) => ({
        ...m,
        [parentId]: rows,
      }));
    } catch {
      /* ignore */
    }
  }

  async function mergeSquadInfraForParent(parentId: string) {
    if (!parentId) return;
    try {
      const rows = await listSquadInfra(parentId);
      squadInfraByParentId.update((m: Record<string, SquadInfraDto[]>) => ({
        ...m,
        [parentId]: rows,
      }));
    } catch {
      /* ignore */
    }
  }

  function governanceCanonicalSafeRef(rawAddress: string): string {
    try {
      return getAddress(rawAddress.trim() as `0x${string}`);
    } catch {
      return rawAddress.trim();
    }
  }

  /** Persist a standalone vault Safe infra row (one row per treasury entry; skips pacto-gov treasury). */
  async function syncGovernanceAfterTreasurySafe(
    p: Squad | Network,
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
    const row =
      get(squads).find((s: Squad) => s.id === params.parentId) ??
      get(networks).find((n: Network) => n.id === params.parentId);
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
    const row =
      get(squads).find((s: Squad) => s.id === params.parentId) ??
      get(networks).find((n: Network) => n.id === params.parentId);
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
        { virtualBucket: 'inbox' },
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
    const row =
      get(squads).find((s: Squad) => s.id === params.parentId) ??
      get(networks).find((n: Network) => n.id === params.parentId);
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

  $: dashboardParentId = $activeChannelId === DASHBOARD_CHANNEL_ID ? ($activeTopNavTab === 'squads' ? $activeSquadId : $activeNetworkId) ?? null : null;
  $: if (dashboardParentId && !treasuryHydratedIds.has(dashboardParentId)) {
    treasuryHydratedIds.add(dashboardParentId);
    mergeTreasurySafesForParent(dashboardParentId);
    mergeSquadInfraForParent(dashboardParentId).catch(() => {});
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

  /** Background prefetch: on app start/load, best-effort fetch of Safe addresses for all known parents (squads + networks). */
  let initialTreasuryPrefetchDone = false;
  $: if (!initialTreasuryPrefetchDone && ($squads.length > 0 || $networks.length > 0)) {
    initialTreasuryPrefetchDone = true;
    const parentIds = [
      ...$squads.map((s: Squad) => s.id),
      ...$networks.map((n: Network) => n.id),
    ];
    for (const pid of parentIds) {
      if (!pid || treasuryHydratedIds.has(pid)) continue;
      treasuryHydratedIds.add(pid);
      mergeTreasurySafesForParent(pid).catch(() => {});
      mergeSquadInfraForParent(pid).catch(() => {});
    }
  }

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
      const squad = list.find((s: Squad) => s.id === parentId);
      if (squad) {
        newChannel.order = squad.channels.length;
        squads.update((l: Squad[]) =>
          l.map((s: Squad) => (s.id !== squad.id ? s : { ...s, channels: [...s.channels, newChannel] }))
        );
      }
    } else {
      const list = get(networks);
      const network = list.find((n: Network) => n.id === parentId);
      if (network) {
        newChannel.order = network.channels.length;
        networks.update((l: Network[]) =>
          l.map((n: Network) => (n.id !== network.id ? n : { ...n, channels: [...n.channels, newChannel] }))
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
  // Only write channel when it belongs to this squad (avoid overwriting with network channel when we've just switched to Squads and activeChannelId is still the network channel).
  $: if ($activeTopNavTab === 'squads' && $activeSquadId) {
    const sid = $activeSquadId;
    lastOpenedSquadId.set(sid);
    const cid = $activeChannelId;
    if (cid && !cid.startsWith('creating-')) {
      const squad = $squads.find((s: Squad) => s.id === sid);
      const cidBelongsToSquad = squad?.channels.some((c: Channel) => c.groupId === cid) ?? false;
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

  // Persist last-opened network/channel and per-network last channel when user selects in Networks tab (only network stores).
  // Only write channel when it belongs to this network (avoid overwriting with squad channel when we've just switched to Networks and activeChannelId is still a squad channel).
  $: if ($activeTopNavTab === 'networks' && $activeNetworkId) {
    const nid = $activeNetworkId;
    lastOpenedNetworkId.set(nid);
    const networkCid = $activeChannelId;
    if (networkCid && !networkCid.startsWith('creating-')) {
      const net = $networks.find((n: Network) => n.id === nid);
      const cidBelongsToNetwork = net?.channels.some((c: Channel) => c.groupId === networkCid) ?? false;
      if (cidBelongsToNetwork && net) {
        if (SQUAD_CHANNEL_DEBUG) console.log('[SquadChannel] +page on-networks persist (network only)', { nid: nid?.slice(0, 12), networkCid: networkCid?.slice(0, 20) });
        lastOpenedNetworkChannelId.set(networkCid);
        lastChannelByNetworkId.update((m: Record<string, string>) => ({ ...m, [nid]: networkCid }));
        const hub =
          resolveHubChannelNameForGroupSelection(net.channels, networkCid, $activeHubChannelName) ?? '';
        lastHubChannelNameByNetworkId.update((m) => {
          const next = { ...m };
          if (!hub) delete next[nid];
          else next[nid] = hub;
          return next;
        });
      }
    }
  }

  // Never leave channel empty when a squad is selected: restore last channel for this squad or default to first (announcements). Dashboard (virtual channel) is valid.
  $: if ($activeTopNavTab === 'squads' && $activeSquadId && $squads.length > 0) {
    const sid = $activeSquadId;
    const squad = $squads.find((s: Squad) => s.id === sid);
    if (squad) {
      const sorted = [...squad.channels].sort((a: Channel, b: Channel) => a.order - b.order);
      const firstCh = sorted[0];
      const lastForSquad = $lastChannelBySquadId[sid];
      const activeInSquad =
        $activeChannelId &&
        (sorted.some((c: Channel) => c.groupId === $activeChannelId) || $activeChannelId === DASHBOARD_CHANNEL_ID);
      const lastInSquad =
        lastForSquad &&
        (sorted.some((c: Channel) => c.groupId === lastForSquad) || lastForSquad === DASHBOARD_CHANNEL_ID);
      const validChannel =
        activeInSquad ? $activeChannelId
          : lastInSquad ? lastForSquad
            : firstCh ? DASHBOARD_CHANNEL_ID : null;
      if (validChannel && $activeChannelId !== validChannel) {
        if (SQUAD_CHANNEL_DEBUG) console.log('[SquadChannel] +page never-empty correct', { sid: sid.slice(0, 12), from: $activeChannelId?.slice(0, 20), to: validChannel?.slice(0, 20), reason: activeInSquad ? 'active' : lastInSquad ? 'lastForSquad' : 'firstCh', lastForSquad: lastForSquad?.slice(0, 20) });
        activeChannelId.set(validChannel);
        const hub =
          validChannel !== DASHBOARD_CHANNEL_ID
            ? resolveHubChannelNameForGroupSelection(sorted, validChannel, $lastHubChannelNameBySquadId[sid])
            : null;
        activeHubChannelName.set(hub);
      }
    }
  }

  // Never leave channel empty when a network is selected: restore last channel for this network or default to first (announcements). Dashboard (virtual channel) is valid.
  $: if ($activeTopNavTab === 'networks' && $activeNetworkId && $networks.length > 0) {
    const nid = $activeNetworkId;
    const net = $networks.find((n: Network) => n.id === nid);
    if (net) {
      const sorted = [...net.channels].sort((a: Channel, b: Channel) => a.order - b.order);
      const firstCh = sorted[0];
      const lastForNet = $lastChannelByNetworkId[nid];
      const activeInNet =
        $activeChannelId &&
        (sorted.some((c: Channel) => c.groupId === $activeChannelId) || $activeChannelId === DASHBOARD_CHANNEL_ID);
      const lastInNet =
        lastForNet &&
        (sorted.some((c: Channel) => c.groupId === lastForNet) || lastForNet === DASHBOARD_CHANNEL_ID);
      const validChannel =
        activeInNet ? $activeChannelId
          : lastInNet ? lastForNet
            : firstCh ? DASHBOARD_CHANNEL_ID : null;
      if (validChannel && $activeChannelId !== validChannel) {
        activeChannelId.set(validChannel);
        const hub =
          validChannel !== DASHBOARD_CHANNEL_ID
            ? resolveHubChannelNameForGroupSelection(sorted, validChannel, $lastHubChannelNameByNetworkId[nid])
            : null;
        activeHubChannelName.set(hub);
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
    const backend = [...($backendDmMessages[npub] ?? [])];
    const announcements = [...($dmThreadAnnouncementsByNpub[npub] ?? [])];
    const list = [...backend, ...announcements];
    list.sort((a: DmMessage, b: DmMessage) => a.at - b.at);
    const squadInviteCount = list.filter((m: DmMessage) => parseSquadInviteMessage(m.content ?? '') !== null).length;
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
        messageCountByChat.update((byChat: Record<string, number>) => ({ ...byChat, [npub]: count }));
      })
      .catch((err) => {
        dmError('open conversation: getChatMessageCount failed', err);
      });
    getDmMessages(npub, PAGE_SIZE, 0)
      .then((msgs) => {
        dmLog('open conversation: messages loaded', { npub: npub.slice(0, 20) + '…', count: msgs.length });
        const loaded = msgs as DmMessage[];
        backendDmMessages.update((byNpub: Record<string, DmMessage[]>) => {
          const existing = byNpub[npub] ?? [];
          const loadedIds = new Set(loaded.map((m) => m.id));
          // Keep messages from state that aren't in the loaded set (e.g. just-sent squad invite from message_new)
          const fromExisting = existing.filter((m) => !loadedIds.has(m.id));
          const merged = [...loaded, ...fromExisting];
          return { ...byNpub, [npub]: merged };
        });
        loadedOffsetByChat.update((by: Record<string, number>) => ({ ...by, [npub]: PAGE_SIZE }));
        // Mark as read up to the latest message (backend returns newest first)
        const lastMessageId = msgs.length > 0 ? (msgs[0] as DmMessage).id : null;
        markAsRead(npub, lastMessageId).catch(() => {});
      })
      .catch((err) => {
        dmError('open conversation: getDmMessages failed', err);
      });
  }

  // Load group messages when opening a squad or network channel. Skip placeholder "creating-*" and the
  // virtual #dashboard view (not an MLS group).
  // Only when Squads/Networks is active: `activeChannelId` persists when switching to DMs — do not call DM/group APIs from DMs tab.
  $: if (
    $activeChannelId &&
    $activeChannelId !== DASHBOARD_CHANNEL_ID &&
    !$activeChannelId.startsWith('creating-') &&
    ($activeTopNavTab === 'squads' || $activeTopNavTab === 'networks')
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
    if (!npub || loadingOlder) return;
    const currentOffset = $loadedOffsetByChat[npub] ?? PAGE_SIZE;
    loadingOlder = true;
    dmLog('loadOlder', { npub: npub.slice(0, 20) + '…', offset: currentOffset });
    try {
      const older = await getDmMessages(npub, LOAD_OLDER_PAGE_SIZE, currentOffset);
      backendDmMessages.update((byNpub: Record<string, DmMessage[]>) => {
        const list = byNpub[npub] ?? [];
        const ids = new Set(list.map((m) => m.id));
        const newMsgs = (older as DmMessage[]).filter((m) => !ids.has(m.id));
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
    !loadingOlder &&
    (($messageCountByChat[$activeDmId] ?? 0) > ($backendDmMessages[$activeDmId]?.length ?? 0));

  // Squad/network/channel-in-squad invite cards: accepted/declined are persisted in app store; accepting is transient
  let acceptingSquadInviteId: string | null = null;
  let acceptingChannelInSquadId: string | null = null;
  let acceptingChannelInNetworkId: string | null = null;
  let acceptingNetworkInviteId: string | null = null;
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

  async function acceptAnnouncementsInvite(
    type: 'squad' | 'network',
    payload: { groupId: string; name: string; memberSquads?: { id: string; name: string }[] },
    messageId: string
  ): Promise<void> {
    const welcomes = await listPendingMlsWelcomes();
    const welcome = welcomes.find((w: PendingMlsWelcome) => w.nostr_group_id === payload.groupId);
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
      squads.update((list: Squad[]) => [...list, newSquad]);
      activeSquadId.set(newSquad.id);
      activeChannelId.set(payload.groupId);
      activeHubChannelName.set(ANNOUNCEMENTS_CHANNEL_NAME);
      activeView.set('hub');
      acceptedSquadInviteIds.update((ids: string[]) => (ids.includes(messageId) ? ids : [...ids, messageId]));
    } else {
      const newNetwork: Network = {
        id: payload.groupId,
        name: payload.name,
        channels: [announcementsChannel],
        memberSquads: payload.memberSquads ?? [],
        createdAt: now,
        updatedAt: now,
      };
      networks.update((list: Network[]) => [...list, newNetwork]);
      activeNetworkId.set(newNetwork.id);
      activeChannelId.set(payload.groupId);
      activeHubChannelName.set(ANNOUNCEMENTS_CHANNEL_NAME);
      activeTopNavTab.set('networks');
      activeView.set('hub');
      acceptedNetworkInviteIds.update((ids: string[]) => (ids.includes(messageId) ? ids : [...ids, messageId]));
    }
    try {
      await syncMlsGroupsNow(payload.groupId);
    } catch (e) {
      dmError('syncMlsGroupsNow after accept invite', e);
    }
    try {
      const membersResult = await getMlsGroupMembers(payload.groupId);
      const memberNpubs = (membersResult.members ?? []) as string[];
      await backfillSquadMemberEvmFromProfiles(payload.groupId, memberNpubs);
    } catch (e) {
      dmError('backfillSquadMemberEvmFromProfiles after accept', e);
    }
    bumpMembershipVersion(payload.groupId);
    pendingReadyToast.set({
      text: `${payload.name} is ready!`,
      goTo:
        type === 'squad'
          ? {
              type: 'squad',
              name: payload.name,
              id: payload.groupId,
              channelId: payload.groupId,
            }
          : {
              type: 'network',
              name: payload.name,
              id: payload.groupId,
              channelId: payload.groupId,
            },
    });
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
      const welcome = welcomes.find((w: PendingMlsWelcome) => w.nostr_group_id === payload.channelGroupId);
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
      acceptedChannelInviteMessageIds.update((ids: string[]) =>
        ids.includes(msg.id) ? ids : [...ids, msg.id]
      );
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
      const welcome = welcomes.find((w: PendingMlsWelcome) => w.nostr_group_id === payload.channelGroupId);
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
      acceptedChannelInviteMessageIds.update((ids: string[]) =>
        ids.includes(msg.id) ? ids : [...ids, msg.id]
      );
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

  async function handleDmSend(content: string): Promise<boolean> {
    const id = $activeDmId;
    if (!id) return false;
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
    const squad = lastSquadId ? $squads.find((s: Squad) => s.id === lastSquadId) : null;
    const mapSnapshot = { ...$lastChannelBySquadId };
    if (SQUAD_CHANNEL_DEBUG) console.log('[SquadChannel] +page restore-to-squads', { lastSquadId: lastSquadId?.slice(0, 12), squadId: squad?.id?.slice(0, 12), lastChannelBySquadId: mapSnapshot, lastForSquad: squad ? mapSnapshot[squad.id]?.slice(0, 20) : undefined });
    if (squad) {
      const sorted = [...squad.channels].sort((a: Channel, b: Channel) => a.order - b.order);
      const firstCh = sorted[0];
      const lastForSquad = $lastChannelBySquadId[squad.id];
      const lastValid =
        lastForSquad &&
        (sorted.some((c: Channel) => c.groupId === lastForSquad) || lastForSquad === DASHBOARD_CHANNEL_ID);
      const setChannelId =
        lastValid && lastForSquad === DASHBOARD_CHANNEL_ID
          ? DASHBOARD_CHANNEL_ID
          : (lastValid ? sorted.find((c: Channel) => c.groupId === lastForSquad)?.groupId : firstCh?.groupId) ??
            firstCh?.groupId ??
            null;
      if (SQUAD_CHANNEL_DEBUG) console.log('[SquadChannel] +page restore-to-squads set', { squadId: squad.id.slice(0, 12), lastForSquad: lastForSquad?.slice(0, 20), lastValid, setChannelId: setChannelId?.slice(0, 20), firstChId: firstCh?.groupId?.slice(0, 20) });
      activeSquadId.set(squad.id);
      activeChannelId.set(setChannelId);
      const hub =
        setChannelId && setChannelId !== DASHBOARD_CHANNEL_ID
          ? resolveHubChannelNameForGroupSelection(sorted, setChannelId, $lastHubChannelNameBySquadId[squad.id])
          : null;
      activeHubChannelName.set(hub);
    } else if ($squads.length > 0 && !$activeSquadId) {
      const first = $squads[0];
      const sorted = [...first.channels].sort((a: Channel, b: Channel) => a.order - b.order);
      activeSquadId.set(first.id);
      activeChannelId.set(sorted[0]?.groupId ?? null);
      activeHubChannelName.set(sorted[0]?.name ?? null);
    }
  } else if ($activeTopNavTab === 'networks' && prevTopNavTab !== 'networks') {
    prevTopNavTab = 'networks';
    // Restore last-opened network/channel: prefer per-network last channel, then global last, then first (announcements)
    const lastNetId = $lastOpenedNetworkId;
    const net = lastNetId ? $networks.find((n: Network) => n.id === lastNetId) : null;
    if (net) {
      activeNetworkId.set(net.id);
      const sorted = [...net.channels].sort((a: Channel, b: Channel) => a.order - b.order);
      const firstCh = sorted[0];
      const lastChanId = $lastOpenedNetworkChannelId;
      const lastForNet = $lastChannelByNetworkId[net.id];
      const lastIsDashboard = lastChanId === DASHBOARD_CHANNEL_ID || lastForNet === DASHBOARD_CHANNEL_ID;
      const ch =
        lastIsDashboard
          ? null
          : lastChanId && sorted.some((c: Channel) => c.groupId === lastChanId)
            ? sorted.find((c: Channel) => c.groupId === lastChanId)
            : lastForNet && sorted.some((c: Channel) => c.groupId === lastForNet)
              ? sorted.find((c: Channel) => c.groupId === lastForNet)
              : firstCh;
      const netCid = lastIsDashboard ? DASHBOARD_CHANNEL_ID : (ch?.groupId ?? firstCh?.groupId ?? null);
      activeChannelId.set(netCid);
      const hub =
        netCid && netCid !== DASHBOARD_CHANNEL_ID
          ? resolveHubChannelNameForGroupSelection(sorted, netCid, $lastHubChannelNameByNetworkId[net.id])
          : null;
      activeHubChannelName.set(hub);
    } else if ($networks.length > 0) {
      const currentNet = $activeNetworkId ? $networks.find((n: Network) => n.id === $activeNetworkId) : null;
      if (!currentNet) {
        const first = $networks[0];
        const firstCh = first.channels.slice().sort((a: Channel, b: Channel) => a.order - b.order)[0];
        activeNetworkId.set(first.id);
        activeChannelId.set(firstCh?.groupId ?? null);
        activeHubChannelName.set(firstCh?.name ?? null);
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
    // Persist network channel when leaving Networks tab so it restores correctly when returning
    if (prevTopNavTab === 'networks' && $activeNetworkId) {
      const nid = $activeNetworkId;
      const cid = $activeChannelId;
      if (cid && !cid.startsWith('creating-')) {
        lastOpenedNetworkId.set(nid);
        lastOpenedNetworkChannelId.set(cid);
        lastChannelByNetworkId.update((m: Record<string, string>) => ({ ...m, [nid]: cid }));
        const net = $networks.find((n: Network) => n.id === nid);
        if (cid === DASHBOARD_CHANNEL_ID) {
          lastHubChannelNameByNetworkId.update((m) => {
            const next = { ...m };
            delete next[nid];
            return next;
          });
        } else if (net) {
          const hub =
            resolveHubChannelNameForGroupSelection(net.channels, cid, $activeHubChannelName) ?? '';
          lastHubChannelNameByNetworkId.update((m) => {
            const next = { ...m };
            if (!hub) delete next[nid];
            else next[nid] = hub;
            return next;
          });
        }
      }
    }
    prevTopNavTab = $activeTopNavTab;
  }

  onMount(() => {
    // Gate selection: only set squad/channel when we have squads
    if ($squads.length > 0 && !$activeSquadId) {
      const first = $squads[0];
      $activeSquadId = first.id;
      $activeChannelId = first.channels.length > 0 ? DASHBOARD_CHANNEL_ID : null;
      activeHubChannelName.set(null);
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
        virtual_bucket: (message as { virtual_bucket?: string | null }).virtual_bucket,
        replied_to: (message as { replied_to?: string }).replied_to,
        replied_to_content: (message as { replied_to_content?: string | null }).replied_to_content,
        replied_to_npub: (message as { replied_to_npub?: string | null }).replied_to_npub,
        replied_to_has_attachment: (message as { replied_to_has_attachment?: boolean | null }).replied_to_has_attachment,
      };
      backendDmMessages.update((byNpub: Record<string, DmMessage[]>) => {
        const list = byNpub[chat_id] ?? [];
        if (list.some((x) => x.id === m.id)) return byNpub;
        // Replace optimistic message (opt-*) with same content when backend confirms (avoids duplicate)
        const withoutOpt = list.filter(
          (x) => !(x.id.startsWith('opt-') && x.mine && x.content === m.content)
        );
        return { ...byNpub, [chat_id]: [...withoutOpt, m] };
      });
      // Update Friends/Requests/Pending: OR in message flags so we never lose a true (chat can move to Friends when they reply)
      dmChatsByNpub.update((map: Record<string, DmChatState>) => {
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
      typingByChat.update((by: Record<string, string[]>) => {
        if (!by[chat_id]?.length) return by;
        return { ...by, [chat_id]: [] };
      });
    });

    const unlistenUpdate = listen<{ old_id: string; message: DmMessage; chat_id: string }>(
      'message_update',
      (event) => {
        const { old_id, message, chat_id } = event.payload;
        dmLog('message_update', { chat_id: chat_id.slice(0, 20) + '…', old_id: old_id?.slice(0, 12), new_id: message.id?.slice(0, 12) });
        const m: DmMessage = {
          id: message.id,
          content: message.content,
          at: message.at,
          mine: message.mine,
          npub: message.npub,
          pending: message.pending,
          failed: message.failed,
          virtual_bucket: (message as { virtual_bucket?: string | null }).virtual_bucket,
          replied_to: (message as { replied_to?: string }).replied_to,
          replied_to_content: (message as { replied_to_content?: string | null }).replied_to_content,
          replied_to_npub: (message as { replied_to_npub?: string | null }).replied_to_npub,
          replied_to_has_attachment: (message as { replied_to_has_attachment?: boolean | null }).replied_to_has_attachment,
        };
        if (chat_id.startsWith('npub1')) {
          backendDmMessages.update((byNpub: Record<string, DmMessage[]>) => {
            const list = byNpub[chat_id] ?? [];
            const out = list.filter((x) => x.id !== old_id && x.id !== m.id);
            return {
              ...byNpub,
              [chat_id]: [...out, m].sort((a: DmMessage, b: DmMessage) => a.at - b.at),
            };
          });
        } else {
          // Group chat: replace old_id with real message so sender doesn't see duplicate (pending-* → real id)
          backendGroupMessages.update((byGroup: Record<string, DmMessage[]>) => {
            const list = byGroup[chat_id] ?? [];
            const out = list.filter((x) => x.id !== old_id && x.id !== m.id);
            return {
              ...byGroup,
              [chat_id]: [...out, m].sort((a: DmMessage, b: DmMessage) => a.at - b.at),
            };
          });
          const announce = parseAnnouncement(m.content);
          if (announce?.type === 'squad_safe_updated') {
            mergeTreasurySafesForParent(announce.payload.squad_id);
          }
          if (announce?.type === ANNOUNCE_TYPE_GOVERNANCE_UPDATED) {
            mergeSquadInfraForParent(announce.payload.parent_id);
          }
        }
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
      dmSyncStatus.update((s: SyncStatus) => (s === 'idle' ? 'syncing' : s));
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
      typingByChat.update((by: Record<string, string[]>) => ({ ...by, [conversation_id]: list }));

      // Clear "Typing" after TYPING_EXPIRY_SEC if we don't get another update (backend doesn't re-emit on expiry)
      const existing = typingClearTimeouts.get(conversation_id);
      if (existing) clearTimeout(existing);
      typingClearTimeouts.delete(conversation_id);
      if (list.length > 0) {
        const t = setTimeout(() => {
          typingClearTimeouts.delete(conversation_id);
          typingByChat.update((by: Record<string, string[]>) => {
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
        virtual_bucket: (message as { virtual_bucket?: string | null }).virtual_bucket,
        replied_to: (message as { replied_to?: string }).replied_to,
        replied_to_content: (message as { replied_to_content?: string | null }).replied_to_content,
        replied_to_npub: (message as { replied_to_npub?: string | null }).replied_to_npub,
        replied_to_has_attachment: (message as { replied_to_has_attachment?: boolean | null }).replied_to_has_attachment,
      };
      backendGroupMessages.update((byGroup: Record<string, DmMessage[]>) => {
        const list = byGroup[group_id] ?? [];
        if (list.some((x) => x.id === m.id)) return byGroup;
        // Remove optimistic placeholder (opt-* or pending-*) so we don't show duplicate when real message arrives
        const withoutOpt = list.filter(
          (x) => !((x.id.startsWith('opt-') || x.id.startsWith('pending-')) && x.mine && x.content === m.content)
        );
        return { ...byGroup, [group_id]: [...withoutOpt, m] };
      });
      const announce = parseAnnouncement(m.content);
      if (announce?.type === 'squad_safe_updated') {
        mergeTreasurySafesForParent(announce.payload.squad_id);
      }
      if (announce?.type === ANNOUNCE_TYPE_GOVERNANCE_UPDATED) {
        mergeSquadInfraForParent(announce.payload.parent_id);
      }
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
      const singleChannelSquads = list.filter((s: Squad) => s.channels.length === 1);
      if (singleChannelSquads.length === 1) {
        const squad = singleChannelSquads[0];
        const name = group_id.slice(0, 12) + '…';
        const newChannel: Channel = { name, groupId: group_id, order: squad.channels.length };
        squads.update((l: Squad[]) =>
          l.map((s: Squad) => (s.id !== squad.id ? s : { ...s, channels: [...s.channels, newChannel] }))
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
    const unlistenGroupInitialSync = listen<{ group_id?: string }>('mls_group_initial_sync', (event) => {
      const gid = event.payload?.group_id;
      if (gid) bumpMembershipVersion(gid);
    });
    const unlistenGroupLeft = listen<{ group_id?: string }>('mls_group_left', (event) => {
      const gid = event.payload?.group_id;
      if (gid) bumpMembershipVersion(gid);
    });

    const unlistenDashboardPollReplica = listen('dashboard_poll_replica_updated', (event) => {
      const raw = event.payload as Record<string, unknown> | undefined;
      const pidRaw = raw?.parent_id ?? raw?.parentId;
      const pid = typeof pidRaw === 'string' ? pidRaw.trim() : '';
      if (!pid) return;
      dashboardPollReplicaNonceByParentId.update((m) => ({ ...m, [pid]: (m[pid] ?? 0) + 1 }));
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
      unlistenGroupInitialSync.then((fn) => fn());
      unlistenGroupLeft.then((fn) => fn());
      unlistenDashboardPollReplica.then((fn) => fn());
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
                onAcceptSquadInvite={handleAcceptSquadInvite}
                onAcceptChannelInSquad={handleAcceptChannelInSquad}
                onAcceptChannelInNetwork={handleAcceptChannelInNetwork}
                onAcceptNetworkInvite={handleAcceptNetworkInvite}
                onDeclineSquad={(msg: DmMessage) =>
                  declinedSquadInviteIds.update((ids: string[]) => (ids.includes(msg.id) ? ids : [...ids, msg.id]))}
                onDeclineNetwork={(msg: DmMessage) =>
                  declinedNetworkInviteIds.update((ids: string[]) => (ids.includes(msg.id) ? ids : [...ids, msg.id]))}
                onDeclineChannelInSquad={(msg: DmMessage) =>
                  declinedChannelInviteMessageIds.update((ids: string[]) =>
                    ids.includes(msg.id) ? ids : [...ids, msg.id]
                  )}
                onDeclineChannelInNetwork={(msg: DmMessage) =>
                  declinedChannelInviteMessageIds.update((ids: string[]) =>
                    ids.includes(msg.id) ? ids : [...ids, msg.id]
                  )}
                acceptingSquadInviteId={acceptingSquadInviteId}
                acceptingChannelInSquadId={acceptingChannelInSquadId}
                acceptingChannelInNetworkId={acceptingChannelInNetworkId}
                acceptingNetworkInviteId={acceptingNetworkInviteId}
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
                showWalletButton={$activeDmTab === 'friends' || $activeDmTab === 'pinned' /* wallet: Friends + Pinned only; not Pending/Requests/new chat */ }
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
          <ParentNavbar type={$activeTopNavTab === 'networks' ? 'network' : 'squad'} />
          {#if $activeChannelId === DASHBOARD_CHANNEL_ID && ($activeTopNavTab === 'squads' ? $squads.find((s: Squad) => s.id === $activeSquadId) : $networks.find((n: Network) => n.id === $activeNetworkId))}
            <ParentDashboard
              parent={$activeTopNavTab === 'squads'
                ? $squads.find((s: Squad) => s.id === $activeSquadId)!
                : $networks.find((n: Network) => n.id === $activeNetworkId)!}
              parentType={$activeTopNavTab === 'networks' ? 'network' : 'squad'}
              treasurySafes={$treasurySafesByParentId[
                ($activeTopNavTab === 'squads'
                  ? $squads.find((s: Squad) => s.id === $activeSquadId)
                  : $networks.find((n: Network) => n.id === $activeNetworkId))?.id ?? ''
              ] ?? []}
              governanceConfig={(() => {
                const id =
                  ($activeTopNavTab === 'squads'
                    ? $squads.find((s: Squad) => s.id === $activeSquadId)
                    : $networks.find((n: Network) => n.id === $activeNetworkId))?.id ?? '';
                if (!id) return undefined;
                const rows = $squadInfraByParentId[id];
                return Object.prototype.hasOwnProperty.call($squadInfraByParentId, id)
                  ? primaryGovernanceView(rows)
                  : undefined;
              })()}
              squadInfraRows={(() => {
                const id =
                  ($activeTopNavTab === 'squads'
                    ? $squads.find((s: Squad) => s.id === $activeSquadId)
                    : $networks.find((n: Network) => n.id === $activeNetworkId))?.id ?? '';
                if (!id) return undefined;
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
                const p =
                  $activeTopNavTab === 'squads'
                    ? $squads.find((s: Squad) => s.id === $activeSquadId)!
                    : $networks.find((n: Network) => n.id === $activeNetworkId)!;
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
          {:else}
            <ChatView />
          {/if}
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
