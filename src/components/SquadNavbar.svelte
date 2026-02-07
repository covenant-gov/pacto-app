<script lang="ts">
  import Channel from './Channel.svelte';
  import { squads, activeSquadId, activeChannelId, activeView, pendingMlsWelcomes, ungroupedChannels, type Channel as ChannelType } from '../stores/app';
  import { createGroupChat, acceptMlsWelcome, getMlsGroupMembers } from '../lib/api/nostr';
  import { getInvokeErrorMessage, friendlyMessage } from '../lib/utils/tauri-errors';
  import { getProfileDisplayName } from '../lib/utils/profile';
  import { profiles } from '../stores/profiles';
  import { currentUser } from '../stores/auth';

  $: activeSquad = $squads.find(c => c.id === $activeSquadId);
  $: channels = activeSquad?.channels || [];

  function selectChannel(channelId: string) {
    $activeChannelId = channelId;
    $activeView = 'hub';
  }

  let width = 240;
  let isResizing = false;
  const minWidth = 180;
  const maxWidth = 400;

  function startResize() {
    isResizing = true;
  }

  function onMouseMove(event: MouseEvent) {
    if (!isResizing) return;
    const newWidth = event.clientX - 64;
    width = Math.max(minWidth, Math.min(maxWidth, newWidth));
  }

  function stopResize() {
    isResizing = false;
  }

  let showCreateChannelModal = false;
  let createChannelName = '';
  let selectedNpubs: string[] = [];
  let createChannelError = '';
  let creating = false;
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
    const squad = $squads.find((s) => s.id === $activeSquadId);
    const announcementsChannel = squad?.channels[0];
    if (!announcementsChannel) {
      createChannelMemberList = [];
      return;
    }
    loadingCreateChannelMembers = true;
    try {
      const result = await getMlsGroupMembers(announcementsChannel.groupId);
      const myNpub = $currentUser?.npub;
      createChannelMemberList = (result.members ?? []).filter((n) => n !== myNpub);
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

  async function handleCreateChannel() {
    const name = createChannelName.trim();
    if (!name) return;
    if (selectedNpubs.length === 0) {
      createChannelError = 'Select at least one member';
      return;
    }
    creating = true;
    createChannelError = '';
    try {
      const groupId = await createGroupChat(name, selectedNpubs);
      const squad = $squads.find((s) => s.id === $activeSquadId);
      if (!squad) {
        createChannelError = 'Squad not found';
        return;
      }
      const newChannel: ChannelType = {
        id: groupId,
        name,
        groupId,
        order: squad.channels.length,
      };
      squads.update((list) =>
        list.map((s) =>
          s.id !== $activeSquadId ? s : { ...s, channels: [...s.channels, newChannel] }
        )
      );
      $activeChannelId = groupId;
      $activeView = 'hub';
      closeCreateChannelModal();
    } catch (e) {
      createChannelError = friendlyMessage(getInvokeErrorMessage(e));
    } finally {
      creating = false;
    }
  }

  function displayName(npub: string, fallbackName?: string) {
    return fallbackName?.trim() || getProfileDisplayName($profiles[npub] ?? null) || npub.slice(0, 16) + '…';
  }

  let acceptingWelcomeId: string | null = null;
  let inviteError = '';
  async function handleAcceptInvite(welcome: { id: string }) {
    if (acceptingWelcomeId) return;
    acceptingWelcomeId = welcome.id;
    inviteError = '';
    try {
      await acceptMlsWelcome(welcome.id);
    } catch (e) {
      inviteError = friendlyMessage(getInvokeErrorMessage(e));
    } finally {
      acceptingWelcomeId = null;
    }
  }

  function selectUngroupedChannel(groupId: string) {
    $activeSquadId = null;
    $activeChannelId = groupId;
    $activeView = 'hub';
  }
</script>

<svelte:window 
  on:mousemove={onMouseMove} 
  on:mouseup={stopResize}
/>

<div class="squad-navbar" style="width: {width}px;">
  {#if $pendingMlsWelcomes.length > 0}
    <div class="invites-section">
      <h3 class="section-title">Pending invites</h3>
      {#if inviteError}
        <p class="invite-error">{inviteError}</p>
      {/if}
      <ul class="invites-list">
        {#each $pendingMlsWelcomes as welcome (welcome.id)}
          <li class="invite-item">
            <span class="invite-name">{welcome.group_name || 'Unnamed group'}</span>
            <button
              type="button"
              class="invite-accept-btn"
              on:click={() => handleAcceptInvite(welcome)}
              disabled={acceptingWelcomeId === welcome.id}
            >
              {acceptingWelcomeId === welcome.id ? 'Accepting…' : 'Accept'}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if $ungroupedChannels.length > 0}
    <div class="ungrouped-section">
      <h3 class="section-title">Ungrouped</h3>
      <div class="channel-list">
        {#each $ungroupedChannels as channel (channel.groupId)}
          <div
            on:click={() => selectUngroupedChannel(channel.groupId)}
            on:keydown={(e) => e.key === 'Enter' && selectUngroupedChannel(channel.groupId)}
            role="button"
            tabindex="0"
          >
            <Channel
              name={channel.name}
              type="text"
              active={$activeView === 'hub' && !$activeSquadId && $activeChannelId === channel.groupId}
            />
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if activeSquad}
    <div class="squad-header">
      <h2 class="squad-name">{activeSquad.name}</h2>
    </div>

    <div class="channels-container">
      <div class="channel-list">
        {#each channels as channel}
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
  {:else}
    <div class="empty-state">
      <p>Select a squad</p>
    </div>
  {/if}
  
  <button 
    class="resize-handle" 
    on:mousedown={startResize}
    aria-label="Resize sidebar"
    type="button"
  ></button>
</div>

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
      aria-labelledby="create-channel-title"
      tabindex="0"
    >
      <h2 id="create-channel-title">Create channel</h2>
      <p class="create-channel-subtitle">Add a channel to {activeSquad?.name ?? 'this squad'}. Choose a name and at least one member.</p>
      <form on:submit|preventDefault={handleCreateChannel}>
        <label class="create-channel-label" for="channel-name">Channel name</label>
        <input
          id="channel-name"
          type="text"
          class="create-channel-input"
          placeholder="e.g. general"
          bind:value={createChannelName}
          required
        />
        <span class="create-channel-label">Members (squad announcements only, select at least one)</span>
        <div class="create-channel-members">
          {#if loadingCreateChannelMembers}
            <p class="create-channel-loading">Loading squad members…</p>
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
          <p class="create-channel-empty-friends">Invite people to the squad (announcements) first to add them to new channels.</p>
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
  .squad-navbar {
    height: 100%;
    background-color:#202020;
    display: flex;
    flex-direction: column;
    position: relative;
    flex-shrink: 0;
    border-left: 1px solid #313338;
  }

  .section-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: #80848e;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    margin: 0 0 8px 0;
    padding: 0 12px;
  }

  .invites-section,
  .ungrouped-section {
    padding: 12px 0 8px;
    border-bottom: 1px solid #313338;
  }

  .invites-list {
    list-style: none;
    margin: 0;
    padding: 0 8px;
  }

  .invite-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 4px;
    border-radius: 4px;
  }

  .invite-item:hover {
    background: #35373c;
  }

  .invite-name {
    font-size: 0.9375rem;
    color: #f2f3f5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .invite-accept-btn {
    flex-shrink: 0;
    padding: 4px 10px;
    font-size: 0.8125rem;
    background: #5865f2;
    border: none;
    border-radius: 6px;
    color: #fff;
    cursor: pointer;
  }

  .invite-accept-btn:hover:not(:disabled) {
    background: #4752c4;
  }

  .invite-accept-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .invite-error {
    font-size: 0.8125rem;
    color: #f23f42;
    margin: 0 12px 8px;
  }

  .ungrouped-section .channel-list {
    padding: 0 8px;
  }

  .squad-header {
    height: 48px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid #313338;
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
  }

  .squad-name {
    font-size: 1rem;
    font-weight: 600;
    color: #f2f3f5;
    margin: 0;
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

  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #949ba4;
    font-size: 0.875rem;
  }

  .resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    width: 4px;
    height: 100%;
    cursor: ew-resize;
    background-color: transparent;
    transition: background-color 0.15s;
    border: none;
    padding: 0;
    outline: none;
  }

  .resize-handle:hover,
  .resize-handle:focus {
    background-color: #5865f2;
  }

  .create-channel-btn {
    width: 100%;
    margin-top: 8px;
    padding: 8px 12px;
    background: transparent;
    border: 1px dashed #404249;
    border-radius: 4px;
    color: #949ba4;
    font-size: 0.875rem;
    cursor: pointer;
    text-align: left;
  }

  .create-channel-btn:hover {
    background: #35373c;
    color: #dbdee1;
    border-color: #4e5058;
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
    background: #2b2d31;
    border-radius: 12px;
    padding: 32px;
    max-width: 420px;
    width: 90%;
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .create-channel-content h2 {
    color: #f2f3f5;
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0 0 8px 0;
  }

  .create-channel-subtitle {
    color: #949ba4;
    font-size: 0.9375rem;
    margin: 0 0 24px 0;
  }

  .create-channel-label {
    display: block;
    color: #b5bac1;
    font-size: 0.875rem;
    margin-bottom: 6px;
  }

  .create-channel-input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    margin-bottom: 16px;
    background: #1e1f22;
    border: 1px solid #404249;
    border-radius: 8px;
    color: #f2f3f5;
    font-size: 0.9375rem;
  }

  .create-channel-members {
    max-height: 200px;
    overflow-y: auto;
    margin-bottom: 16px;
    padding: 8px 0;
    border: 1px solid #404249;
    border-radius: 8px;
    background: #1e1f22;
  }

  .create-channel-member-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    cursor: pointer;
    color: #f2f3f5;
    font-size: 0.9375rem;
  }

  .create-channel-member-row:hover {
    background: #35373c;
  }

  .create-channel-member-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .create-channel-loading,
  .create-channel-empty-friends {
    color: #949ba4;
    font-size: 0.875rem;
    margin: 0 0 16px 0;
  }

  .create-channel-loading {
    padding: 8px 12px;
  }

  .create-channel-error {
    color: #f23f42;
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
    border: 1px solid #404249;
    border-radius: 8px;
    color: #b5bac1;
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .create-channel-btn-cancel:hover:not(:disabled) {
    background: #36373d;
    color: #f2f3f5;
  }

  .create-channel-btn-create {
    padding: 8px 16px;
    background: #5865f2;
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .create-channel-btn-create:hover:not(:disabled) {
    background: #4752c4;
  }

  .create-channel-btn-create:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
