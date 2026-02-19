<script lang="ts">
  import { get } from 'svelte/store';
  import Channel from './Channel.svelte';
  import ResizableSidebar from './ResizableSidebar.svelte';
  import {
    networks,
    activeNetworkId,
    activeChannelId,
    activeView,
    lastOpenedNetworkId,
    lastOpenedNetworkChannelId,
    lastChannelByNetworkId,
    dmList,
    requestsList,
    pendingList,
    networksCreatingAnnouncements,
    networkCreateErrorByNetworkId,
    networkPendingCreateMembers,
    removeNetworkCreatingAnnouncements,
    type Channel as ChannelType,
  } from '../stores/app';
  import {
    createGroupChat,
    getMlsGroupMembers,
    inviteMemberToGroup,
    sendDmMessage,
    formatChannelInNetworkMessage,
    formatNetworkInviteMessage,
  } from '../lib/api/nostr';
  import chevronDownIcon from '../icons/chevron-down.svg';
  import { getInvokeErrorMessage, friendlyMessage } from '../lib/utils/tauri-errors';
  import { showToast } from '../stores/toast';
  import { getProfileDisplayName } from '../lib/utils/profile';
  import { profiles } from '../stores/profiles';
  import { currentUser } from '../stores/auth';

  $: activeNetwork = $networks.find((n) => n.id === $activeNetworkId);
  $: channels = activeNetwork?.channels ?? [];
  $: sortedChannels = [...channels].sort((a, b) => a.order - b.order);
  $: networkCreating = activeNetwork && activeNetwork.channels.length === 0 && $networksCreatingAnnouncements.has(activeNetwork.id);
  $: networkCreateError = activeNetwork ? $networkCreateErrorByNetworkId[activeNetwork.id] ?? '' : '';
  $: canRetryNetworkCreate = activeNetwork && networkCreateError && ($networkPendingCreateMembers[activeNetwork.id]?.length ?? 0) > 0;

  let retryingNetworkCreate = false;
  async function handleRetryNetworkCreate() {
    const net = activeNetwork;
    if (!net || !networkCreateError || retryingNetworkCreate) return;
    const allMemberNpubs = $networkPendingCreateMembers[net.id];
    if (!allMemberNpubs?.length) return;
    retryingNetworkCreate = true;
    try {
      const groupId = await createGroupChat('announcements', allMemberNpubs);
      const announcementsChannel: ChannelType = { name: 'announcements', groupId, order: 0 };
      networks.update((list) =>
        list.map((n) => (n.id !== net.id ? n : { ...n, channels: [announcementsChannel], updatedAt: Date.now() }))
      );
      removeNetworkCreatingAnnouncements(net.id);
      networkCreateErrorByNetworkId.update((m) => {
        const next = { ...m };
        delete next[net.id];
        return next;
      });
      networkPendingCreateMembers.update((m) => {
        const next = { ...m };
        delete next[net.id];
        return next;
      });
      if (get(activeNetworkId) === net.id) {
        activeChannelId.set(groupId);
        lastOpenedNetworkChannelId.set(groupId);
      }
      const payload = formatNetworkInviteMessage({
        type: 'network_invite',
        networkName: net.name,
        groupId,
        memberSquads: net.memberSquads ?? [],
      });
      for (const npub of allMemberNpubs) {
        try {
          await sendDmMessage(npub, payload);
        } catch (e) {
          console.warn('[NetworkNavbar] retry send network invite DM failed for', npub.slice(0, 20) + '…', e);
        }
      }
      showToast(`${net.name} is ready!`, { type: 'network', name: net.name, id: net.id, channelId: groupId });
    } catch (e) {
      networkCreateErrorByNetworkId.update((m) => ({ ...m, [net.id]: friendlyMessage(getInvokeErrorMessage(e)) }));
    } finally {
      retryingNetworkCreate = false;
    }
  }

  $: memberSquadsLabel =
    activeNetwork?.memberSquads?.length
      ? activeNetwork.memberSquads.map((s) => s.name).join(', ')
      : '';

  /** Every network has an #announcements channel (created with name 'announcements'). */
  function getNetworkAnnouncementsChannel(net: NonNullable<typeof activeNetwork>) {
    return net.channels.find((c) => c.name === 'announcements') ?? [...net.channels].sort((a, b) => a.order - b.order)[0];
  }

  let networkMenuOpen = false;
  let showInviteToNetworkModal = false;
  let inviteToNetworkCandidates: string[] = [];
  let loadingInviteToNetwork = false;
  let selectedInviteNpubs: string[] = [];
  let inviteByNpub = '';
  let inviteToNetworkError = '';
  let invitingToNetwork = false;
  let inviteToNetworkErrorBanner = '';

  function openInviteToNetworkModal() {
    networkMenuOpen = false;
    showInviteToNetworkModal = true;
    selectedInviteNpubs = [];
    inviteByNpub = '';
    inviteToNetworkError = '';
    loadInviteToNetworkCandidates();
  }

  function toggleInviteCandidate(npub: string) {
    selectedInviteNpubs = selectedInviteNpubs.includes(npub)
      ? selectedInviteNpubs.filter((n) => n !== npub)
      : [...selectedInviteNpubs, npub];
  }

  async function loadInviteToNetworkCandidates() {
    const net = $networks.find((n) => n.id === $activeNetworkId);
    if (!net) return;
    const announcementsChannel = getNetworkAnnouncementsChannel(net);
    loadingInviteToNetwork = true;
    try {
      const result = await getMlsGroupMembers(announcementsChannel.groupId);
      const inNetwork = new Set(result.members ?? []);
      const dmListSnap = $dmList;
      const requestsSnap = $requestsList;
      const pendingSnap = $pendingList;
      const allDmNpubs = [...dmListSnap, ...requestsSnap, ...pendingSnap].map((e) => e.npub);
      const uniqueNpubs = [...new Set(allDmNpubs)];
      inviteToNetworkCandidates = uniqueNpubs.filter((npub) => !inNetwork.has(npub));
    } catch {
      inviteToNetworkCandidates = [];
    } finally {
      loadingInviteToNetwork = false;
    }
  }

  function closeInviteToNetworkModal() {
    if (!invitingToNetwork) showInviteToNetworkModal = false;
  }

  async function handleInviteToNetwork() {
    const net = $networks.find((n) => n.id === $activeNetworkId);
    if (!net) return;
    const announcementsChannel = getNetworkAnnouncementsChannel(net);
    const extraNpub = inviteByNpub.trim();
    const npubsToInvite = [
      ...selectedInviteNpubs,
      ...(extraNpub && extraNpub.startsWith('npub1') ? [extraNpub] : []),
    ];
    if (npubsToInvite.length === 0) {
      inviteToNetworkError = extraNpub
        ? 'Please enter a valid npub (starts with npub1) or pick from the list.'
        : 'Select at least one person or enter an npub.';
      return;
    }
    if (extraNpub && !extraNpub.startsWith('npub1')) {
      inviteToNetworkError = 'Please enter a valid npub (starts with npub1) or pick from the list.';
      return;
    }
    inviteToNetworkError = '';
    inviteToNetworkErrorBanner = '';
    showInviteToNetworkModal = false;
    invitingToNetwork = true;
    const groupId = announcementsChannel.groupId;
    const networkName = net.name;
    const memberSquads = net.memberSquads ?? [];
    const payload = formatNetworkInviteMessage({
      type: 'network_invite',
      networkName,
      groupId,
      memberSquads,
    });
    (async () => {
      let lastError = '';
      for (const npub of npubsToInvite) {
        try {
          await inviteMemberToGroup(groupId, npub);
          await sendDmMessage(npub, payload);
        } catch (e) {
          lastError = friendlyMessage(getInvokeErrorMessage(e));
        }
      }
      if (lastError) {
        inviteToNetworkErrorBanner = lastError;
        setTimeout(() => {
          inviteToNetworkErrorBanner = '';
        }, 8000);
      }
      invitingToNetwork = false;
    })();
  }

  let showCreateChannelModal = false;
  let createChannelName = '';
  let selectedNpubs: string[] = [];
  let createChannelError = '';
  let creating = false;
  let createChannelMemberList: string[] = [];
  let loadingCreateChannelMembers = false;
  let createChannelErrorBanner = '';

  function openCreateChannelModal() {
    showCreateChannelModal = true;
    createChannelName = '';
    selectedNpubs = [];
    createChannelError = '';
    createChannelMemberList = [];
    loadCreateChannelMembers();
  }

  async function loadCreateChannelMembers() {
    const net = $networks.find((n) => n.id === $activeNetworkId);
    if (!net?.channels?.length) {
      createChannelMemberList = [];
      return;
    }
    loadingCreateChannelMembers = true;
    try {
      const allNpubs = new Set<string>();
      const myNpub = $currentUser?.npub;
      for (const ch of net.channels) {
        try {
          const result = await getMlsGroupMembers(ch.groupId);
          for (const n of result.members ?? []) {
            if (n !== myNpub) allNpubs.add(n);
          }
        } catch {
          // skip this channel
        }
      }
      createChannelMemberList = [...allNpubs];
    } catch {
      createChannelMemberList = [];
    } finally {
      loadingCreateChannelMembers = false;
    }
  }

  function closeCreateChannelModal() {
    if (!creating) showCreateChannelModal = false;
  }

  function toggleMember(npub: string) {
    if (selectedNpubs.includes(npub)) {
      selectedNpubs = selectedNpubs.filter((n) => n !== npub);
    } else {
      selectedNpubs = [...selectedNpubs, npub];
    }
  }

  $: canCreateChannel = createChannelName.trim().length > 0 && selectedNpubs.length > 0;

  /** Derived: checked when every network member is selected. */
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

  function displayName(npub: string) {
    return getProfileDisplayName($profiles[npub] ?? null) || npub.slice(0, 16) + '…';
  }

  async function handleCreateChannel() {
    const name = createChannelName.trim();
    if (!name) return;
    if (selectedNpubs.length === 0) {
      createChannelError = 'Select at least one member';
      return;
    }
    const network = $networks.find((n) => n.id === $activeNetworkId);
    if (!network) {
      createChannelError = 'Network not found';
      return;
    }
    createChannelError = '';
    createChannelErrorBanner = '';
    const placeholderId = `creating-${Date.now()}`;
    const placeholderChannel: ChannelType = {
      name,
      groupId: placeholderId,
      order: network.channels.length,
    };
    networks.update((list) =>
      list.map((n) =>
        n.id !== $activeNetworkId ? n : { ...n, channels: [...n.channels, placeholderChannel] }
      )
    );
    activeChannelId.set(placeholderId);
    activeView.set('hub');
    lastOpenedNetworkId.set(network.id);
    lastOpenedNetworkChannelId.set(placeholderId);
    closeCreateChannelModal();
    creating = false;
    (async () => {
      try {
        const groupId = await createGroupChat(name, selectedNpubs);
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
        if (get(activeChannelId) === placeholderId) activeChannelId.set(groupId);
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
            console.warn('[NetworkNavbar] send channel_in_network DM failed for', npub.slice(0, 20) + '…', e);
          }
        }
      } catch (e) {
        createChannelErrorBanner = friendlyMessage(getInvokeErrorMessage(e));
        setTimeout(() => { createChannelErrorBanner = ''; }, 8000);
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
          activeChannelId.set(firstCh?.groupId ?? null);
          lastOpenedNetworkChannelId.set(firstCh?.groupId ?? null);
        }
      }
    })();
  }

  // If activeNetworkId points to a removed network, select first network
  $: if ($activeNetworkId && $networks.length > 0 && !$networks.find((n) => n.id === $activeNetworkId)) {
    const first = $networks[0];
    const firstCh = first.channels.slice().sort((a, b) => a.order - b.order)[0];
    activeNetworkId.set(first.id);
    activeChannelId.set(firstCh?.groupId ?? null);
    lastOpenedNetworkId.set(first.id);
    if (firstCh) lastOpenedNetworkChannelId.set(firstCh.groupId);
  }

  function selectChannel(channelGroupId: string) {
    activeChannelId.set(channelGroupId);
    activeView.set('hub');
    lastOpenedNetworkChannelId.set(channelGroupId);
    if ($activeNetworkId) {
      lastOpenedNetworkId.set($activeNetworkId);
      lastChannelByNetworkId.update((m) => ({ ...m, [$activeNetworkId]: channelGroupId }));
    }
  }

</script>

<svelte:window
  on:click={(e) => {
    const t = e.target as HTMLElement | null;
    if (networkMenuOpen && t && !t.closest('.network-header-actions')) networkMenuOpen = false;
  }}
/>

<ResizableSidebar sidebarClass="network-navbar">
  {#if activeNetwork}
    <div class="network-heading" role="region" aria-label="Network {activeNetwork.name}">
      <div class="network-header-row">
        <h2 class="network-name">{activeNetwork.name}</h2>
        <div class="network-header-actions">
          <button
            type="button"
            class="network-menu-btn"
            aria-label="Network menu"
            on:click={() => (networkMenuOpen = !networkMenuOpen)}
            aria-haspopup="true"
            aria-expanded={networkMenuOpen}
          >
            <img src={chevronDownIcon} alt="" class="network-menu-chevron" />
          </button>
          {#if networkMenuOpen}
            <div class="network-menu-dropdown" role="menu">
              <button type="button" class="network-menu-item" role="menuitem" on:click={openInviteToNetworkModal}>
                Invite to Network
              </button>
            </div>
          {/if}
        </div>
      </div>
      {#if memberSquadsLabel}
        <p class="network-subheading">{memberSquadsLabel}</p>
      {/if}
    </div>
    {#if inviteToNetworkErrorBanner}
      <div class="invite-to-network-error-banner" role="alert">
        {inviteToNetworkErrorBanner}
        <button type="button" class="invite-to-network-error-dismiss" on:click={() => (inviteToNetworkErrorBanner = '')} aria-label="Dismiss">×</button>
      </div>
    {/if}
    <div class="channels-container">
      {#if networkCreating}
        <div class="network-setting-up" role="status" aria-live="polite">
          {#if networkCreateError}
            <p class="setting-up-error" role="alert" id="network-create-error">{networkCreateError}</p>
            {#if canRetryNetworkCreate}
              <button
                type="button"
                class="setting-up-retry-btn"
                disabled={retryingNetworkCreate}
                on:click={handleRetryNetworkCreate}
                aria-describedby="network-create-error"
              >
                {retryingNetworkCreate ? 'Retrying…' : 'Retry'}
              </button>
            {/if}
          {:else}
            <div class="setting-up-spinner" aria-hidden="true"></div>
            <p class="setting-up-text">Setting up…</p>
          {/if}
        </div>
      {:else}
        <div class="channel-list">
          {#each sortedChannels as channel (channel.groupId)}
            <div
              on:click={() => selectChannel(channel.groupId)}
              on:keydown={(e) => e.key === 'Enter' && selectChannel(channel.groupId)}
              role="button"
              tabindex="0"
            >
              <Channel
                name={channel.name}
                type="text"
                active={$activeView === 'hub' && $activeChannelId === channel.groupId}
              />
            </div>
          {/each}
        </div>
        {#if sortedChannels.length > 0}
          <button
            type="button"
            class="create-channel-btn"
            on:click={openCreateChannelModal}
          >
            + Create channel
          </button>
        {/if}
      {/if}
    </div>
  {:else}
    <div class="empty-state">
      <p>{$networks.length > 0 ? 'Select a network' : 'No networks'}</p>
    </div>
  {/if}
</ResizableSidebar>

{#if createChannelErrorBanner}
  <div class="create-channel-error-banner" role="alert">
    {createChannelErrorBanner}
    <button type="button" class="create-channel-error-dismiss" on:click={() => (createChannelErrorBanner = '')} aria-label="Dismiss">×</button>
  </div>
{/if}

{#if showCreateChannelModal}
  <div
    class="create-channel-overlay"
    on:click={closeCreateChannelModal}
    on:keydown={(e) => e.key === 'Escape' && closeCreateChannelModal()}
    role="button"
    tabindex="-1"
  >
    <div
      class="create-channel-content"
      on:click|stopPropagation
      on:keydown={(e) => e.key === 'Escape' && closeCreateChannelModal()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-channel-network-title"
      tabindex="0"
    >
      <h2 id="create-channel-network-title">Create channel</h2>
      <p class="create-channel-subtitle">Add a channel to {activeNetwork?.name ?? 'this network'}. Choose a name and at least one member.</p>
      <form on:submit|preventDefault={handleCreateChannel}>
        <label class="create-channel-label" for="network-channel-name">Channel name</label>
        <input
          id="network-channel-name"
          type="text"
          class="create-channel-input"
          placeholder="e.g. general"
          bind:value={createChannelName}
          required
        />
        <span class="create-channel-label">Members (from network squads, select at least one)</span>
        <label class="create-channel-select-everyone">
          <input
            type="checkbox"
            checked={createChannelAllSelected}
            on:change={toggleCreateChannelSelectEveryone}
          />
          Add everyone in network
        </label>
        <div class="create-channel-members">
          {#if loadingCreateChannelMembers}
            <p class="create-channel-loading">Loading network members…</p>
          {:else}
            {#each createChannelMemberList as npub (npub)}
              <label class="create-channel-member-row">
                <input
                  type="checkbox"
                  checked={selectedNpubs.includes(npub)}
                  on:change={() => toggleMember(npub)}
                />
                <span class="create-channel-member-name">{displayName(npub)}</span>
              </label>
            {/each}
          {/if}
        </div>
        {#if !loadingCreateChannelMembers && createChannelMemberList.length === 0}
          <p class="create-channel-empty">No members in this network's channels yet.</p>
        {/if}
        {#if createChannelError}
          <p class="create-channel-error" role="alert">{createChannelError}</p>
        {/if}
        <div class="create-channel-actions">
          <button type="button" class="create-channel-btn-cancel" on:click={closeCreateChannelModal} disabled={creating}>
            Cancel
          </button>
          <button type="submit" class="create-channel-btn-create" disabled={!canCreateChannel || creating}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

{#if showInviteToNetworkModal}
  <div
    class="create-channel-overlay"
    on:click={closeInviteToNetworkModal}
    on:keydown={(e) => e.key === 'Escape' && closeInviteToNetworkModal()}
    role="button"
    tabindex="-1"
  >
    <div
      class="create-channel-content"
      on:click|stopPropagation
      on:keydown={(e) => e.key === 'Escape' && closeInviteToNetworkModal()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-to-network-title"
      tabindex="0"
    >
      <h2 id="invite-to-network-title">Invite to Network</h2>
      <p class="create-channel-subtitle">Invite friends to {activeNetwork?.name ?? 'this Network'}.</p>
      {#if loadingInviteToNetwork}
        <p class="create-channel-loading">Loading…</p>
      {:else if inviteToNetworkCandidates.length === 0}
        <p class="create-channel-empty-friends">No one to invite right now. Start a DM with someone first, or they may already be in this Network.</p>
      {:else}
        <div class="create-channel-members">
          {#each inviteToNetworkCandidates as npub (npub)}
            <label class="invite-to-network-row" class:selected={selectedInviteNpubs.includes(npub)}>
              <input
                type="checkbox"
                checked={selectedInviteNpubs.includes(npub)}
                on:change={() => toggleInviteCandidate(npub)}
              />
              <span class="create-channel-member-name">{displayName(npub)}</span>
            </label>
          {/each}
        </div>
      {/if}
      <p class="create-channel-invite-by-npub-label">Or invite by npub:</p>
      <input
        type="text"
        class="create-channel-invite-npub-input"
        placeholder="npub1…"
        bind:value={inviteByNpub}
        disabled={invitingToNetwork}
      />
      {#if inviteToNetworkError}
        <p class="create-channel-error" role="alert">{inviteToNetworkError}</p>
      {/if}
      <div class="create-channel-actions">
        <button type="button" class="create-channel-btn-cancel" on:click={closeInviteToNetworkModal} disabled={invitingToNetwork}>
          Cancel
        </button>
        <button
          type="button"
          class="create-channel-btn-create"
          on:click={handleInviteToNetwork}
          disabled={(selectedInviteNpubs.length === 0 && !inviteByNpub.trim()) || invitingToNetwork}
        >
          {invitingToNetwork ? 'Inviting…' : 'Invite'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(.network-navbar) {
    display: flex;
    flex-direction: column;
    position: relative;
    flex-shrink: 0;
    border-left: 1px solid var(--border-subtle);
  }

  .network-heading {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-subtle);
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
  }

  .network-header-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .network-header-actions {
    position: relative;
    flex-shrink: 0;
  }

  .network-menu-btn {
    padding: 6px 8px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 1.125rem;
    line-height: 1;
    cursor: pointer;
  }

  .network-menu-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .network-menu-chevron {
    width: 18px;
    height: 18px;
    display: block;
    filter: var(--icon-dropdown-filter);
  }

  .network-menu-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    min-width: 160px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: var(--shadow-dropdown);
    z-index: 20;
    padding: 4px 0;
  }

  .network-menu-item {
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

  .network-menu-item:hover {
    background: var(--bg-hover);
  }

  .invite-to-network-error-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(242, 63, 66, 0.15);
    border: 1px solid rgba(242, 63, 66, 0.4);
    border-radius: 6px;
    margin: 8px 12px 0;
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .invite-to-network-error-dismiss {
    margin-left: auto;
    padding: 0 4px;
    background: none;
    border: none;
    color: inherit;
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;
    opacity: 0.8;
  }

  .invite-to-network-error-dismiss:hover {
    opacity: 1;
  }

  .invite-to-network-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    cursor: pointer;
    color: var(--text-primary);
    font-size: 0.9375rem;
    border-radius: 4px;
  }

  .invite-to-network-row input[type="checkbox"] {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    margin: 0;
    cursor: pointer;
    accent-color: var(--accent);
  }

  .invite-to-network-row:hover {
    background: var(--bg-hover);
  }

  .invite-to-network-row.selected {
    background: var(--border);
  }

  .network-name {
    flex: 1;
    min-width: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 4px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .network-subheading {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .channels-container {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .channel-list {
    display: flex;
    flex-direction: column;
  }

  .channel-list > div {
    cursor: pointer;
    border-radius: 4px;
  }

  .network-setting-up {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px 16px;
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .setting-up-spinner {
    width: 28px;
    height: 28px;
    border: 3px solid var(--border-subtle);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: network-setting-up-spin 0.9s linear infinite;
  }

  @keyframes network-setting-up-spin {
    to { transform: rotate(360deg); }
  }

  .setting-up-text {
    margin: 0;
  }

  .setting-up-error {
    margin: 0;
    color: var(--danger);
    font-size: 0.8125rem;
    text-align: center;
  }

  .setting-up-retry-btn {
    margin-top: 4px;
    padding: 6px 12px;
    font-size: 0.8125rem;
    background: var(--accent);
    border: none;
    border-radius: 6px;
    color: #fff;
    cursor: pointer;
  }

  .setting-up-retry-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .setting-up-retry-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .create-channel-btn {
    width: 100%;
    margin-top: 8px;
    padding: 8px 12px;
    background: transparent;
    border: 1px dashed var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 0.875rem;
    cursor: pointer;
    text-align: left;
  }

  .create-channel-btn:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
    border-color: var(--border);
  }

  .create-channel-error-banner {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    color: var(--text-primary);
    font-size: 0.875rem;
    z-index: 1001;
  }

  .create-channel-error-dismiss {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 1.25rem;
    padding: 0 4px;
  }

  .create-channel-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .create-channel-content {
    background: var(--bg-elevated);
    border-radius: 12px;
    padding: 32px;
    max-width: 420px;
    width: 90%;
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .create-channel-content h2 {
    color: var(--text-primary);
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0 0 8px 0;
  }

  .create-channel-subtitle {
    color: var(--text-muted);
    font-size: 0.9375rem;
    margin: 0 0 24px 0;
  }

  .create-channel-label {
    display: block;
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-bottom: 6px;
  }

  .create-channel-select-everyone {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    color: var(--text-secondary);
    font-size: 0.875rem;
    cursor: pointer;
  }

  .create-channel-select-everyone input {
    cursor: pointer;
  }

  .create-channel-input {
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

  .create-channel-members {
    max-height: 200px;
    overflow-y: auto;
    margin-bottom: 16px;
    padding: 8px 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-elevated);
  }

  .create-channel-member-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    cursor: pointer;
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .create-channel-member-row:hover {
    background: var(--bg-hover);
  }

  .create-channel-member-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .create-channel-loading,
  .create-channel-empty {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0 0 16px 0;
  }

  .create-channel-loading {
    padding: 8px 12px;
  }

  .create-channel-empty-friends {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0 0 16px 0;
  }

  .create-channel-invite-by-npub-label {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0 0 6px 0;
  }

  .create-channel-invite-npub-input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 12px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 0.9375rem;
    margin-bottom: 16px;
  }

  .create-channel-invite-npub-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .create-channel-error {
    color: var(--danger);
    background: rgba(242, 63, 66, 0.1);
    padding: 12px 16px;
    border-radius: 8px;
    margin-bottom: 16px;
    font-size: 0.875rem;
  }

  .create-channel-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 24px;
  }

  .create-channel-btn-cancel {
    padding: 8px 16px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-secondary);
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .create-channel-btn-cancel:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .create-channel-btn-create {
    padding: 8px 16px;
    background: var(--accent);
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .create-channel-btn-create:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .create-channel-btn-create:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
