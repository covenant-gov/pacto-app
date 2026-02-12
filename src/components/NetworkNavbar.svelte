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
    type Channel as ChannelType,
  } from '../stores/app';
  import { createGroupChat, getMlsGroupMembers, sendDmMessage, formatChannelInNetworkMessage } from '../lib/api/nostr';
  import { getInvokeErrorMessage, friendlyMessage } from '../lib/utils/tauri-errors';
  import { getProfileDisplayName } from '../lib/utils/profile';
  import { profiles } from '../stores/profiles';
  import { currentUser } from '../stores/auth';

  $: activeNetwork = $networks.find((n) => n.id === $activeNetworkId);
  $: channels = activeNetwork?.channels ?? [];
  $: sortedChannels = [...channels].sort((a, b) => a.order - b.order);
  $: memberSquadsLabel =
    activeNetwork?.memberSquads?.length
      ? activeNetwork.memberSquads.map((s) => s.name).join(', ')
      : '';

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

  function selectNetwork(networkId: string) {
    const net = $networks.find((n) => n.id === networkId);
    if (!net) return;
    activeNetworkId.set(networkId);
    lastOpenedNetworkId.set(networkId);
    const firstChannel = net.channels.slice().sort((a, b) => a.order - b.order)[0];
    if (firstChannel) {
      activeChannelId.set(firstChannel.groupId);
      lastOpenedNetworkChannelId.set(firstChannel.groupId);
    }
    activeView.set('hub');
  }

  function selectChannel(channelGroupId: string) {
    activeChannelId.set(channelGroupId);
    activeView.set('hub');
    lastOpenedNetworkChannelId.set(channelGroupId);
    if ($activeNetworkId) lastOpenedNetworkId.set($activeNetworkId);
  }

</script>

<ResizableSidebar sidebarClass="network-navbar">
  {#if activeNetwork}
    <div class="network-heading" role="region" aria-label="Network {activeNetwork.name}">
      <h2 class="network-name">{activeNetwork.name}</h2>
      {#if memberSquadsLabel}
        <p class="network-subheading">{memberSquadsLabel}</p>
      {/if}
    </div>
    <div class="channels-container">
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
      <button
        type="button"
        class="create-channel-btn"
        on:click={openCreateChannelModal}
      >
        + Create channel
      </button>
    </div>
  {:else if $networks.length > 0}
    <div class="network-list">
      <p class="network-list-label">Networks</p>
      {#each $networks as network (network.id)}
        <button
          type="button"
          class="network-list-item"
          on:click={() => selectNetwork(network.id)}
          on:keydown={(e) => e.key === 'Enter' && selectNetwork(network.id)}
        >
          {network.name}
        </button>
      {/each}
    </div>
  {:else}
    <div class="empty-state">
      <p>No networks</p>
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

  .network-list {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
  }

  .network-list-label {
    margin: 0 0 8px 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .network-list-item {
    display: block;
    width: 100%;
    padding: 8px 12px;
    margin: 2px 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 0.9375rem;
    text-align: left;
    cursor: pointer;
  }

  .network-list-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
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
