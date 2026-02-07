<script lang="ts">
  import Tab from './Tab.svelte';
  import settingsIcon from '../icons/settings.svg';
  import plusCircleIcon from '../icons/plus-circle.svg';
  import friendsIcon from '../icons/friends.svg';
  import requestsIcon from '../icons/requests.svg';
  import pendingIcon from '../icons/pending.svg';
  import { squads, activeSquadId, activeChannelId, activeView, activeTopNavTab, activeDmTab, composingNewChat, type TopNavTab, type DmTab, type Squad } from '../stores/app';

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

  function openOrganizeSquadModal() {
    showOrganizeSquadModal = true;
    organizeSquadName = '';
    organizeSquadIconUrl = '';
  }

  function closeOrganizeSquadModal() {
    showOrganizeSquadModal = false;
  }

  function handleCreateSquad() {
    const name = organizeSquadName.trim();
    if (!name) return;
    const now = Date.now();
    const squad: Squad = {
      id: crypto.randomUUID(),
      name,
      iconUrl: organizeSquadIconUrl.trim() || undefined,
      channels: [],
      createdAt: now,
      updatedAt: now,
    };
    squads.update((list) => [...list, squad]);
    $activeSquadId = squad.id;
    $activeChannelId = null;
    $activeView = 'hub';
    closeOrganizeSquadModal();
  }

  function handleAddAction() {
    if ($activeTopNavTab === 'squads') {
      openOrganizeSquadModal();
    } else {
      // networks: TODO
    }
  }

  $: canCreateSquad = organizeSquadName.trim().length > 0;
</script>

<div class="navbar">
  <div class="tab-list">
    {#if $activeTopNavTab === 'dms'}
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
      <p class="organize-modal-subtitle">Create a squad to group channels.</p>
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
        <div class="organize-actions">
          <button type="button" class="organize-btn-cancel" on:click={closeOrganizeSquadModal}>
            Cancel
          </button>
          <button type="submit" class="organize-btn-create" disabled={!canCreateSquad}>
            Create
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
    background-color: #242424;
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
    background: #2b2d31;
    border-radius: 12px;
    padding: 32px;
    max-width: 400px;
    width: 90%;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .organize-modal-content h2 {
    color: #f2f3f5;
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0 0 8px 0;
  }

  .organize-modal-subtitle {
    color: #949ba4;
    font-size: 0.9375rem;
    margin: 0 0 24px 0;
  }

  .organize-label {
    display: block;
    color: #b5bac1;
    font-size: 0.875rem;
    margin-bottom: 6px;
  }

  .organize-input {
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

  .organize-input::placeholder {
    color: #6d6f78;
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
    border: 1px solid #404249;
    border-radius: 8px;
    color: #b5bac1;
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .organize-btn-cancel:hover {
    background: #36373d;
    color: #f2f3f5;
  }

  .organize-btn-create {
    padding: 8px 16px;
    background: #5865f2;
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .organize-btn-create:hover:not(:disabled) {
    background: #4752c4;
  }

  .organize-btn-create:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>