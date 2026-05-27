<script lang="ts">
  import { get } from 'svelte/store';
  import ParentSidebar from './ParentSidebar.svelte';
  import CreateChannelModal from '../channel/CreateChannelModal.svelte';
  import InviteToParentModal from '../channel/InviteToParentModal.svelte';
  import ExitParentModal from '../channel/ExitParentModal.svelte';
  import {
    squads,
    networks,
    activeSquadId,
    activeNetworkId,
    activeChannelId,
    activeHubChannelName,
    activeView,
    lastChannelBySquadId,
    lastHubChannelNameBySquadId,
    lastOpenedNetworkId,
    lastOpenedNetworkChannelId,
    lastChannelByNetworkId,
    lastHubChannelNameByNetworkId,
    dmList,
    requestsList,
    pendingList,
    parentsCreatingAnnouncements,
    parentCreateErrorById,
    parentPendingCreateMembers,
    removeParentCreatingAnnouncements,
    DASHBOARD_CHANNEL_ID,
    DASHBOARD_CHANNEL_NAME,
    ANNOUNCEMENTS_CHANNEL_NAME,
    type Channel as ChannelType,
    type Squad,
    type Network,
  } from '../../stores/app';
  import {
    getAnnouncementsChannel,
    createDefaultParentChannels,
    uniqueChannelsByGroupIdPreservingOrder,
    loadMembersForParent,
    defaultParentInvitePhysicalGroupTargets,
  } from '../../lib/parent-navbar';
  import { resolveHubChannelNameForGroupSelection } from '../../lib/mls/virtual-channel-bucket';
  import {
    createGroupChat,
    getMlsGroupMembers,
    inviteMemberToGroup,
    sendDmMessage,
    formatSquadInviteMessage,
    formatChannelInSquadMessage,
    formatChannelInNetworkMessage,
    formatNetworkInviteMessage,
    leaveMlsGroup,
  } from '../../lib/api/nostr';
  import { getInvokeErrorMessage, friendlyMessage } from '../../lib/utils/tauri-errors';
  import { pendingReadyToast, showToast } from '../../stores/toast';
  import { getProfileDisplayName } from '../../lib/utils/profile';
  import { profiles } from '../../stores/profiles';
  import { currentUser } from '../../stores/auth';

  export let type: 'squad' | 'network' = 'squad';

  // --- Derived state (branch on type) ---
  $: activeParent =
    type === 'squad'
      ? ($squads.find((s) => s.id === $activeSquadId) as Squad | undefined)
      : ($networks.find((n) => n.id === $activeNetworkId) as Network | undefined);

  $: rawChannels = activeParent
    ? [...(type === 'squad' ? (activeParent as Squad).channels : (activeParent as Network).channels)].sort(
        (a, b) => a.order - b.order
      )
    : [];
  // Prepend # dashboard above # announcements (dashboard is not an MLS channel)
  $: channels = activeParent
    ? [{ name: DASHBOARD_CHANNEL_NAME, groupId: DASHBOARD_CHANNEL_ID, order: -1 }, ...rawChannels]
    : [];

  $: creating =
    activeParent &&
    activeParent.channels.length === 0 &&
    $parentsCreatingAnnouncements.has(activeParent.id);

  $: createError = activeParent ? $parentCreateErrorById[activeParent.id] ?? '' : '';

  $: canRetryCreate =
    activeParent &&
    createError &&
    ($parentPendingCreateMembers[activeParent.id]?.length ?? 0) > 0;

  $: subheading =
    type === 'network' && activeParent
      ? (activeParent as Network).memberSquads?.map((s) => s.name).join(', ') ?? ''
      : undefined;

  $: emptyMessage =
    type === 'squad'
      ? 'Select a squad'
      : $networks.length > 0
        ? 'Select a network'
        : 'No networks';

  $: canShowParentMenuActions =
    !!activeParent && !creating && activeParent.channels.length > 0;

  let retryingCreate = false;
  let inviteErrorBanner = '';
  let createChannelErrorBanner = '';

  $: errorBanners = [
    ...(inviteErrorBanner ? [{ id: 'invite', text: inviteErrorBanner }] : []),
    ...(createChannelErrorBanner ? [{ id: 'createChannel', text: createChannelErrorBanner }] : []),
  ];

  function onDismissBanner(id: string) {
    if (id === 'invite') inviteErrorBanner = '';
    if (id === 'createChannel') createChannelErrorBanner = '';
  }

  // --- selectChannel ---
  function selectChannel(channel: { groupId: string; name: string }) {
    activeChannelId.set(channel.groupId);
    activeHubChannelName.set(channel.groupId === DASHBOARD_CHANNEL_ID ? null : channel.name);
    activeView.set('hub');
    if (type === 'squad' && $activeSquadId) {
      const sid = $activeSquadId;
      lastChannelBySquadId.update((m) => ({ ...m, [sid]: channel.groupId }));
      lastHubChannelNameBySquadId.update((m) => {
        const next = { ...m };
        if (channel.groupId === DASHBOARD_CHANNEL_ID) delete next[sid];
        else next[sid] = channel.name;
        return next;
      });
    } else if (type === 'network' && $activeNetworkId) {
      const nid = $activeNetworkId;
      lastOpenedNetworkId.set(nid);
      lastOpenedNetworkChannelId.set(channel.groupId);
      lastChannelByNetworkId.update((m) => ({ ...m, [nid]: channel.groupId }));
      lastHubChannelNameByNetworkId.update((m) => {
        const next = { ...m };
        if (channel.groupId === DASHBOARD_CHANNEL_ID) delete next[nid];
        else next[nid] = channel.name;
        return next;
      });
    }
  }

  // --- Retry create (announcements) ---
  async function handleRetryCreate() {
    const parent = activeParent;
    if (!parent || !createError || retryingCreate) return;
    const memberIds = $parentPendingCreateMembers[parent.id];
    if (!memberIds?.length) return;
    retryingCreate = true;
    try {
      const { parentId: gid, channels } = await createDefaultParentChannels(memberIds);
      if (type === 'squad') {
        squads.update((list) =>
          list.map((s) =>
            s.id !== parent.id ? s : { ...s, id: gid, channels, updatedAt: Date.now() }
          )
        );
        if (get(activeSquadId) === parent.id) {
          activeSquadId.set(gid);
          activeChannelId.set(gid);
          const hub =
            channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name ?? null;
          activeHubChannelName.set(hub);
        }
        lastChannelBySquadId.update((m) => {
          const next = { ...m };
          delete next[parent.id];
          return { ...next, [gid]: gid };
        });
        lastHubChannelNameBySquadId.update((m) => {
          const next = { ...m };
          delete next[parent.id];
          const hubName =
            channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name ?? '';
          return hubName ? { ...next, [gid]: hubName } : next;
        });
        pendingReadyToast.set({
          text: `${(parent as Squad).name} is ready!`,
          goTo: {
            type: 'squad',
            name: (parent as Squad).name,
            id: gid,
            channelId: gid,
            hubChannelName:
              channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name,
          },
        });
        removeParentCreatingAnnouncements(parent.id);
        parentCreateErrorById.update((m) => {
          const next = { ...m };
          delete next[parent.id];
          return next;
        });
        parentPendingCreateMembers.update((m) => {
          const next = { ...m };
          delete next[parent.id];
          return next;
        });
        const payload = formatSquadInviteMessage({
          type: 'squad_invite',
          squadName: (parent as Squad).name,
          groupId: gid,
        });
        for (const npub of memberIds) {
          try {
            await sendDmMessage(npub, payload);
          } catch (e) {
            console.warn('[ParentNavbar] retry send squad invite DM failed for', npub.slice(0, 20) + '…', e);
          }
        }
      } else {
        networks.update((list) =>
          list.map((n) =>
            n.id !== parent.id ? n : { ...n, id: gid, channels, updatedAt: Date.now() }
          )
        );
        if (get(activeNetworkId) === parent.id) {
          activeNetworkId.set(gid);
          activeChannelId.set(gid);
          lastOpenedNetworkChannelId.set(gid);
          const hub =
            channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name ?? null;
          activeHubChannelName.set(hub);
        }
        lastOpenedNetworkId.set(gid);
        lastChannelByNetworkId.update((m) => {
          const next = { ...m };
          delete next[parent.id];
          return { ...next, [gid]: gid };
        });
        lastHubChannelNameByNetworkId.update((m) => {
          const next = { ...m };
          delete next[parent.id];
          const hubName =
            channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name ?? '';
          return hubName ? { ...next, [gid]: hubName } : next;
        });
        pendingReadyToast.set({
          text: `${(parent as Network).name} is ready!`,
          goTo: {
            type: 'network',
            name: (parent as Network).name,
            id: gid,
            channelId: gid,
            hubChannelName:
              channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name,
          },
        });
        removeParentCreatingAnnouncements(parent.id);
        parentCreateErrorById.update((m) => {
          const next = { ...m };
          delete next[parent.id];
          return next;
        });
        parentPendingCreateMembers.update((m) => {
          const next = { ...m };
          delete next[parent.id];
          return next;
        });
        const payload = formatNetworkInviteMessage({
          type: 'network_invite',
          networkName: (parent as Network).name,
          groupId: gid,
          memberSquads: (parent as Network).memberSquads ?? [],
        });
        for (const npub of memberIds) {
          try {
            await sendDmMessage(npub, payload);
          } catch (e) {
            console.warn('[ParentNavbar] retry send network invite DM failed for', npub.slice(0, 20) + '…', e);
          }
        }
      }
    } catch (e) {
      parentCreateErrorById.update((m) => ({
        ...m,
        [parent.id]: friendlyMessage(getInvokeErrorMessage(e)),
      }));
    } finally {
      retryingCreate = false;
    }
  }

  // --- Create channel modal ---
  let showCreateChannelModal = false;
  let createChannelName = '';
  let selectedNpubs: string[] = [];
  let createChannelError = '';
  let createChannelMemberList: string[] = [];
  let loadingCreateChannelMembers = false;

  function openCreateChannelModal() {
    showCreateChannelModal = true;
    createChannelName = '';
    selectedNpubs = [];
    createChannelError = '';
    createChannelMemberList = [];
    loadCreateChannelMembers();
  }

  async function loadCreateChannelMembers() {
    if (type === 'squad') {
      const parent = $squads.find((s) => s.id === $activeSquadId);
      if (!parent) return;
      loadingCreateChannelMembers = true;
      try {
        createChannelMemberList = await loadMembersForParent(parent, $currentUser?.npub);
      } catch {
        createChannelMemberList = [];
      } finally {
        loadingCreateChannelMembers = false;
      }
    } else {
      const net = $networks.find((n) => n.id === $activeNetworkId);
      if (!net?.channels?.length) {
        createChannelMemberList = [];
        return;
      }
      loadingCreateChannelMembers = true;
      try {
        const allNpubs = new Set<string>();
        const myNpub = $currentUser?.npub;
        for (const ch of uniqueChannelsByGroupIdPreservingOrder(net.channels)) {
          try {
            const result = await getMlsGroupMembers(ch.groupId);
            for (const n of result.members ?? []) {
              if (n !== myNpub) allNpubs.add(n);
            }
          } catch {
            // skip
          }
        }
        createChannelMemberList = [...allNpubs];
      } catch {
        createChannelMemberList = [];
      } finally {
        loadingCreateChannelMembers = false;
      }
    }
  }

  function closeCreateChannelModal() {
    showCreateChannelModal = false;
  }

  function toggleMember(npub: string) {
    selectedNpubs = selectedNpubs.includes(npub)
      ? selectedNpubs.filter((n) => n !== npub)
      : [...selectedNpubs, npub];
  }

  $: canCreateChannel = createChannelName.trim().length > 0 && selectedNpubs.length > 0;

  $: createChannelAllSelected =
    createChannelMemberList.length > 0 &&
    selectedNpubs.length === createChannelMemberList.length &&
    createChannelMemberList.every((n) => selectedNpubs.includes(n));

  function toggleCreateChannelSelectEveryone() {
    if (createChannelAllSelected) {
      selectedNpubs = [];
    } else {
      selectedNpubs = [...createChannelMemberList];
    }
  }

  async function handleCreateChannel() {
    const name = createChannelName.trim();
    if (!name) return;
    if (selectedNpubs.length === 0) {
      createChannelError = 'Select at least one member';
      return;
    }
    const parent = activeParent;
    if (!parent) {
      createChannelError = type === 'squad' ? 'Squad not found' : 'Network not found';
      return;
    }
    createChannelError = '';
    createChannelErrorBanner = '';
    const placeholderId = `creating-${Date.now()}`;
    const placeholderChannel: ChannelType = { name, groupId: placeholderId, order: parent.channels.length };

    if (type === 'squad') {
      squads.update((list) =>
        list.map((s) =>
          s.id !== $activeSquadId ? s : { ...s, channels: [...s.channels, placeholderChannel] }
        )
      );
      activeChannelId.set(placeholderId);
      activeHubChannelName.set(name);
      activeView.set('hub');
      lastChannelBySquadId.update((m) => ({ ...m, [$activeSquadId!]: placeholderId }));
      lastHubChannelNameBySquadId.update((m) => ({ ...m, [$activeSquadId!]: name }));
    } else {
      networks.update((list) =>
        list.map((n) =>
          n.id !== $activeNetworkId ? n : { ...n, channels: [...n.channels, placeholderChannel] }
        )
      );
      activeChannelId.set(placeholderId);
      activeHubChannelName.set(name);
      activeView.set('hub');
      lastOpenedNetworkId.set($activeNetworkId!);
      lastOpenedNetworkChannelId.set(placeholderId);
      lastChannelByNetworkId.update((m) => ({ ...m, [$activeNetworkId!]: placeholderId }));
      lastHubChannelNameByNetworkId.update((m) => ({ ...m, [$activeNetworkId!]: name }));
    }

    closeCreateChannelModal();

    ;(async () => {
      try {
        const groupId = await createGroupChat(name, selectedNpubs);
        if (type === 'squad') {
          const squad = parent as Squad;
          const squadId = get(activeSquadId);
          squads.update((list) =>
            list.map((s) => {
              if (s.id !== squadId) return s;
              const chs = s.channels.map((ch) =>
                ch.groupId === placeholderId ? { name, groupId, order: ch.order } : ch
              );
              return { ...s, channels: chs };
            })
          );
          if (get(activeChannelId) === placeholderId) {
            activeChannelId.set(groupId);
            activeHubChannelName.set(name);
          }
          const announcementsChannel = getAnnouncementsChannel(squad);
          const payload = formatChannelInSquadMessage({
            type: 'channel_in_squad',
            squadName: squad.name,
            announcementsGroupId: announcementsChannel.groupId,
            channelGroupId: groupId,
            channelName: name,
          });
          for (const npub of selectedNpubs) {
            try {
              await sendDmMessage(npub, payload);
            } catch (e) {
              console.warn('[ParentNavbar] send channel_in_squad DM failed for', npub.slice(0, 20) + '…', e);
            }
          }
        } else {
          const network = parent as Network;
          const networkId = get(activeNetworkId);
          networks.update((list) =>
            list.map((n) => {
              if (n.id !== networkId) return n;
              const chs = n.channels.map((ch) =>
                ch.groupId === placeholderId ? { name, groupId, order: ch.order } : ch
              );
              return { ...n, channels: chs };
            })
          );
          if (get(activeChannelId) === placeholderId) {
            activeChannelId.set(groupId);
            activeHubChannelName.set(name);
          }
          if (get(lastOpenedNetworkChannelId) === placeholderId) lastOpenedNetworkChannelId.set(groupId);
          const existingChannelGroupIds = network.channels
            .map((ch) => ch.groupId)
            .filter((gid) => gid !== groupId);
          const payload = formatChannelInNetworkMessage({
            type: 'channel_in_network',
            networkId: network.id,
            networkName: network.name,
            channelGroupId: groupId,
            channelName: name,
            memberSquads: network.memberSquads,
            existingChannelGroupIds,
          });
          for (const npub of selectedNpubs) {
            try {
              await sendDmMessage(npub, payload);
            } catch (e) {
              console.warn('[ParentNavbar] send channel_in_network DM failed for', npub.slice(0, 20) + '…', e);
            }
          }
        }
      } catch (e) {
        createChannelErrorBanner = friendlyMessage(getInvokeErrorMessage(e));
        setTimeout(() => {
          createChannelErrorBanner = '';
        }, 8000);
        if (type === 'squad') {
          const squadId = get(activeSquadId);
          squads.update((list) =>
            list.map((s) => {
              if (s.id !== squadId) return s;
              const chs = s.channels.filter((ch) => ch.groupId !== placeholderId);
              return { ...s, channels: chs };
            })
          );
          if (get(activeChannelId) === placeholderId) {
            const list = get(squads);
            const still = list.find((s) => s.id === squadId);
            const sorted = still?.channels.slice().sort((a, b) => a.order - b.order) ?? [];
            const gid = sorted[0]?.groupId ?? null;
            activeChannelId.set(gid);
            activeHubChannelName.set(gid ? resolveHubChannelNameForGroupSelection(sorted, gid, null) : null);
          }
        } else {
          const networkId = get(activeNetworkId);
          networks.update((list) =>
            list.map((n) => {
              if (n.id !== networkId) return n;
              const chs = n.channels.filter((ch) => ch.groupId !== placeholderId);
              return { ...n, channels: chs };
            })
          );
          if (get(activeChannelId) === placeholderId) {
            const list = get(networks);
            const still = list.find((n) => n.id === networkId);
            const firstCh = still?.channels.slice().sort((a, b) => a.order - b.order)[0];
            const gid = firstCh?.groupId ?? null;
            activeChannelId.set(gid);
            activeHubChannelName.set(gid ? resolveHubChannelNameForGroupSelection(still?.channels ?? [], gid, null) : null);
            lastOpenedNetworkChannelId.set(firstCh?.groupId ?? null);
          }
        }
      }
    })();
  }

  function getMemberDisplayName(npub: string) {
    return getProfileDisplayName($profiles[npub] ?? null) || npub.slice(0, 16) + '…';
  }

  // --- Invite modal ---
  let showInviteModal = false;
  let inviteCandidates: string[] = [];
  let selectedInviteNpubs: string[] = [];
  let inviteByNpub = '';
  let loadingInvite = false;
  let inviteError = '';
  let inviting = false;

  function openInviteModal() {
    showInviteModal = true;
    selectedInviteNpubs = [];
    inviteByNpub = '';
    inviteError = '';
    loadInviteCandidates();
  }

  function toggleInviteCandidate(npub: string) {
    selectedInviteNpubs = selectedInviteNpubs.includes(npub)
      ? selectedInviteNpubs.filter((n) => n !== npub)
      : [...selectedInviteNpubs, npub];
  }

  async function loadInviteCandidates() {
    const parent = activeParent;
    if (!parent) return;
    loadingInvite = true;
    try {
      const inParent = new Set(await loadMembersForParent(parent, undefined));
      const dmListSnap = $dmList;
      const requestsSnap = $requestsList;
      const pendingSnap = $pendingList;
      const allDmNpubs = [...dmListSnap, ...requestsSnap, ...pendingSnap].map((e) => e.npub);
      const uniqueNpubs = [...new Set(allDmNpubs)];
      inviteCandidates = uniqueNpubs.filter((npub) => !inParent.has(npub));
    } catch {
      inviteCandidates = [];
    } finally {
      loadingInvite = false;
    }
  }

  function closeInviteModal() {
    if (!inviting) showInviteModal = false;
  }

  async function handleInvite() {
    const parent = activeParent;
    if (!parent) return;
    const extraNpub = inviteByNpub.trim();
    const npubsToInvite = [
      ...selectedInviteNpubs,
      ...(extraNpub && extraNpub.startsWith('npub1') ? [extraNpub] : []),
    ];
    if (npubsToInvite.length === 0) {
      inviteError =
        extraNpub
          ? 'Please enter a valid npub (starts with npub1) or pick from the list.'
          : 'Select at least one person or enter an npub.';
      return;
    }
    if (extraNpub && !extraNpub.startsWith('npub1')) {
      inviteError = 'Please enter a valid npub (starts with npub1) or pick from the list.';
      return;
    }
    inviteError = '';
    inviteErrorBanner = '';
    showInviteModal = false;
    inviting = true;
    const announcementsChannel = getAnnouncementsChannel(parent);
    const inviteTargets = defaultParentInvitePhysicalGroupTargets(parent);
    const groupId = announcementsChannel.groupId;

    ;(async () => {
      let lastErr = '';
      if (type === 'squad') {
        const squad = parent as Squad;
        const payload = formatSquadInviteMessage({
          type: 'squad_invite',
          squadName: squad.name,
          groupId,
        });
        for (const npub of npubsToInvite) {
          for (const ch of inviteTargets) {
            try {
              await inviteMemberToGroup(ch.groupId, npub);
            } catch (e) {
              console.warn('[ParentNavbar] invite to squad MLS channel failed for', npub.slice(0, 20) + '…', e);
              lastErr = friendlyMessage(getInvokeErrorMessage(e));
            }
          }
          try {
            await sendDmMessage(npub, payload);
          } catch (e) {
            console.warn('[ParentNavbar] invite to squad failed for', npub.slice(0, 20) + '…', e);
            lastErr = friendlyMessage(getInvokeErrorMessage(e));
          }
        }
      } else {
        const network = parent as Network;
        const payload = formatNetworkInviteMessage({
          type: 'network_invite',
          networkName: network.name,
          groupId,
          memberSquads: network.memberSquads ?? [],
        });
        for (const npub of npubsToInvite) {
          for (const ch of inviteTargets) {
            try {
              await inviteMemberToGroup(ch.groupId, npub);
            } catch (e) {
              lastErr = friendlyMessage(getInvokeErrorMessage(e));
            }
          }
          try {
            await sendDmMessage(npub, payload);
          } catch (e) {
            lastErr = friendlyMessage(getInvokeErrorMessage(e));
          }
        }
      }
      if (lastErr) {
        inviteErrorBanner = lastErr;
        setTimeout(() => {
          inviteErrorBanner = '';
        }, 8000);
      }
      inviting = false;
    })();
  }

  // --- Exit parent modal (squad or network) ---
  let showExitModal = false;
  let exitError = '';

  function showChangeEvmSignerPlaceholder() {
    if (!canShowParentMenuActions || !activeParent) return;
    showToast(
      'Set your squad signer under Settings → Default wallet config (Edit).'
    );
  }

  function openExitModal() {
    showExitModal = true;
    exitError = '';
  }

  function closeExitModal() {
    showExitModal = false;
  }

  /** Optimistic exit: update UI immediately, leave MLS groups in background; revert + toast on failure. */
  function handleExitParent() {
    if (type === 'squad') {
      const squad = $squads.find((s) => s.id === $activeSquadId);
      if (!squad) return;
      const wasActive = $activeSquadId === squad.id;
      const previousChannelId = $activeChannelId;

      squads.update((list) => list.filter((s) => s.id !== squad.id));
      if (wasActive) {
        activeSquadId.set(null);
        activeChannelId.set(null);
        activeHubChannelName.set(null);
      }
      showExitModal = false;
      exitError = '';

      (async () => {
        try {
          for (const ch of uniqueChannelsByGroupIdPreservingOrder(squad.channels)) {
            await leaveMlsGroup(ch.groupId);
          }
        } catch (e) {
          const msg = friendlyMessage(getInvokeErrorMessage(e));
          squads.update((list) => [...list, squad]);
          if (wasActive) {
            activeSquadId.set(squad.id);
            const gid = previousChannelId ?? squad.channels[0]?.groupId ?? null;
            activeChannelId.set(gid);
            activeHubChannelName.set(
              gid
                ? resolveHubChannelNameForGroupSelection(
                    squad.channels,
                    gid,
                    get(lastHubChannelNameBySquadId)[squad.id] || null
                  )
                : null
            );
          }
          showToast(`Could not exit squad "${squad.name}": ${msg}`);
        }
      })();
    } else {
      const network = $networks.find((n) => n.id === $activeNetworkId);
      if (!network) return;
      const wasActive = $activeNetworkId === network.id;
      const previousChannelId = $activeChannelId;

      networks.update((list) => list.filter((n) => n.id !== network.id));
      if (wasActive) {
        activeNetworkId.set(null);
        activeChannelId.set(null);
        activeHubChannelName.set(null);
        lastOpenedNetworkId.set(null);
        lastOpenedNetworkChannelId.set(null);
        lastChannelByNetworkId.update((m) => {
          const next = { ...m };
          delete next[network.id];
          return next;
        });
      }
      showExitModal = false;
      exitError = '';

      (async () => {
        try {
          for (const ch of uniqueChannelsByGroupIdPreservingOrder(network.channels)) {
            await leaveMlsGroup(ch.groupId);
          }
        } catch (e) {
          const msg = friendlyMessage(getInvokeErrorMessage(e));
          networks.update((list) => [...list, network]);
          if (wasActive) {
            activeNetworkId.set(network.id);
            const gid = previousChannelId ?? network.channels[0]?.groupId ?? null;
            activeChannelId.set(gid);
            activeHubChannelName.set(
              gid
                ? resolveHubChannelNameForGroupSelection(
                    network.channels,
                    gid,
                    get(lastHubChannelNameByNetworkId)[network.id] || null
                  )
                : null
            );
            lastOpenedNetworkId.set(network.id);
            lastOpenedNetworkChannelId.set(previousChannelId ?? network.channels[0]?.groupId ?? null);
            lastChannelByNetworkId.update((m) => ({
              ...m,
              [network.id]: previousChannelId ?? network.channels[0]?.groupId ?? '',
            }));
          }
          showToast(`Could not exit network "${network.name}": ${msg}`);
        }
      })();
    }
  }
</script>

<ParentSidebar
  type={type}
  parentName={activeParent?.name ?? ''}
  subheading={subheading}
  channels={channels}
  activeChannelId={$activeChannelId}
  activeHubChannelName={$activeHubChannelName}
  activeView={$activeView}
  creating={Boolean(creating)}
  createError={createError}
  canRetryCreate={Boolean(canRetryCreate)}
  retryingCreate={retryingCreate}
  emptyMessage={emptyMessage}
  hasParent={!!activeParent}
  errorBanners={errorBanners}
  onDismissBanner={onDismissBanner}
  onSelectChannel={selectChannel}
  onCreateChannel={openCreateChannelModal}
  onRetryCreate={handleRetryCreate}
  onInvite={openInviteModal}
  onChangeEvmSigner={canShowParentMenuActions ? showChangeEvmSignerPlaceholder : undefined}
  onExitSquad={type === 'squad' ? openExitModal : undefined}
  onExitNetwork={type === 'network' ? openExitModal : undefined}
/>

<CreateChannelModal
  open={showCreateChannelModal}
  parentType={type}
  parentName={activeParent?.name ?? ''}
  subtitle={"Add a channel to " + (activeParent?.name ?? (type === 'squad' ? 'this squad' : 'this network')) + ". Choose a name and at least one member."}
  membersLabel={type === 'squad' ? 'Members (squad announcements only, select at least one)' : 'Members (from network squads, select at least one)'}
  bind:channelName={createChannelName}
  memberList={createChannelMemberList}
  loading={loadingCreateChannelMembers}
  bind:selectedNpubs={selectedNpubs}
  selectAllLabel={type === 'squad' ? 'Add everyone in squad' : 'Add everyone in network'}
  emptyMessage={type === 'squad' ? 'Invite people to the squad (announcements) first to add them to new channels.' : "No members in this network's channels yet."}
  error={createChannelError}
  creating={false}
  canCreate={canCreateChannel}
  onClose={closeCreateChannelModal}
  onCreate={handleCreateChannel}
  onToggleMember={toggleMember}
  onToggleSelectAll={toggleCreateChannelSelectEveryone}
  getMemberDisplayName={getMemberDisplayName}
/>

<InviteToParentModal
  open={showInviteModal}
  parentType={type}
  parentName={activeParent?.name ?? ''}
  title={type === 'squad' ? 'Invite to Squad' : 'Invite to Network'}
  subtitle={"Invite friends to " + (activeParent?.name ?? (type === 'squad' ? 'this Squad' : 'this Network')) + "."}
  candidates={inviteCandidates}
  bind:selectedNpubs={selectedInviteNpubs}
  bind:inviteByNpub={inviteByNpub}
  loading={loadingInvite}
  emptyMessage={"No one to invite right now. Start a DM with someone first, or they may already be in this " + (type === 'squad' ? 'Squad' : 'Network') + "."}
  error={inviteError}
  inviting={inviting}
  onClose={closeInviteModal}
  onInvite={handleInvite}
  onToggleCandidate={toggleInviteCandidate}
  getCandidateDisplayName={getMemberDisplayName}
/>

<ExitParentModal
  open={showExitModal}
  type={type}
  parentName={activeParent?.name ?? ''}
  error={exitError}
  exiting={false}
  onClose={closeExitModal}
  onConfirm={handleExitParent}
/>
