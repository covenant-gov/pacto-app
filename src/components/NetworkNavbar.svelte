<script lang="ts">
  import Channel from './Channel.svelte';
  import {
    networks,
    activeNetworkId,
    activeChannelId,
    activeView,
    lastOpenedNetworkId,
    lastOpenedNetworkChannelId,
  } from '../stores/app';

  $: activeNetwork = $networks.find((n) => n.id === $activeNetworkId);
  $: channels = activeNetwork?.channels ?? [];
  $: sortedChannels = [...channels].sort((a, b) => a.order - b.order);
  $: memberSquadsLabel =
    activeNetwork?.memberSquads?.length
      ? activeNetwork.memberSquads.map((s) => s.name).join(', ')
      : '';

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
</script>

<svelte:window on:mousemove={onMouseMove} on:mouseup={stopResize} />

<div class="network-navbar" style="width: {width}px;">
  {#if activeNetwork}
    <div class="network-heading">
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

  <button
    class="resize-handle"
    on:mousedown={startResize}
    aria-label="Resize sidebar"
    type="button"
  ></button>
</div>

<style>
  .network-navbar {
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
</style>
