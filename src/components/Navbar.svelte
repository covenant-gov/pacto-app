<script lang="ts">
  import Tab from './Tab.svelte';
  import settingsIcon from '../icons/settings.svg';
  import plusCircleIcon from '../icons/plus-circle.svg';
  import friendsIcon from '../icons/friends.svg';
  import requestsIcon from '../icons/requests.svg';
  import pendingIcon from '../icons/pending.svg';
  import pinIcon from '../icons/pin.svg';
  import { squads, networks, activeSquadId, activeChannelId, activeView, activeTopNavTab, activeDmTab, activeNetworkId, lastOpenedNetworkId, lastOpenedNetworkChannelId, composingNewChat, dmList, pinnedList, type TopNavTab, type DmTab, type Squad, type Channel, type Network } from '../stores/app';
  import { currentUser } from '../stores/auth';
  import { createGroupChat, getMlsGroupMembers, sendDmMessage, formatSquadInviteMessage, formatNetworkInviteMessage } from '../lib/api/nostr';
  import { getInvokeErrorMessage, friendlyMessage } from '../lib/utils/tauri-errors';
  import { getProfileDisplayName } from '../lib/utils/profile';
  import { profiles } from '../stores/profiles';

  function selectSquad(squadId: string) {
    $activeSquadId = squadId;
    $activeChannelId = null;
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
  }

  function openProfile() {
    $activeView = 'profile';
    $activeSquadId = null;
    $activeChannelId = null;
  }

  const addButtonLabels: Record<TopNavTab, string> = {
    dms: 'Start DM',
    squads: 'Organize Squad',
    networks: 'Coordinate Network',
  };
  $: addButtonLabel = addButtonLabels[$activeTopNavTab];

  // Organize Squad modal
  let showOrganizeSquadModal = false;
  let organizeSquadName = '';
  let organizeSquadIconUrl = '';
  let organizeSquadMembers: string[] = [];
  let organizeSquadError = '';
  let creatingSquad = false;

  function openOrganizeSquadModal() {
    showOrganizeSquadModal = true;
    organizeSquadName = '';
    organizeSquadIconUrl = '';
    organizeSquadMembers = [];
    organizeSquadError = '';
  }

  function closeOrganizeSquadModal() {
    if (!creatingSquad) showOrganizeSquadModal = false;
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

  async function handleCreateSquad() {
    const name = organizeSquadName.trim();
    if (!name) return;
    creatingSquad = true;
    organizeSquadError = '';
    try {
      // Creator must not be in the member list; backend requires at least one other member.
      const myNpub = $currentUser?.npub;
      const memberIds = (organizeSquadMembers || []).filter((n) => n !== myNpub);
      if (memberIds.length === 0) {
        organizeSquadError = 'Select at least one other member to create a squad.';
        return;
      }
      const groupId = await createGroupChat('announcements', memberIds);
      const announcementsChannel: Channel = {
        id: groupId,
        name: 'announcements',
        groupId,
        order: 0,
      };
      const now = Date.now();
      const squad: Squad = {
        id: crypto.randomUUID(),
        name,
        iconUrl: organizeSquadIconUrl.trim() || undefined,
        channels: [announcementsChannel],
        createdAt: now,
        updatedAt: now,
      };
      squads.update((list) => [...list, squad]);
      $activeSquadId = squad.id;
      $activeChannelId = groupId;
      $activeView = 'hub';
      showOrganizeSquadModal = false;

      // Send squad_invite DM to each member so they see the invite card in the DM thread
      const payload = formatSquadInviteMessage({ type: 'squad_invite', squadName: name, groupId });
      (async () => {
        for (const npub of memberIds) {
          try {
            await sendDmMessage(npub, payload);
          } catch (e) {
            console.warn('[Navbar] send squad invite DM failed for', npub.slice(0, 20) + '…', e);
          }
        }
      })();
    } catch (e) {
      organizeSquadError = friendlyMessage(getInvokeErrorMessage(e));
    } finally {
      creatingSquad = false;
    }
  }

  function handleAddAction() {
    if ($activeTopNavTab === 'squads') {
      openOrganizeSquadModal();
    } else if ($activeTopNavTab === 'networks') {
      openCreateNetworkModal();
    }
  }

  $: canCreateSquad = organizeSquadName.trim().length > 0 && organizeSquadMembers.length > 0;

  // Create Network modal
  let showCreateNetworkModal = false;
  let createNetworkName = '';
  let createNetworkIconUrl = '';
  let createNetworkSelectedSquadIds: string[] = [];
  let createNetworkError = '';
  let creatingNetwork = false;

  function openCreateNetworkModal() {
    showCreateNetworkModal = true;
    createNetworkName = '';
    createNetworkIconUrl = '';
    createNetworkSelectedSquadIds = [];
    createNetworkError = '';
  }

  function closeCreateNetworkModal() {
    if (!creatingNetwork) showCreateNetworkModal = false;
  }

  function toggleCreateNetworkSquad(squadId: string) {
    if (createNetworkSelectedSquadIds.includes(squadId)) {
      createNetworkSelectedSquadIds = createNetworkSelectedSquadIds.filter((id) => id !== squadId);
    } else {
      createNetworkSelectedSquadIds = [...createNetworkSelectedSquadIds, squadId];
    }
  }

  function getAnnouncementsChannel(squad: Squad) {
    if (!squad?.channels?.length) return undefined;
    return [...squad.channels].sort((a, b) => a.order - b.order)[0];
  }

  async function handleCreateNetwork() {
    const name = createNetworkName.trim();
    if (!name) return;
    if (createNetworkSelectedSquadIds.length < 2) {
      createNetworkError = 'Select at least two squads to create a network.';
      return;
    }
    creatingNetwork = true;
    createNetworkError = '';
    try {
      const myNpub = $currentUser?.npub;
      const selectedSquads = $squads.filter((s) => createNetworkSelectedSquadIds.includes(s.id));
      const allNpubs = new Set<string>();
      for (const squad of selectedSquads) {
        const ann = getAnnouncementsChannel(squad);
        if (!ann) continue;
        try {
          const result = await getMlsGroupMembers(ann.groupId);
          for (const n of result.members ?? []) {
            if (n !== myNpub) allNpubs.add(n);
          }
        } catch (e) {
          createNetworkError = `Could not load members for squad "${squad.name}". Try again or pick different squads.`;
          return;
        }
      }
      const allMemberNpubs = [...allNpubs];
      if (allMemberNpubs.length === 0) {
        createNetworkError = 'No members found in the selected squads (or you are the only member). Add people to those squads first.';
        return;
      }
      const groupId = await createGroupChat('announcements', allMemberNpubs);
      const announcementsChannel: Channel = {
        id: groupId,
        name: 'announcements',
        groupId,
        order: 0,
      };
      const memberSquads = selectedSquads.map((s) => ({ id: s.id, name: s.name }));
      const now = Date.now();
      const network: Network = {
        id: crypto.randomUUID(),
        name,
        iconUrl: createNetworkIconUrl.trim() || undefined,
        channels: [announcementsChannel],
        memberSquads,
        createdAt: now,
        updatedAt: now,
      };
      networks.update((list) => [...list, network]);
      activeNetworkId.set(network.id);
      activeChannelId.set(groupId);
      lastOpenedNetworkId.set(network.id);
      lastOpenedNetworkChannelId.set(groupId);
      activeView.set('hub');
      activeTopNavTab.set('networks');
      showCreateNetworkModal = false;

      const payload = formatNetworkInviteMessage({
        type: 'network_invite',
        networkName: name,
        groupId,
        memberSquads,
      });
      (async () => {
        for (const npub of allMemberNpubs) {
          try {
            await sendDmMessage(npub, payload);
          } catch (e) {
            console.warn('[Navbar] send network invite DM failed for', npub.slice(0, 20) + '…', e);
          }
        }
      })();
    } catch (e) {
      createNetworkError = friendlyMessage(getInvokeErrorMessage(e));
    } finally {
      creatingNetwork = false;
    }
  }

  $: canCreateNetwork =
    createNetworkName.trim().length > 0 && createNetworkSelectedSquadIds.length >= 2;

  $: if (showCreateNetworkModal) {
    setTimeout(() => document.getElementById('network-name')?.focus(), 0);
  }

  /* Organize Squad: members = Pinned + Friends (so squad creation can use both) */
  $: organizeMemberList = [...$pinnedList, ...$dmList];
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
    {:else}
      <!-- Networks: placeholder for future tabs -->
    {/if}
  </div>
  {/if}
  {#if $activeView === 'profile'}
  <div class="navbar-spacer" aria-hidden="true"></div>
  {/if}
  <div class="tab-list bottom">
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
  <div
    class="organize-modal-overlay"
    on:click={closeOrganizeSquadModal}
    on:keydown={(e) => e.key === 'Escape' && closeOrganizeSquadModal()}
    role="button"
    tabindex="-1"
  >
    <div
      class="organize-modal-content"
      on:click|stopPropagation
      on:keydown={(e) => e.key === 'Escape' && closeOrganizeSquadModal()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="organize-squad-title"
      tabindex="0"
    >
      <h2 id="organize-squad-title">Organize Squad</h2>
      <p class="organize-modal-subtitle">Create a squad with an announcements channel. Select at least one member.</p>
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
        {#if organizeMemberList.length === 0}
          <p class="organize-members-empty">Add friends in DMs first to create a squad with them.</p>
        {/if}
        {#if organizeSquadError}
          <p class="organize-error" role="alert">{organizeSquadError}</p>
        {/if}
        <div class="organize-actions">
          <button type="button" class="organize-btn-cancel" on:click={closeOrganizeSquadModal} disabled={creatingSquad}>
            Cancel
          </button>
          <button type="submit" class="organize-btn-create" disabled={!canCreateSquad || creatingSquad}>
            {creatingSquad ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

{#if showCreateNetworkModal}
  <div
    class="organize-modal-overlay"
    on:click={closeCreateNetworkModal}
    on:keydown={(e) => e.key === 'Escape' && closeCreateNetworkModal()}
    role="button"
    tabindex="-1"
  >
    <div
      class="organize-modal-content"
      on:click|stopPropagation
      on:keydown={(e) => e.key === 'Escape' && closeCreateNetworkModal()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-network-title"
      aria-describedby="create-network-description"
      tabindex="0"
    >
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
          <button type="button" class="organize-btn-cancel" on:click={closeCreateNetworkModal} disabled={creatingNetwork} aria-label="Cancel">
            Cancel
          </button>
          <button type="submit" class="organize-btn-create" disabled={!canCreateNetwork || creatingNetwork} aria-label="Create network">
            {creatingNetwork ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .navbar {
    width: 64px;
    height: 100%;
    background-color: var(--bg-panel);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding-top: 12px;
    padding-bottom: 12px;
    box-sizing: border-box;
  }

  .tab-list {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .tab-list.bottom {
    padding-bottom: 8px;
  }

  .navbar-spacer {
    flex: 1;
    min-height: 0;
  }

  /* Organize Squad modal */
  .organize-modal-overlay {
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

  .organize-modal-content {
    background: var(--bg-elevated);
    border-radius: 12px;
    padding: 32px;
    max-width: 400px;
    width: 90%;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .organize-modal-content h2 {
    color: var(--text-primary);
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0 0 8px 0;
  }

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