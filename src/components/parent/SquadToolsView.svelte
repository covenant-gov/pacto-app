<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { Squad } from '../../stores/app';
  import { ANNOUNCEMENTS_CHANNEL_NAME, TOOLS_CHANNEL_NAME } from '../../lib/squad/hub-channel-names';
  import { withPendingToolsFocusModes } from '../../lib/squad/tools-visited-modes';
  import { resolvePollsMlsGroupId } from '../../lib/parent-navbar';
  import {
    TOOLS_CHANNEL_MODES,
    squadToolsChannelMode,
    type SquadToolsChannelMode,
  } from '../../stores/navigation';
  import { eventsFocus } from '../../stores/events-navigation';
  import { docsFocus } from '../../stores/docs-navigation';
  import HubChannelHeader from './HubChannelHeader.svelte';
  import HubModeSwitcher from './HubModeSwitcher.svelte';
  import SquadStickersSection from './dashboard/SquadStickersSection.svelte';
  import {
    loadDashboardPollsPanel,
    loadSquadDocsPanel,
    loadSquadEventsPanel,
  } from '../../lib/dashboard/dashboard-tab-components';

  let { parent }: { parent: Squad } = $props();

  const parentId = $derived(parent?.id ?? '');
  const mlsGroupId = $derived(resolvePollsMlsGroupId(parent));
  const announcementsGroupId = $derived(
    parent?.channels?.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.groupId ??
      parent?.channels?.[0]?.groupId ??
      null,
  );
  const toolsMode = $derived($squadToolsChannelMode);

  let visitedToolsModes = $state(new Set<SquadToolsChannelMode>([$squadToolsChannelMode]));
  $effect(() => {
    const mode = toolsMode;
    const pid = parentId;
    const next = withPendingToolsFocusModes(visitedToolsModes, mode, {
      seedEvents: $eventsFocus?.parentId === pid,
      seedDocs: $docsFocus?.parentId === pid,
    });
    if (
      next.size !== visitedToolsModes.size ||
      [...next].some((m) => !visitedToolsModes.has(m))
    ) {
      visitedToolsModes = next;
    }
  });

  function selectToolsMode(mode: SquadToolsChannelMode) {
    squadToolsChannelMode.set(mode);
  }
</script>

<div class="squad-tools">
  <HubChannelHeader channelName={TOOLS_CHANNEL_NAME} />
  <HubModeSwitcher
    modes={TOOLS_CHANNEL_MODES}
    active={toolsMode}
    ariaLabel={$t('governance.toolsChannelMode.section')}
    labelFor={(mode) => $t(`governance.toolsChannelMode.${mode}`)}
    onSelect={(mode) => selectToolsMode(mode as SquadToolsChannelMode)}
  />
  <div class="squad-tools-body">
    {#if visitedToolsModes.has('polls')}
      <div
        class="dashboard-tab-pane"
        class:dashboard-tab-pane-active={toolsMode === 'polls'}
        hidden={toolsMode !== 'polls'}
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
    {#if visitedToolsModes.has('events')}
      <div
        class="dashboard-tab-pane"
        class:dashboard-tab-pane-active={toolsMode === 'events'}
        hidden={toolsMode !== 'events'}
      >
        {#await loadSquadEventsPanel() then EventsPanel}
          <EventsPanel parentId={parentId} mlsGroupId={mlsGroupId} />
        {:catch}
          <p class="tab-error" role="alert">{$t('governance.tabLoadError.events')}</p>
        {/await}
      </div>
    {/if}
    {#if visitedToolsModes.has('docs')}
      <div
        class="dashboard-tab-pane"
        class:dashboard-tab-pane-active={toolsMode === 'docs'}
        hidden={toolsMode !== 'docs'}
      >
        {#await loadSquadDocsPanel() then DocsPanel}
          <DocsPanel parentId={parentId} mlsGroupId={mlsGroupId} />
        {:catch}
          <p class="tab-error" role="alert">{$t('governance.tabLoadError.docs')}</p>
        {/await}
      </div>
    {/if}
    {#if visitedToolsModes.has('stickers')}
      <div
        class="dashboard-tab-pane"
        class:dashboard-tab-pane-active={toolsMode === 'stickers'}
        hidden={toolsMode !== 'stickers'}
      >
        <div class="stickers-pane">
          <SquadStickersSection squad={parent} {announcementsGroupId} />
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .squad-tools {
    flex: 1;
    min-width: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .squad-tools-body {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
  }
  .dashboard-tab-pane {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .dashboard-tab-pane:not([hidden]) {
    width: 100%;
  }
  .dashboard-tab-pane[hidden] {
    display: none !important;
  }
  .stickers-pane {
    padding: 16px;
  }
  .tab-error {
    margin: 16px;
    color: var(--danger, #c44);
  }
</style>
