<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { Squad } from '../../stores/app';
  import { BOARD_CHANNEL_NAME } from '../../lib/squad/hub-channel-names';
  import { resolvePollsMlsGroupId } from '../../lib/parent-navbar';
  import {
    BOARD_CHANNEL_MODES,
    squadBoardChannelMode,
    type SquadBoardChannelMode,
  } from '../../stores/navigation';
  import HubChannelHeader from './HubChannelHeader.svelte';
  import HubModeSwitcher from './HubModeSwitcher.svelte';
  import {
    loadDashboardPollsPanel,
    loadSquadDocsPanel,
    loadSquadEventsPanel,
  } from '../../lib/dashboard/dashboard-tab-components';

  let { parent }: { parent: Squad } = $props();

  const parentId = $derived(parent?.id ?? '');
  const mlsGroupId = $derived(resolvePollsMlsGroupId(parent));
  const boardMode = $derived($squadBoardChannelMode);

  let visitedBoardModes = $state(new Set<SquadBoardChannelMode>([$squadBoardChannelMode]));
  $effect(() => {
    const mode = boardMode;
    if (visitedBoardModes.has(mode)) return;
    visitedBoardModes = new Set([...visitedBoardModes, mode]);
  });

  function selectBoardMode(mode: SquadBoardChannelMode) {
    squadBoardChannelMode.set(mode);
  }
</script>

<div class="squad-board">
  <HubChannelHeader channelName={BOARD_CHANNEL_NAME} />
  <HubModeSwitcher
    modes={BOARD_CHANNEL_MODES}
    active={boardMode}
    ariaLabel={$t('governance.boardChannelMode.section')}
    labelFor={(mode) => $t(`governance.boardChannelMode.${mode}`)}
    onSelect={(mode) => selectBoardMode(mode as SquadBoardChannelMode)}
  />
  <div class="squad-board-body">
    {#if visitedBoardModes.has('polls')}
      <div
        class="dashboard-tab-pane"
        class:dashboard-tab-pane-active={boardMode === 'polls'}
        hidden={boardMode !== 'polls'}
      >
        {#await loadDashboardPollsPanel() then PollsPanel}
          <PollsPanel
            parentId={parentId}
            pollsMlsGroupId={mlsGroupId}
            variant="channel"
            fillParent
          />
        {:catch}
          <p class="tab-error" role="alert">{$t('governance.tabLoadError.polls')}</p>
        {/await}
      </div>
    {/if}
    {#if visitedBoardModes.has('events')}
      <div
        class="dashboard-tab-pane"
        class:dashboard-tab-pane-active={boardMode === 'events'}
        hidden={boardMode !== 'events'}
      >
        {#await loadSquadEventsPanel() then EventsPanel}
          <EventsPanel parentId={parentId} mlsGroupId={mlsGroupId} />
        {:catch}
          <p class="tab-error" role="alert">{$t('governance.tabLoadError.events')}</p>
        {/await}
      </div>
    {/if}
    {#if visitedBoardModes.has('docs')}
      <div
        class="dashboard-tab-pane"
        class:dashboard-tab-pane-active={boardMode === 'docs'}
        hidden={boardMode !== 'docs'}
      >
        {#await loadSquadDocsPanel() then DocsPanel}
          <DocsPanel parentId={parentId} mlsGroupId={mlsGroupId} />
        {:catch}
          <p class="tab-error" role="alert">{$t('governance.tabLoadError.docs')}</p>
        {/await}
      </div>
    {/if}
  </div>
</div>

<style>
  .squad-board {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .squad-board-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
  }
  .dashboard-tab-pane {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .dashboard-tab-pane[hidden] {
    display: none !important;
  }
  .tab-error {
    margin: 16px;
    color: var(--danger, #c44);
  }
</style>
