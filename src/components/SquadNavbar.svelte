<script lang="ts">
  import { get } from 'svelte/store';
  import Channel from './Channel.svelte';
  import { squads, activeSquadId, activeChannelId, activeView, dmList, requestsList, pendingList, type Channel as ChannelType } from '../stores/app';
  import { createGroupChat, getMlsGroupMembers, inviteMemberToGroup, sendDmMessage, formatSquadInviteMessage, leaveMlsGroup } from '../lib/api/nostr';
  import { getInvokeErrorMessage, friendlyMessage } from '../lib/utils/tauri-errors';
  import { getProfileDisplayName } from '../lib/utils/profile';
  import { profiles } from '../stores/profiles';
  import { currentUser } from '../stores/auth';
  import chevronDownIcon from '../icons/chevron-down.svg';

  $: activeSquad = $squads.find(c => c.id === $activeSquadId);
  $: channels = activeSquad?.channels || [];

  $: if (typeof console !== 'undefined' && console.log) {
    console.log('[Squads] state', { squadCount: $squads.length, activeSquadId: $activeSquadId, activeChannelId: $activeChannelId, squads: $squads.map((s) => ({ id: s.id, name: s.name, channels: s.channels.length })) });
  }

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

  /** First channel by order = announcements channel for this squad. */
  function getAnnouncementsChannel(s: typeof activeSquad) {
    if (!s?.channels?.length) return undefined;
    return [...s.channels].sort((a, b) => a.order - b.order)[0];
  }

  async function loadCreateChannelMembers() {
    const squad = $squads.find((s) => s.id === $activeSquadId);
    const announcementsChannel = getAnnouncementsChannel(squad);
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

  let createChannelErrorBanner = '';
  async function handleCreateChannel() {
    const name = createChannelName.trim();
    if (!name) return;
    if (selectedNpubs.length === 0) {
      createChannelError = 'Select at least one member';
      return;
    }
    const squad = $squads.find((s) => s.id === $activeSquadId);
    if (!squad) {
      createChannelError = 'Squad not found';
      return;
    }
    createChannelError = '';
    createChannelErrorBanner = '';
    const placeholderId = `creating-${Date.now()}`;
    const placeholderChannel: ChannelType = {
      id: placeholderId,
      name,
      groupId: placeholderId,
      order: squad.channels.length,
    };
    squads.update((list) =>
      list.map((s) =>
        s.id !== $activeSquadId ? s : { ...s, channels: [...s.channels, placeholderChannel] }
      )
    );
    $activeChannelId = placeholderId;
    $activeView = 'hub';
    closeCreateChannelModal();
    creating = false;
    (async () => {
      try {
        const groupId = await createGroupChat(name, selectedNpubs);
        const squadId = get(activeSquadId);
        squads.update((list) =>
          list.map((s) => {
            if (s.id !== squadId) return s;
            const channels = s.channels.map((ch) =>
              ch.groupId === placeholderId
                ? { id: groupId, name, groupId, order: ch.order }
                : ch
            );
            return { ...s, channels };
          })
        );
        if (get(activeChannelId) === placeholderId) activeChannelId.set(groupId);
      } catch (e) {
        createChannelErrorBanner = friendlyMessage(getInvokeErrorMessage(e));
        setTimeout(() => { createChannelErrorBanner = ''; }, 8000);
        const squadId = get(activeSquadId);
        squads.update((list) =>
          list.map((s) => {
            if (s.id !== squadId) return s;
            const channels = s.channels.filter((ch) => ch.groupId !== placeholderId);
            return { ...s, channels };
          })
        );
        if (get(activeChannelId) === placeholderId) {
          const list = get(squads);
          const still = list.find((s) => s.id === squadId);
          activeChannelId.set(still?.channels[0]?.groupId ?? null);
        }
      }
    })();
  }

  function displayName(npub: string, fallbackName?: string) {
    return fallbackName?.trim() || getProfileDisplayName($profiles[npub] ?? null) || npub.slice(0, 16) + '…';
  }

  let squadMenuOpen = false;
  let showExitSquadModal = false;
  let exitingSquad = false;
  let exitSquadError = '';
  let showInviteToSquadModal = false;
  let inviteToSquadCandidates: string[] = [];
  let inviteToSquadHasNoChannel = false;
  let loadingInviteToSquad = false;
  let selectedInviteNpubs: string[] = [];
  let inviteByNpub = '';
  let invitingToSquad = false;
  let inviteToSquadError = '';

  function openExitSquadModal() {
    squadMenuOpen = false;
    showExitSquadModal = true;
    exitSquadError = '';
  }

  function closeExitSquadModal() {
    if (!exitingSquad) showExitSquadModal = false;
  }

  async function handleExitSquad() {
    const squad = $squads.find((s) => s.id === $activeSquadId);
    if (!squad) return;
    exitingSquad = true;
    exitSquadError = '';
    try {
      for (const ch of squad.channels) {
        if (ch.groupId.startsWith('creating-')) continue;
        await leaveMlsGroup(ch.groupId);
      }
      squads.update((list) => list.filter((s) => s.id !== squad.id));
      if ($activeSquadId === squad.id) {
        activeSquadId.set(null);
        activeChannelId.set(null);
      }
      showExitSquadModal = false;
    } catch (e) {
      exitSquadError = friendlyMessage(getInvokeErrorMessage(e));
    } finally {
      exitingSquad = false;
    }
  }

  function openInviteToSquadModal() {
    squadMenuOpen = false;
    console.log('[Squads] openInviteToSquadModal', { activeSquadId: $activeSquadId, activeSquadName: $squads.find((s) => s.id === $activeSquadId)?.name });
    showInviteToSquadModal = true;
    inviteToSquadHasNoChannel = false;
    selectedInviteNpubs = [];
    inviteByNpub = '';
    inviteToSquadError = '';
    loadInviteToSquadCandidates();
  }

  function toggleInviteCandidate(npub: string) {
    selectedInviteNpubs = selectedInviteNpubs.includes(npub)
      ? selectedInviteNpubs.filter((n) => n !== npub)
      : [...selectedInviteNpubs, npub];
  }

  async function loadInviteToSquadCandidates() {
    const squad = $squads.find((s) => s.id === $activeSquadId);
    const announcementsChannel = getAnnouncementsChannel(squad);
    console.log('[Squads] loadInviteToSquadCandidates', { squadId: $activeSquadId, squadName: squad?.name, channelCount: squad?.channels?.length ?? 0, hasAnnouncements: !!announcementsChannel, announcementsGroupId: announcementsChannel?.groupId?.slice(0, 16) });
    if (!announcementsChannel) {
      console.log('[Squads] No announcements channel, candidates = []');
      inviteToSquadHasNoChannel = true;
      inviteToSquadCandidates = [];
      return;
    }
    inviteToSquadHasNoChannel = false;
    loadingInviteToSquad = true;
    try {
      const result = await getMlsGroupMembers(announcementsChannel.groupId);
      const inSquad = new Set(result.members ?? []);
      console.log('[Squads] getMlsGroupMembers result', { memberCount: inSquad.size, members: [...inSquad].map((n) => n.slice(0, 20) + '…') });
      const dmListSnap = $dmList;
      const requestsSnap = $requestsList;
      const pendingSnap = $pendingList;
      const allDmNpubs = [...dmListSnap, ...requestsSnap, ...pendingSnap].map((e) => e.npub);
      const uniqueNpubs = [...new Set(allDmNpubs)];
      console.log('[Squads] DM lists', { dmCount: dmListSnap.length, requestsCount: requestsSnap.length, pendingCount: pendingSnap.length, uniqueNpubs: uniqueNpubs.length });
      inviteToSquadCandidates = uniqueNpubs.filter((npub) => !inSquad.has(npub));
      console.log('[Squads] inviteToSquadCandidates', inviteToSquadCandidates.length, inviteToSquadCandidates.map((n) => n.slice(0, 20) + '…'));
    } catch (e) {
      console.warn('[Squads] loadInviteToSquadCandidates error', e);
      inviteToSquadCandidates = [];
    } finally {
      loadingInviteToSquad = false;
    }
  }

  function closeInviteToSquadModal() {
    if (!invitingToSquad) showInviteToSquadModal = false;
  }

  let inviteToSquadErrorBanner = '';
  async function handleInviteToSquad() {
    const squad = $squads.find((s) => s.id === $activeSquadId);
    const announcementsChannel = getAnnouncementsChannel(squad);
    const extraNpub = inviteByNpub.trim();
    const npubsToInvite = [
      ...selectedInviteNpubs,
      ...(extraNpub && extraNpub.startsWith('npub1') ? [extraNpub] : []),
    ];
    if (!announcementsChannel || !squad) return;
    if (npubsToInvite.length === 0) {
      inviteToSquadError = extraNpub ? 'Please enter a valid npub (starts with npub1) or pick from the list.' : 'Select at least one person or enter an npub.';
      return;
    }
    if (extraNpub && !extraNpub.startsWith('npub1')) {
      inviteToSquadError = 'Please enter a valid npub (starts with npub1) or pick from the list.';
      return;
    }
    inviteToSquadError = '';
    inviteToSquadErrorBanner = '';
    console.log('[Squads] handleInviteToSquad', { squadName: squad.name, count: npubsToInvite.length });
    showInviteToSquadModal = false;
    invitingToSquad = true;
    const groupId = announcementsChannel.groupId;
    const squadName = squad.name;
    const payload = formatSquadInviteMessage({
      type: 'squad_invite',
      squadName,
      groupId,
    });
    (async () => {
      let lastError = '';
      for (const npub of npubsToInvite) {
        try {
          await inviteMemberToGroup(groupId, npub);
          await sendDmMessage(npub, payload);
        } catch (e) {
          console.warn('[Squads] handleInviteToSquad failed for', npub.slice(0, 20) + '…', e);
          lastError = friendlyMessage(getInvokeErrorMessage(e));
        }
      }
      if (lastError) {
        inviteToSquadErrorBanner = lastError;
        setTimeout(() => { inviteToSquadErrorBanner = ''; }, 8000);
      }
      invitingToSquad = false;
    })();
  }
</script>

<svelte:window 
  on:mousemove={onMouseMove} 
  on:mouseup={stopResize}
  on:click={(e) => {
    const t = e.target as HTMLElement | null;
    if (squadMenuOpen && t && !t.closest('.squad-header-actions')) squadMenuOpen = false;
  }}
/>

<div class="squad-navbar" style="width: {width}px;">
  {#if activeSquad}
    <div class="squad-header">
      <h2 class="squad-name">{activeSquad.name}</h2>
      <div class="squad-header-actions">
        <button
          type="button"
          class="squad-menu-btn"
          title="Squad options"
          on:click={() => (squadMenuOpen = !squadMenuOpen)}
          aria-haspopup="true"
          aria-expanded={squadMenuOpen}
        >
          <img src={chevronDownIcon} alt="" class="squad-menu-chevron" />
        </button>
        {#if squadMenuOpen}
          <div class="squad-menu-dropdown" role="menu">
            <button type="button" class="squad-menu-item" role="menuitem" on:click={openInviteToSquadModal}>
              Invite to Squad
            </button>
            <button type="button" class="squad-menu-item squad-menu-item-exit" role="menuitem" on:click={openExitSquadModal}>
              Exit Squad
            </button>
          </div>
        {/if}
      </div>
    </div>
    {#if inviteToSquadErrorBanner}
      <div class="invite-to-squad-error-banner" role="alert">
        {inviteToSquadErrorBanner}
        <button type="button" class="invite-to-squad-error-dismiss" on:click={() => (inviteToSquadErrorBanner = '')} aria-label="Dismiss">×</button>
      </div>
    {/if}
    {#if createChannelErrorBanner}
      <div class="invite-to-squad-error-banner" role="alert">
        {createChannelErrorBanner}
        <button type="button" class="invite-to-squad-error-dismiss" on:click={() => (createChannelErrorBanner = '')} aria-label="Dismiss">×</button>
      </div>
    {/if}

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

{#if showInviteToSquadModal}
  <div
    class="create-channel-overlay"
    on:click={closeInviteToSquadModal}
    on:keydown={(e) => e.key === 'Escape' && closeInviteToSquadModal()}
    role="button"
    tabindex="-1"
  >
    <div
      class="create-channel-content"
      on:click|stopPropagation
      on:keydown={(e) => e.key === 'Escape' && closeInviteToSquadModal()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-to-squad-title"
      tabindex="0"
    >
      <h2 id="invite-to-squad-title">Invite to squad</h2>
      <p class="create-channel-subtitle">Invite friends to {activeSquad?.name ?? 'this squad'}.</p>
      {#if loadingInviteToSquad}
        <p class="create-channel-loading">Loading…</p>
      {:else if inviteToSquadHasNoChannel}
        <p class="create-channel-empty-friends">This squad has no channel yet. Create a channel first (use + next to Channels), or create squads from DMs so they get an announcements channel.</p>
      {:else if inviteToSquadCandidates.length === 0}
        <p class="create-channel-empty-friends">No one to invite right now. Start a DM with someone first, or they may already be in this squad.</p>
      {:else}
        <div class="create-channel-members">
          {#each inviteToSquadCandidates as npub (npub)}
            <div
              class="invite-to-squad-row"
              class:selected={selectedInviteNpubs.includes(npub)}
              on:click={() => toggleInviteCandidate(npub)}
              on:keydown={(e) => e.key === 'Enter' && toggleInviteCandidate(npub)}
              role="button"
              tabindex="0"
            >
              <span class="invite-to-squad-check">{selectedInviteNpubs.includes(npub) ? '✓' : ''}</span>
              <span class="create-channel-member-name">{displayName(npub)}</span>
            </div>
          {/each}
        </div>
      {/if}
      {#if !inviteToSquadHasNoChannel}
        <p class="create-channel-invite-by-npub-label">Or invite by npub:</p>
        <input
          type="text"
          class="create-channel-invite-npub-input"
          placeholder="npub1…"
          bind:value={inviteByNpub}
          disabled={invitingToSquad}
        />
      {/if}
      {#if inviteToSquadError}
        <p class="create-channel-error" role="alert">{inviteToSquadError}</p>
      {/if}
      <div class="create-channel-actions">
        <button type="button" class="create-channel-btn-cancel" on:click={closeInviteToSquadModal} disabled={invitingToSquad}>
          Cancel
        </button>
        <button
          type="button"
          class="create-channel-btn-create"
          on:click={handleInviteToSquad}
          disabled={inviteToSquadHasNoChannel || (selectedInviteNpubs.length === 0 && !inviteByNpub.trim()) || invitingToSquad}
        >
          {invitingToSquad ? 'Inviting…' : 'Invite'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showExitSquadModal}
  <div
    class="create-channel-overlay"
    on:click={closeExitSquadModal}
    on:keydown={(e) => e.key === 'Escape' && closeExitSquadModal()}
    role="button"
    tabindex="-1"
  >
    <div
      class="create-channel-content"
      on:click|stopPropagation
      on:keydown={(e) => e.key === 'Escape' && closeExitSquadModal()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="exit-squad-title"
      tabindex="0"
    >
      <h2 id="exit-squad-title">Exit Squad</h2>
      <p class="exit-squad-message">Are you sure you want to exit this squad? All local storage associated with this Squad will be erased and you will no longer be able to decrypt messages for this Squad.</p>
      {#if exitSquadError}
        <p class="create-channel-error" role="alert">{exitSquadError}</p>
      {/if}
      <div class="create-channel-actions">
        <button type="button" class="create-channel-btn-cancel" on:click={closeExitSquadModal} disabled={exitingSquad}>
          Cancel
        </button>
        <button
          type="button"
          class="exit-squad-confirm-btn"
          on:click={handleExitSquad}
          disabled={exitingSquad}
        >
          {exitingSquad ? 'Exiting…' : 'Exit Squad'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .squad-navbar {
    height: 100%;
    background-color: var(--bg-panel);
    display: flex;
    flex-direction: column;
    position: relative;
    flex-shrink: 0;
    border-left: 1px solid var(--border-subtle);
  }

  .squad-header {
    height: 48px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid var(--border-subtle);
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
  }

  .squad-name {
    flex: 1;
    min-width: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .squad-header-actions {
    position: relative;
    flex-shrink: 0;
  }

  .squad-menu-btn {
    padding: 6px 8px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 1.125rem;
    line-height: 1;
    cursor: pointer;
  }

  .squad-menu-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .squad-menu-chevron {
    width: 18px;
    height: 18px;
    display: block;
    filter: invert(1);
  }

  .squad-menu-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    min-width: 160px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 50;
    padding: 4px 0;
  }

  .squad-menu-item {
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

  .squad-menu-item:hover {
    background: var(--bg-hover);
  }

  .squad-menu-item-exit {
    color: var(--danger);
  }

  .squad-menu-item-exit:hover {
    background: rgba(237, 66, 69, 0.15);
    color: var(--danger);
  }

  .exit-squad-message {
    color: var(--text-secondary);
    font-size: 0.9375rem;
    margin: 0 0 20px 0;
    line-height: 1.5;
  }

  .exit-squad-confirm-btn {
    padding: 8px 16px;
    background: var(--danger);
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .exit-squad-confirm-btn:hover:not(:disabled) {
    filter: brightness(0.9);
  }

  .exit-squad-confirm-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .invite-to-squad-error-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(242, 63, 66, 0.15);
    border: 1px solid rgba(242, 63, 66, 0.4);
    border-radius: 6px;
    margin: 8px 12px 0;
    color: var(--danger);
    font-size: 0.875rem;
  }

  .invite-to-squad-error-dismiss {
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

  .invite-to-squad-error-dismiss:hover {
    opacity: 1;
  }

  .invite-to-squad-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    cursor: pointer;
    color: var(--text-primary);
    font-size: 0.9375rem;
    border-radius: 4px;
  }

  .invite-to-squad-check {
    flex-shrink: 0;
    width: 1.25em;
    text-align: center;
    color: var(--accent);
    font-weight: bold;
  }

  .invite-to-squad-row:hover {
    background: var(--bg-hover);
  }

  .invite-to-squad-row.selected {
    background: var(--border);
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
    color: var(--text-muted);
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
    background-color: var(--accent);
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
  .create-channel-empty-friends {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0 0 16px 0;
  }

  .create-channel-loading {
    padding: 8px 12px;
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
