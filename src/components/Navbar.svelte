<script lang="ts">
  import Tab from './Tab.svelte';
  import settingsIcon from '../icons/settings.svg';
  import plusCircleIcon from '../icons/plus-circle.svg';
  import friendsIcon from '../icons/friends.svg';
  import requestsIcon from '../icons/requests.svg';
  import pendingIcon from '../icons/pending.svg';
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

  const addButtonLabels: Record<TopNavTab, string> = {
    dms: 'Start DM',
    squads: 'Organize Squad',
    networks: 'Coordinate Network',
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
</style>