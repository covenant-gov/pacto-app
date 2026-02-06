<script lang="ts">
  import Tab from './Tab.svelte';
  import settingsIcon from '../icons/settings.svg';
  import { squads, activeSquadId, activeChannelId, activeView, activeTopNavTab, activeDmTab, composingNewChat, type TopNavTab, type DmTab } from '../stores/app';

  function selectSquad(squadId: string) {
    $activeSquadId = squadId;
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

  let showTooltip = false;

  const addButtonLabels: Record<TopNavTab, string> = {
    dms: 'New Chat',
    networks: 'Network Chat',
    squads: 'Squad Hub',
  };
  $: addButtonLabel = addButtonLabels[$activeTopNavTab];

  function handleAddAction() {
    // TODO: Implement per context (start chat / create group / deploy hub)
    console.log(addButtonLabel);
  }
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
        <Tab label="Friends" active={$activeView === 'hub' && $activeDmTab === 'friends'} />
      </div>
      <div 
        on:click={() => selectDmTab('requests')}
        on:keydown={(e) => e.key === 'Enter' && selectDmTab('requests')}
        role="button"
        tabindex="0"
      >
        <Tab label="Requests" active={$activeView === 'hub' && $activeDmTab === 'requests'} />
      </div>
      <div 
        on:click={() => selectDmTab('pending')}
        on:keydown={(e) => e.key === 'Enter' && selectDmTab('pending')}
        role="button"
        tabindex="0"
      >
        <Tab label="Pending" active={$activeView === 'hub' && $activeDmTab === 'pending'} />
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
            image={squad.image}
            active={$activeView === 'hub' && $activeSquadId === squad.id}
          />
        </div>
      {/each}
    {:else}
      <!-- Networks: placeholder for future tabs -->
    {/if}
  </div>
  <div class="tab-list bottom">
    <div class="tooltip-wrapper">
      <button 
        class="add-squad-btn"
        on:click={$activeTopNavTab === 'dms' ? startNewChat : handleAddAction}
        on:mouseenter={() => showTooltip = true}
        on:mouseleave={() => showTooltip = false}
        aria-label={addButtonLabel}
      >
        <span class="plus-icon">+</span>
      </button>
      {#if showTooltip}
        <div class="tooltip">{addButtonLabel}</div>
      {/if}
    </div>
    <div 
      on:click={openProfile}
      on:keydown={(e) => e.key === 'Enter' && openProfile()}
      role="button"
      tabindex="0"
    >
      <Tab label="Settings" image={settingsIcon} active={$activeView === 'profile'} />
    </div>
  </div>
</div>

<style>
  .navbar {
    width: 64px;
    height: 100%;
    background-color: #242424;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .tab-list {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .add-squad-btn {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: #313338;
    border: 2px dashed #5865f2;
    color: #5865f2;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
    outline: none;
  }

  .add-squad-btn:hover {
    background: #5865f2;
    color: #ffffff;
    border-style: solid;
    transform: scale(1.05);
  }

  .add-squad-btn:active {
    transform: scale(0.95);
  }

  .plus-icon {
    font-size: 24px;
    font-weight: 300;
    line-height: 1;
  }

  .tooltip-wrapper {
    position: relative;
  }

  .tooltip {
    position: absolute;
    left: 72px;
    top: 50%;
    transform: translateY(-50%);
    background: #1e1f22;
    color: #f2f3f5;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 0.875rem;
    white-space: nowrap;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 1000;
    pointer-events: none;
    animation: tooltipFadeIn 0.15s ease-out;
  }

  .tooltip::before {
    content: '';
    position: absolute;
    left: -4px;
    top: 50%;
    transform: translateY(-50%);
    width: 0;
    height: 0;
    border-top: 4px solid transparent;
    border-bottom: 4px solid transparent;
    border-right: 4px solid #1e1f22;
  }

  @keyframes tooltipFadeIn {
    from {
      opacity: 0;
      transform: translateY(-50%) translateX(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(-50%) translateX(0);
    }
  }
</style>