<script lang="ts">
  import Tab from '../ui/Tab.svelte';
  import Modal from '../ui/Modal.svelte';
  import settingsIcon from '../../icons/settings.svg';
  import plusCircleIcon from '../../icons/plus-circle.svg';
  import minusCircleIcon from '../../icons/minus-circle.svg';
  import friendsIcon from '../../icons/friends.svg';
  import requestsIcon from '../../icons/requests.svg';
  import pendingIcon from '../../icons/pending.svg';
  import pinIcon from '../../icons/pin.svg';
  import searchIcon from '../../icons/search.svg';
  import { get } from 'svelte/store';
  import { squads, networks, activeSquadId, activeChannelId, activeHubChannelName, activeView, activeTopNavTab, activeDmTab, activeDmId, activeNetworkId, lastOpenedSquadId, lastOpenedChannelId, lastOpenedNetworkId, lastOpenedNetworkChannelId, lastChannelBySquadId, lastChannelByNetworkId, lastHubChannelNameBySquadId, lastHubChannelNameByNetworkId, composingNewChat, dmList, pinnedList, addParentCreatingAnnouncements, removeParentCreatingAnnouncements, parentCreateErrorById, parentPendingCreateMembers, ANNOUNCEMENTS_CHANNEL_NAME, DASHBOARD_CHANNEL_ID, type TopNavTab, type DmTab, type Squad, type Channel, type Network } from '../../stores/app';
  import { currentUser } from '../../stores/auth';
  import { createGroupChat, getMlsGroupMembers, sendDmMessage, formatSquadInviteMessage, formatNetworkInviteMessage } from '../../lib/api/nostr';
  import { createDefaultParentChannels } from '../../lib/parent-navbar';
  import { resolveHubChannelNameForGroupSelection } from '../../lib/mls/virtual-channel-bucket';
  import { pendingReadyToast } from '../../stores/toast';
  import { getInvokeErrorMessage, friendlyMessage } from '../../lib/utils/tauri-errors';
  import { getProfileDisplayName } from '../../lib/utils/profile';
  import { profiles } from '../../stores/profiles';

  function selectSquad(squadId: string) {
    const squad = $squads.find((s) => s.id === squadId);
    if (!squad) return;
    const sortedChannels = [...squad.channels].sort((a, b) => a.order - b.order);
    const firstChannel = sortedChannels[0];
    const lastChannelId = $lastChannelBySquadId[squadId];
    let nextChannelGroupId: string | null = null;
    if (lastChannelId === DASHBOARD_CHANNEL_ID) {
      // Remember #dashboard as a first-class "channel" choice
      nextChannelGroupId = DASHBOARD_CHANNEL_ID;
    } else if (lastChannelId && sortedChannels.some((c) => c.groupId === lastChannelId)) {
      nextChannelGroupId = lastChannelId;
    } else {
      nextChannelGroupId = firstChannel?.groupId ?? null;
    }
    $activeSquadId = squadId;
    $activeChannelId = nextChannelGroupId;
    if (nextChannelGroupId === DASHBOARD_CHANNEL_ID || nextChannelGroupId === null) {
      activeHubChannelName.set(null);
    } else {
      activeHubChannelName.set(
        resolveHubChannelNameForGroupSelection(
          sortedChannels,
          nextChannelGroupId,
          get(lastHubChannelNameBySquadId)[squadId] || null
        )
      );
    }
    $activeView = 'hub';
  }

  function selectNetwork(networkId: string) {
    const net = $networks.find((n) => n.id === networkId);
    if (!net) return;
    const sortedChannels = [...net.channels].sort((a, b) => a.order - b.order);
    const firstChannel = sortedChannels[0];
    const lastChannelId = $lastChannelByNetworkId[networkId];
    let nextChannelGroupId: string | null = null;
    if (lastChannelId === DASHBOARD_CHANNEL_ID) {
      nextChannelGroupId = DASHBOARD_CHANNEL_ID;
    } else if (lastChannelId && sortedChannels.some((c) => c.groupId === lastChannelId)) {
      nextChannelGroupId = lastChannelId;
    } else {
      nextChannelGroupId = firstChannel?.groupId ?? null;
    }
    $activeNetworkId = networkId;
    $lastOpenedNetworkId = networkId;
    $activeChannelId = nextChannelGroupId;
    if (nextChannelGroupId === DASHBOARD_CHANNEL_ID || nextChannelGroupId === null) {
      activeHubChannelName.set(null);
    } else {
      activeHubChannelName.set(
        resolveHubChannelNameForGroupSelection(
          sortedChannels,
          nextChannelGroupId,
          get(lastHubChannelNameByNetworkId)[networkId] || null
        )
      );
    }
    if ($activeChannelId) $lastOpenedNetworkChannelId = $activeChannelId;
    $activeView = 'hub';
  }

  function selectDmTab(tab: DmTab) {
    $activeDmTab = tab;
    $activeView = 'hub';
    $composingNewChat = false;
  }

  function startNewChat() {
    $composingNewChat = true;
    $activeView = 'hub';
    $activeDmTab = 'pending';
    $activeDmId = null;
  }

  function openProfile() {
    $activeView = 'profile';
    // Keep activeSquadId / activeNetworkId so last selection is restored when leaving Settings.
    $activeChannelId = null;
    activeHubChannelName.set(null);
  }

  const addButtonLabels: Record<TopNavTab, string> = {
    dms: 'Start DM',
    squads: 'Organize Squad',
    networks: 'Coordinate Network',
  };
  $: addButtonLabel = addButtonLabels[$activeTopNavTab];

  // Organize Squad modal
  type OrganizeSquadMode = 'from-dms' | 'from-network';
  let organizeSquadMode: OrganizeSquadMode = 'from-dms';
  let showOrganizeSquadModal = false;
  let organizeSquadName = '';
  let organizeSquadIconUrl = '';
  let organizeSquadMembers: string[] = [];
  let organizeSquadError = '';

  // Break: network members for from-network mode (loaded when modal opens)
  let breakNetworkMemberList: { npub: string; name?: string }[] = [];
  let breakNetworkMembersLoading = false;
  let breakNetworkMembersError = '';
  $: activeNetwork = $activeNetworkId ? $networks.find((n) => n.id === $activeNetworkId) ?? null : null;

  /** Every network has an #announcements channel (created with name 'announcements'). */
  function getNetworkAnnouncementsChannel(net: Network) {
    return net.channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME) ?? [...net.channels].sort((a, b) => a.order - b.order)[0];
  }

  async function loadBreakNetworkMembers() {
    const nid = $activeNetworkId;
    const net = nid ? $networks.find((n) => n.id === nid) : null;
    if (!net) return;
    const announcementsChannel = getNetworkAnnouncementsChannel(net);
    breakNetworkMembersLoading = true;
    breakNetworkMembersError = '';
    try {
      const result = await getMlsGroupMembers(announcementsChannel.groupId);
      const members = (result.members ?? []).map((npub) => ({ npub }));
      breakNetworkMemberList = members;
      if (members.length === 0) breakNetworkMembersError = '';
    } catch (e) {
      breakNetworkMembersError = 'Could not load network members. Try again or cancel.';
      breakNetworkMemberList = [];
    } finally {
      breakNetworkMembersLoading = false;
    }
  }

  function openOrganizeSquadModal(mode: OrganizeSquadMode = 'from-dms') {
    organizeSquadMode = mode;
    showOrganizeSquadModal = true;
    organizeSquadName = '';
    organizeSquadIconUrl = '';
    organizeSquadMembers = [];
    organizeSquadError = '';
    breakNetworkMemberList = [];
    breakNetworkMembersError = '';
    if (mode === 'from-network') {
      loadBreakNetworkMembers();
    }
  }

  function openBreakIntoSquadModal() {
    if (!$activeNetworkId) return;
    openOrganizeSquadModal('from-network');
  }

  function closeOrganizeSquadModal() {
    showOrganizeSquadModal = false;
  }

  function toggleOrganizeMember(npub: string) {
    if (organizeSquadMembers.includes(npub)) {
      organizeSquadMembers = organizeSquadMembers.filter((n) => n !== npub);
    } else {
      organizeSquadMembers = [...organizeSquadMembers, npub];
    }
  }

  function organizeMemberDisplayName(npub: string, fallbackName?: string) {
    return fallbackName?.trim() || getProfileDisplayName($profiles[npub] ?? null) || npub.slice(0, 16) + '…';
  }

  function handleCreateSquad() {
    const name = organizeSquadName.trim();
    if (!name) return;
    organizeSquadError = '';
    const myNpub = $currentUser?.npub;
    const memberIds = (organizeSquadMembers || []).filter((n) => n !== myNpub);
    if (memberIds.length === 0) {
      organizeSquadError = 'Select at least one other member to create a squad.';
      return;
    }
    showOrganizeSquadModal = false;
    createParentWithAnnouncements('squad', name, memberIds, {
      iconUrl: organizeSquadIconUrl.trim() || undefined,
      setLastOpenedSquad: organizeSquadMode === 'from-network',
    });
  }

  function handleAddAction() {
    if ($activeTopNavTab === 'squads') {
      openOrganizeSquadModal('from-dms');
    } else if ($activeTopNavTab === 'networks') {
      openCreateNetworkModal();
    }
  }

  $: canCreateSquad =
    organizeSquadName.trim().length > 0 &&
    (organizeSquadMode === 'from-network'
      ? organizeSquadMembers.some((n) => n !== $currentUser?.npub)
      : organizeSquadMembers.length > 0);

  // Create Network modal
  let showCreateNetworkModal = false;
  let createNetworkName = '';
  let createNetworkIconUrl = '';
  let createNetworkSelectedSquadIds: string[] = [];
  let createNetworkError = '';

  function openCreateNetworkModal() {
    showCreateNetworkModal = true;
    createNetworkName = '';
    createNetworkIconUrl = '';
    createNetworkSelectedSquadIds = [];
    createNetworkError = '';
  }

  function closeCreateNetworkModal() {
    showCreateNetworkModal = false;
  }

  function toggleCreateNetworkSquad(squadId: string) {
    if (createNetworkSelectedSquadIds.includes(squadId)) {
      createNetworkSelectedSquadIds = createNetworkSelectedSquadIds.filter((id) => id !== squadId);
    } else {
      createNetworkSelectedSquadIds = [...createNetworkSelectedSquadIds, squadId];
    }
  }

  /** Every squad has an #announcements channel (created with name 'announcements'). */
  function getAnnouncementsChannel(squad: Squad) {
    return squad.channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME) ?? [...squad.channels].sort((a, b) => a.order - b.order)[0];
  }

  function createParentWithAnnouncements(
    type: 'squad' | 'network',
    name: string,
    memberNpubs: string[],
    options: {
      iconUrl?: string;
      setLastOpenedSquad?: boolean;
      memberSquads?: { id: string; name: string }[];
    }
  ) {
    const now = Date.now();
    const tempId = type === 'squad' ? 'creating-squad-' + now : 'creating-network-' + now;

    if (type === 'squad') {
      const squad: Squad = {
        id: tempId,
        name,
        iconUrl: options.iconUrl,
        channels: [],
        createdAt: now,
        updatedAt: now,
      };
      addParentCreatingAnnouncements(squad.id);
      parentPendingCreateMembers.update((m) => ({ ...m, [squad.id]: memberNpubs }));
      squads.update((list) => [...list, squad]);
      activeSquadId.set(squad.id);
      activeChannelId.set(null);
      activeHubChannelName.set(null);
      activeView.set('hub');
      if (options.setLastOpenedSquad) {
        activeTopNavTab.set('squads');
        lastOpenedSquadId.set(squad.id);
      }
      (async () => {
        try {
          const { parentId, channels } = await createDefaultParentChannels(memberNpubs);
          const groupId = parentId;
          squads.update((list) =>
            list.map((s) =>
              s.id !== tempId ? s : { ...s, id: groupId, channels, updatedAt: Date.now() }
            )
          );
          removeParentCreatingAnnouncements(tempId);
          parentCreateErrorById.update((m) => {
            const next = { ...m };
            delete next[tempId];
            return next;
          });
          parentPendingCreateMembers.update((m) => {
            const next = { ...m };
            delete next[tempId];
            return next;
          });
          if (get(activeSquadId) === tempId) {
            activeSquadId.set(groupId);
            activeChannelId.set(groupId);
            const hub =
              channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name ?? null;
            activeHubChannelName.set(hub);
          }
          if (options.setLastOpenedSquad) {
            lastOpenedSquadId.set(groupId);
            lastOpenedChannelId.set(groupId);
            lastChannelBySquadId.update((m) => ({ ...m, [groupId]: groupId }));
            const hubName =
              channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name ?? '';
            if (hubName) lastHubChannelNameBySquadId.update((m) => ({ ...m, [groupId]: hubName }));
          }
          pendingReadyToast.set({
            text: `${name} is ready!`,
            goTo: {
              type: 'squad',
              name,
              id: groupId,
              channelId: groupId,
              hubChannelName:
                channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name,
            },
          });
          const payload = formatSquadInviteMessage({ type: 'squad_invite', squadName: name, groupId });
          for (const npub of memberNpubs) {
            try {
              await sendDmMessage(npub, payload);
            } catch (e) {
              console.warn('[Navbar] send squad invite DM failed for', npub.slice(0, 20) + '…', e);
            }
          }
        } catch (e) {
          console.error(
            '[Navbar] createParentWithAnnouncements(squad): createGroupChat failed',
            {
              tempId,
              name,
              memberCount: memberNpubs.length,
            },
            e
          );
          // Clear "creating" state and record a friendly error for troubleshooting
          removeParentCreatingAnnouncements(tempId);
          parentCreateErrorById.update((m) => ({
            ...m,
            [tempId]: friendlyMessage(getInvokeErrorMessage(e, 'Failed to create squad announcements channel')),
          }));
          // Remove the temporary squad so we do not leave a zombie parent with no channels
          squads.update((list) => list.filter((s) => s.id !== tempId));
          if (get(activeSquadId) === tempId) {
            activeSquadId.set(null);
            activeChannelId.set(null);
            activeHubChannelName.set(null);
          }
        }
      })();
    } else {
      const memberSquads = options.memberSquads ?? [];
      const network: Network = {
        id: tempId,
        name,
        iconUrl: options.iconUrl,
        channels: [],
        memberSquads,
        createdAt: now,
        updatedAt: now,
      };
      addParentCreatingAnnouncements(network.id);
      parentPendingCreateMembers.update((m) => ({ ...m, [network.id]: memberNpubs }));
      networks.update((list) => [...list, network]);
      activeNetworkId.set(network.id);
      lastOpenedNetworkId.set(network.id);
      activeChannelId.set(null);
      activeHubChannelName.set(null);
      activeView.set('hub');
      activeTopNavTab.set('networks');
      (async () => {
        try {
          const { parentId, channels } = await createDefaultParentChannels(memberNpubs);
          const groupId = parentId;
          networks.update((list) =>
            list.map((n) =>
              n.id !== tempId ? n : { ...n, id: groupId, channels, updatedAt: Date.now() }
            )
          );
          removeParentCreatingAnnouncements(tempId);
          parentCreateErrorById.update((m) => {
            const next = { ...m };
            delete next[tempId];
            return next;
          });
          parentPendingCreateMembers.update((m) => {
            const next = { ...m };
            delete next[tempId];
            return next;
          });
          if (get(activeNetworkId) === tempId) {
            activeNetworkId.set(groupId);
            activeChannelId.set(groupId);
            lastOpenedNetworkChannelId.set(groupId);
            const hub =
              channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name ?? null;
            activeHubChannelName.set(hub);
          }
          lastOpenedNetworkId.set(groupId);
          lastChannelByNetworkId.update((m) => ({ ...m, [groupId]: groupId }));
          const hubName =
            channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name ?? '';
          if (hubName) lastHubChannelNameByNetworkId.update((m) => ({ ...m, [groupId]: hubName }));
          pendingReadyToast.set({
            text: `${name} is ready!`,
            goTo: {
              type: 'network',
              name,
              id: groupId,
              channelId: groupId,
              hubChannelName:
                channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name,
            },
          });
          const payload = formatNetworkInviteMessage({
            type: 'network_invite',
            networkName: name,
            groupId,
            memberSquads,
          });
          for (const npub of memberNpubs) {
            try {
              await sendDmMessage(npub, payload);
            } catch (e) {
              console.warn('[Navbar] send network invite DM failed for', npub.slice(0, 20) + '…', e);
            }
          }
        } catch (e) {
          console.error(
            '[Navbar] createParentWithAnnouncements(network): createGroupChat failed',
            {
              tempId,
              name,
              memberCount: memberNpubs.length,
              memberSquads: memberSquads.map((s) => s.id),
            },
            e
          );
          // Clear "creating" state and record a friendly error for troubleshooting
          removeParentCreatingAnnouncements(tempId);
          parentCreateErrorById.update((m) => ({
            ...m,
            [tempId]: friendlyMessage(getInvokeErrorMessage(e, 'Failed to create network announcements channel')),
          }));
          // Remove the temporary network so we do not leave a zombie parent with no channels
          networks.update((list) => list.filter((n) => n.id !== tempId));
          if (get(activeNetworkId) === tempId) {
            activeNetworkId.set(null);
            activeChannelId.set(null);
            activeHubChannelName.set(null);
          }
        }
      })();
    }
  }

  async function handleCreateNetwork() {
    const name = createNetworkName.trim();
    if (!name) return;
    if (createNetworkSelectedSquadIds.length < 2) {
      createNetworkError = 'Select at least two squads to create a network.';
      return;
    }
    createNetworkError = '';
    const myNpub = $currentUser?.npub;
    const selectedSquads = $squads.filter((s) => createNetworkSelectedSquadIds.includes(s.id));
    const squadsWithChannels = selectedSquads.filter((s) => s.channels?.length > 0);
    if (squadsWithChannels.length < 2) {
      createNetworkError =
        selectedSquads.length !== squadsWithChannels.length
          ? 'Some selected squads have no channels yet. Wait for them to finish setting up, or pick different squads.'
          : 'Select at least two squads to create a network.';
      return;
    }
    const memberPromises = squadsWithChannels.map((squad) => {
      const ann = getAnnouncementsChannel(squad);
      if (!ann?.groupId) {
        return Promise.reject(new Error(`Squad "${squad.name}" has no announcements channel`));
      }
      return getMlsGroupMembers(ann.groupId).then((result) => ({ squad, result }));
    });
    let settled: PromiseSettledResult<{ squad: Squad; result: Awaited<ReturnType<typeof getMlsGroupMembers>> }>[];
    try {
      settled = await Promise.allSettled(memberPromises);
    } catch (e) {
      createNetworkError = friendlyMessage(getInvokeErrorMessage(e));
      return;
    }
    const allNpubs = new Set<string>();
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      if (s.status === 'rejected') {
        createNetworkError = `Could not load members for squad "${squadsWithChannels[i].name}". Try again or pick different squads.`;
        return;
      }
      for (const n of s.value.result.members ?? []) {
        if (n !== myNpub) allNpubs.add(n);
      }
    }
    const allMemberNpubs = [...allNpubs];
    if (allMemberNpubs.length === 0) {
      createNetworkError = 'No members found in the selected squads (or you are the only member). Add people to those squads first.';
      return;
    }

    const memberSquads = selectedSquads.map((s) => ({ id: s.id, name: s.name }));
    showCreateNetworkModal = false;
    createParentWithAnnouncements('network', name, allMemberNpubs, {
      iconUrl: createNetworkIconUrl.trim() || undefined,
      memberSquads,
    });
  }

  $: canCreateNetwork =
    createNetworkName.trim().length > 0 && createNetworkSelectedSquadIds.length >= 2;

  $: if (showCreateNetworkModal) {
    setTimeout(() => document.getElementById('network-name')?.focus(), 0);
  }

  $: if (showOrganizeSquadModal) {
    setTimeout(() => document.getElementById('squad-name')?.focus(), 0);
  }

  /* Organize Squad: member list depends on mode. from-dms = Pinned + Friends; from-network = loaded network members */
  $: organizeMemberList =
    organizeSquadMode === 'from-network'
      ? breakNetworkMemberList
      : [...$pinnedList, ...$dmList];
</script>

<div class="navbar">
  {#if $activeView !== 'profile'}
  <div class="tab-list">
    {#if $activeTopNavTab === 'dms'}
      <div 
        on:click={() => selectDmTab('pinned')}
        on:keydown={(e) => e.key === 'Enter' && selectDmTab('pinned')}
        role="button"
        tabindex="0"
      >
        <Tab label="Pinned" icon={pinIcon} active={$activeView === 'hub' && $activeDmTab === 'pinned'} />
      </div>
      <div 
        on:click={() => selectDmTab('friends')}
        on:keydown={(e) => e.key === 'Enter' && selectDmTab('friends')}
        role="button"
        tabindex="0"
      >
        <Tab label="Friends" icon={friendsIcon} active={$activeView === 'hub' && $activeDmTab === 'friends'} />
      </div>
      <div 
        on:click={() => selectDmTab('requests')}
        on:keydown={(e) => e.key === 'Enter' && selectDmTab('requests')}
        role="button"
        tabindex="0"
      >
        <Tab label="Requests" icon={requestsIcon} active={$activeView === 'hub' && $activeDmTab === 'requests'} />
      </div>
      <div 
        on:click={() => selectDmTab('pending')}
        on:keydown={(e) => e.key === 'Enter' && selectDmTab('pending')}
        role="button"
        tabindex="0"
      >
        <Tab label="Pending" icon={pendingIcon} active={$activeView === 'hub' && $activeDmTab === 'pending'} />
      </div>
      <div
        on:click={() => selectDmTab('search')}
        on:keydown={(e) => e.key === 'Enter' && selectDmTab('search')}
        role="button"
        tabindex="0"
      >
        <Tab label="Search" icon={searchIcon} active={$activeView === 'hub' && $activeDmTab === 'search'} />
      </div>
    {:else if $activeTopNavTab === 'squads'}
      {#each $squads as squad}
        <div 
          on:click={() => selectSquad(squad.id)}
          on:keydown={(e) => e.key === 'Enter' && selectSquad(squad.id)}
          role="button"
          tabindex="0"
        >
          <Tab 
            label={squad.name} 
            image={squad.iconUrl ?? ''}
            active={$activeView === 'hub' && $activeSquadId === squad.id}
          />
        </div>
      {/each}
    {:else if $activeTopNavTab === 'networks'}
      {#each $networks as network (network.id)}
        <div
          on:click={() => selectNetwork(network.id)}
          on:keydown={(e) => e.key === 'Enter' && selectNetwork(network.id)}
          role="button"
          tabindex="0"
        >
          <Tab
            label={network.name}
            image={network.iconUrl ?? ''}
            active={$activeView === 'hub' && $activeNetworkId === network.id}
          />
        </div>
      {/each}
    {/if}
  </div>
  {/if}
  {#if $activeView === 'profile'}
  <div class="navbar-spacer" aria-hidden="true"></div>
  {/if}
  <div class="tab-list bottom">
    {#if $activeTopNavTab === 'networks'}
    <div
      class="break-btn-wrapper"
      class:disabled={!$activeNetworkId}
      on:click={() => $activeNetworkId && openBreakIntoSquadModal()}
      on:keydown={(e) => e.key === 'Enter' && $activeNetworkId && openBreakIntoSquadModal()}
      role="button"
      tabindex={$activeNetworkId ? 0 : -1}
      aria-label={$activeNetworkId ? 'Break into Squad' : 'Select a network first.'}
    >
      <Tab label={$activeNetworkId ? 'Break into Squad' : 'Select a network first.'} icon={minusCircleIcon} active={false} />
    </div>
    {/if}
    <div
      on:click={$activeTopNavTab === 'dms' ? startNewChat : handleAddAction}
      on:keydown={(e) => e.key === 'Enter' && ($activeTopNavTab === 'dms' ? startNewChat() : handleAddAction())}
      role="button"
      tabindex="0"
    >
      <Tab label={addButtonLabel} icon={plusCircleIcon} active={false} />
    </div>
    <div
      on:click={openProfile}
      on:keydown={(e) => e.key === 'Enter' && openProfile()}
      role="button"
      tabindex="0"
    >
      <Tab label="Settings" icon={settingsIcon} active={$activeView === 'profile'} />
    </div>
  </div>
</div>

{#if showOrganizeSquadModal}
  <Modal titleId="organize-squad-title" descriptionId="organize-squad-description" onClose={closeOrganizeSquadModal}>
    <h2 id="organize-squad-title">{organizeSquadMode === 'from-network' ? `Break "${activeNetwork?.name ?? 'Network'}" into Squad` : 'Organize Squad'}</h2>
    <p id="organize-squad-description" class="organize-modal-subtitle">
      {#if organizeSquadMode === 'from-network'}
        Select members from this network to form a new squad. Choose a name and at least one member.
      {:else}
        Create a squad with an announcements channel. Select at least one member.
      {/if}
    </p>
    <form on:submit|preventDefault={handleCreateSquad}>
        <label class="organize-label" for="squad-name">Squad name</label>
        <input
          id="squad-name"
          type="text"
          class="organize-input"
          placeholder="e.g. Team Alpha"
          bind:value={organizeSquadName}
          required
        />
        <label class="organize-label" for="squad-icon">Icon URL (optional)</label>
        <input
          id="squad-icon"
          type="url"
          class="organize-input"
          placeholder="https://…"
          bind:value={organizeSquadIconUrl}
        />
        <span class="organize-label">Members for announcements (select at least one)</span>
        {#if organizeSquadMode === 'from-network' && breakNetworkMembersLoading}
          <p class="organize-members-empty">Loading network members…</p>
        {:else if organizeSquadMode === 'from-network' && breakNetworkMembersError}
          <p class="organize-error" role="alert">{breakNetworkMembersError}</p>
        {:else}
          <div class="organize-members">
            {#each organizeMemberList as entry (entry.npub)}
              <label class="organize-member-row">
                <input
                  type="checkbox"
                  checked={organizeSquadMembers.includes(entry.npub)}
                  on:change={() => toggleOrganizeMember(entry.npub)}
                />
                <span class="organize-member-name">{organizeMemberDisplayName(entry.npub, entry.name)}</span>
              </label>
            {/each}
          </div>
          {#if organizeSquadMode === 'from-network'
            ? organizeMemberList.filter((e) => e.npub !== $currentUser?.npub).length === 0
            : organizeMemberList.length === 0}
            <p class="organize-members-empty">
              {#if organizeSquadMode === 'from-network'}
                This network has no other members to add to a squad.
              {:else}
                Add friends in DMs first to create a squad with them.
              {/if}
            </p>
          {/if}
        {/if}
        {#if organizeSquadError}
          <p class="organize-error" role="alert">{organizeSquadError}</p>
        {/if}
        <div class="organize-actions">
          <button type="button" class="organize-btn-cancel" on:click={closeOrganizeSquadModal} aria-label="Cancel">
            Cancel
          </button>
          <button
            type="submit"
            class="organize-btn-create"
            disabled={!canCreateSquad || (organizeSquadMode === 'from-network' && breakNetworkMembersLoading)}
            aria-label={organizeSquadMode === 'from-network' ? 'Create squad from network members' : 'Create squad'}
          >
            Create
          </button>
        </div>
    </form>
  </Modal>
{/if}

{#if showCreateNetworkModal}
  <Modal titleId="create-network-title" descriptionId="create-network-description" onClose={closeCreateNetworkModal}>
    <h2 id="create-network-title">Coordinate Network</h2>
      <p id="create-network-description" class="organize-modal-subtitle">Create a network from two or more squads. Everyone in those squads will be invited.</p>
      <form on:submit|preventDefault={handleCreateNetwork}>
        <label class="organize-label" for="network-name">Network name</label>
        <input
          id="network-name"
          type="text"
          class="organize-input"
          placeholder="e.g. Region East"
          bind:value={createNetworkName}
          required
          aria-required="true"
        />
        <label class="organize-label" for="network-icon">Icon URL (optional)</label>
        <input
          id="network-icon"
          type="url"
          class="organize-input"
          placeholder="https://…"
          bind:value={createNetworkIconUrl}
        />
        <span class="organize-label">Squads (select at least two)</span>
        <div class="organize-members">
          {#each $squads as squad (squad.id)}
            <label class="organize-member-row">
              <input
                type="checkbox"
                checked={createNetworkSelectedSquadIds.includes(squad.id)}
                on:change={() => toggleCreateNetworkSquad(squad.id)}
              />
              <span class="organize-member-name">{squad.name}</span>
            </label>
          {/each}
        </div>
        {#if $squads.length < 2}
          <p class="organize-members-empty">Create at least two squads first to form a network.</p>
        {/if}
        {#if createNetworkError}
          <p class="organize-error" role="alert">{createNetworkError}</p>
        {/if}
        <div class="organize-actions">
          <button type="button" class="organize-btn-cancel" on:click={closeCreateNetworkModal} aria-label="Cancel">
            Cancel
          </button>
          <button type="submit" class="organize-btn-create" disabled={!canCreateNetwork} aria-label="Create network">
            Create
          </button>
        </div>
      </form>
  </Modal>
{/if}

<style>
  .navbar {
    width: 64px;
    height: 100%;
    background-color: var(--bg-panel);
    display: flex;
    flex-direction: column;
    padding-top: 12px;
    padding-bottom: 12px;
    box-sizing: border-box;
    min-height: 0;
  }

  .tab-list {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .tab-list.bottom {
    flex: 0 0 auto;
    padding-bottom: 8px;
  }

  .navbar-spacer {
    flex: 1;
    min-height: 0;
  }

  .break-btn-wrapper.disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: auto;
  }

  /* Modal content (Organize Squad / Create Network) - title styling in Modal.svelte */
  .organize-modal-subtitle {
    color: var(--text-muted);
    font-size: 0.9375rem;
    margin: 0 0 24px 0;
  }

  .organize-label {
    display: block;
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-bottom: 6px;
  }

  .organize-input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    margin-bottom: 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .organize-input::placeholder {
    color: var(--text-muted);
  }

  .organize-members {
    max-height: 180px;
    overflow-y: auto;
    margin-bottom: 16px;
    padding: 8px 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-elevated);
  }

  .organize-member-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    cursor: pointer;
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .organize-member-row:hover {
    background: var(--bg-hover);
  }

  .organize-member-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .organize-members-empty {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0 0 16px 0;
  }

  .organize-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 24px;
  }

  .organize-btn-cancel {
    padding: 8px 16px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-secondary);
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .organize-btn-cancel:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .organize-btn-create {
    padding: 8px 16px;
    background: var(--accent);
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .organize-btn-create:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .organize-btn-create:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .organize-error {
    font-size: 0.875rem;
    color: var(--danger);
    margin: 0 0 16px 0;
  }

</style>