<script lang="ts">
  import { toastMessage, clearToast, type ToastGoTo } from '../../stores/toast';
  import {
    squads,
    networks,
    activeTopNavTab,
    activeSquadId,
    activeNetworkId,
    activeChannelId,
    activeHubChannelName,
    activeView,
    lastOpenedSquadId,
    lastOpenedChannelId,
    lastOpenedNetworkId,
    lastOpenedNetworkChannelId,
    lastChannelBySquadId,
    lastChannelByNetworkId,
    lastHubChannelNameBySquadId,
    lastHubChannelNameByNetworkId,
    DASHBOARD_CHANNEL_ID,
  } from '../../stores/app';
  import { resolveHubChannelNameForGroupSelection } from '../../lib/mls/virtual-channel-bucket';

  function goToSpace(goTo: ToastGoTo) {
    if (goTo.type === 'squad') {
      activeTopNavTab.set('squads');
      activeSquadId.set(goTo.id);
      activeChannelId.set(goTo.channelId);
      activeView.set('hub');
      lastOpenedSquadId.set(goTo.id);
      lastOpenedChannelId.set(goTo.channelId);
      lastChannelBySquadId.update((m) => ({ ...m, [goTo.id]: goTo.channelId }));
      const squad = $squads.find((s) => s.id === goTo.id);
      const hub =
        goTo.channelId === DASHBOARD_CHANNEL_ID
          ? null
          : resolveHubChannelNameForGroupSelection(squad?.channels ?? [], goTo.channelId, goTo.hubChannelName ?? null);
      activeHubChannelName.set(hub);
      if (hub) lastHubChannelNameBySquadId.update((m) => ({ ...m, [goTo.id]: hub }));
    } else {
      activeTopNavTab.set('networks');
      activeNetworkId.set(goTo.id);
      activeChannelId.set(goTo.channelId);
      activeView.set('hub');
      lastOpenedNetworkId.set(goTo.id);
      lastOpenedNetworkChannelId.set(goTo.channelId);
      lastChannelByNetworkId.update((m) => ({ ...m, [goTo.id]: goTo.channelId }));
      const net = $networks.find((n) => n.id === goTo.id);
      const hub =
        goTo.channelId === DASHBOARD_CHANNEL_ID
          ? null
          : resolveHubChannelNameForGroupSelection(net?.channels ?? [], goTo.channelId, goTo.hubChannelName ?? null);
      activeHubChannelName.set(hub);
      if (hub) lastHubChannelNameByNetworkId.update((m) => ({ ...m, [goTo.id]: hub }));
    }
    clearToast();
  }
</script>

{#if $toastMessage}
  <div class="toast" role="status" aria-live="polite">
    <span class="toast-icon" aria-hidden="true">✓</span>
    <div class="toast-body">
      <span class="toast-text">{$toastMessage.text}</span>
      {#if $toastMessage.goTo}
        <button
          type="button"
          class="toast-go-btn"
          on:click={() => goToSpace($toastMessage!.goTo!)}
          aria-label="Go to {$toastMessage.goTo.name}"
        >
          Go to {$toastMessage.goTo.name}
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    top: 24px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 20px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 500;
    z-index: 99999;
    animation: toast-in 0.25s ease-out;
    pointer-events: auto; /* clickable even though portal wrapper has pointer-events: none */
  }

  .toast-icon {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: #fff;
    border-radius: 50%;
    font-size: 0.75rem;
    font-weight: 700;
  }

  .toast-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .toast-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 280px;
  }

  .toast-go-btn {
    align-self: flex-start;
    padding: 6px 12px;
    font-size: 0.8125rem;
    font-weight: 600;
    background: var(--accent);
    border: none;
    border-radius: 6px;
    color: #fff;
    cursor: pointer;
    white-space: nowrap;
  }

  .toast-go-btn:hover {
    background: var(--accent-hover);
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-12px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
</style>
