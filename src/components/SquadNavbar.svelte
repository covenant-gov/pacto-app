<script lang="ts">
  import Channel from './Channel.svelte';
  import { squads, activeSquadId, activeChannelId, activeView } from '../stores/app';

  // Get the active squad's data
  $: activeSquad = $squads.find(c => c.id === $activeSquadId);
  $: channels = activeSquad?.channels || [];

  function selectChannel(channelId: string) {
    $activeChannelId = channelId;
    $activeView = 'hub';
  }

  // Resize functionality
  let width = 240;
  let isResizing = false;
  const minWidth = 180;
  const maxWidth = 400;

  function startResize() {
    isResizing = true;
  }

  function onMouseMove(event: MouseEvent) {
    if (!isResizing) return;
    const newWidth = event.clientX - 64; // 64px is navbar width
    width = Math.max(minWidth, Math.min(maxWidth, newWidth));
  }

  function stopResize() {
    isResizing = false;
  }
</script>

<svelte:window 
  on:mousemove={onMouseMove} 
  on:mouseup={stopResize}
/>

<div class="squad-navbar" style="width: {width}px;">
  {#if activeSquad}
    <div class="squad-header">
      <h2 class="squad-name">{activeSquad.name}</h2>
    </div>
    
    <div class="channels-container">
      <div class="channel-list">
        {#each channels as channel}
          <div 
            on:click={() => selectChannel(channel.id)}
            on:keydown={(e) => e.key === 'Enter' && selectChannel(channel.id)}
            role="button"
            tabindex="0"
          >
            <Channel 
              name={channel.name} 
              type={channel.type as 'text' | 'announcement'}
              active={$activeView === 'hub' && $activeChannelId === channel.id}
            />
          </div>
        {/each}
      </div>
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
</style>
