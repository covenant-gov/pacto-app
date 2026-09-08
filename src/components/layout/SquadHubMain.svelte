<script lang="ts">
  import type { Component } from 'svelte';
  import { t } from 'svelte-i18n';
  import ParentDashboard from '../parent/ParentDashboard.svelte';
  import SquadSettingsView from '../parent/SquadSettingsView.svelte';
  import { createLazyComponent } from '../../lib/ui/lazy-svelte-component';
  import {
    rememberHubDashboard,
    retainHubDashboardsForParent,
    hubDashboardKeepAliveKey,
    type HubDashboardKeepAlive,
  } from '../../lib/dashboard/hub-dashboard-keep-alive';
  import {
    resolveOpenHubParent,
    resolveEffectiveHubChannel,
    syncSquadsHubSelection,
  } from '../../lib/squad-hub-nav';
  import { scheduleHubParentPrefetch } from '../../lib/app/hub-prefetch';
  import { scheduleDashboardPrefetch } from '../../lib/app/dashboard-prefetch';
  import {
    activeSquadId,
    activeChannelId,
    activeHubChannelName,
    activeTopNavTab,
    lastChannelBySquadId,
    lastHubChannelNameBySquadId,
  } from '../../stores/navigation';
  import {
    squads,
    parentsCreatingAnnouncements,
    squadInfraByParentId,
    treasurySafesByParentId,
    SETTINGS_CHANNEL_ID,
    SQUAD_WARGAME_CHANNEL_ID,
    isVirtualHubChannelId,
    isSquadDashboardChromeChannelId,
    type Squad,
  } from '../../stores/squads';
  import type { SquadInfraDto } from '../../lib/governance/api';
  import type { TreasurySafeEntry } from '../../lib/treasury/treasury-safes';

  const loadChatView = createLazyComponent(() => import('../channel/ChatView.svelte'));

  interface Props {
    onConfirmImportSafe?: (
      parent: Squad,
      params: {
        safeAddress: string;
        chain: string;
        label: string;
        entryId: string;
        txHash?: string;
      },
    ) => Promise<void>;
    onPactoGovDeployComplete?: (params: {
      parentId: string;
      announcementsGroupId: string;
      chain: string;
      topHatId: string;
      providerPayload: string;
      safeAddress: string;
      txHash: string;
      infraRowId?: string;
    }) => Promise<void>;
    onSponsorDeployComplete?: (params: {
      parentId: string;
      announcementsGroupId: string;
      chain: string;
      sponsorAddress: string;
      providerPayload: string;
      infraRowId: string;
    }) => Promise<void>;
    onSquadAdminDeployComplete?: (params: {
      parentId: string;
      announcementsGroupId: string;
      chain: string;
      squadAdminProxy: string;
      providerPayload: string;
      infraRowId: string;
    }) => Promise<void>;
  }

  let {
    onConfirmImportSafe,
    onPactoGovDeployComplete,
    onSponsorDeployComplete,
    onSquadAdminDeployComplete,
  }: Props = $props();

  let ChatViewComponent = $state<Component | null>(null);
  let chatViewLoadToken = 0;
  let visitedHubDashboards = $state<HubDashboardKeepAlive[]>([]);

  let openHubParent = $derived(resolveOpenHubParent($squads, $activeSquadId));
  let effectiveHubChannel = $derived.by(() => {
    void $squadInfraByParentId;
    return resolveEffectiveHubChannel(
      openHubParent,
      $activeChannelId,
      $lastChannelBySquadId,
      $lastHubChannelNameBySquadId,
    );
  });
  let showParentDashboard = $derived(
    openHubParent != null &&
      (!effectiveHubChannel.channelId ||
        isSquadDashboardChromeChannelId(effectiveHubChannel.channelId)),
  );
  let currentHubWarGame = $derived(effectiveHubChannel.channelId === SQUAD_WARGAME_CHANNEL_ID);
  let currentHubDashboardKey = $derived(
    openHubParent ? hubDashboardKeepAliveKey(openHubParent.id, currentHubWarGame) : '',
  );
  let showSquadSettings = $derived(
    openHubParent != null && effectiveHubChannel.channelId === SETTINGS_CHANNEL_ID,
  );
  let showMlsChatView = $derived(
    openHubParent != null &&
      !!effectiveHubChannel.channelId &&
      !isVirtualHubChannelId(effectiveHubChannel.channelId),
  );
  let dashboardParentId = $derived(
    isSquadDashboardChromeChannelId(effectiveHubChannel.channelId) ? openHubParent?.id ?? null : null,
  );

  function isCreatingSquadId(squadId: string): boolean {
    return squadId.startsWith('creating-squad-') || squadId.startsWith('creating-squad-pair-');
  }

  let showCreatingLoader = $derived(
    !!$activeSquadId &&
      !openHubParent &&
      ($parentsCreatingAnnouncements.has($activeSquadId) || isCreatingSquadId($activeSquadId)),
  );
  let showOpenFailed = $derived(
    !!$activeSquadId && !openHubParent && $squads.length > 0 && !showCreatingLoader,
  );

  $effect(() => {
    if (!openHubParent) {
      if (visitedHubDashboards.length > 0) visitedHubDashboards = [];
      return;
    }
    visitedHubDashboards = showParentDashboard
      ? rememberHubDashboard(visitedHubDashboards, openHubParent.id, currentHubWarGame)
      : retainHubDashboardsForParent(visitedHubDashboards, openHubParent.id);
  });

  $effect(() => {
    if ($activeTopNavTab !== 'squads' || $squads.length === 0) return;
    void $squadInfraByParentId;
    syncSquadsHubSelection();
  });

  $effect(() => {
    if ($activeTopNavTab !== 'squads') return;
    if (!$activeSquadId || openHubParent || $squads.length === 0) return;
    syncSquadsHubSelection();
  });

  $effect(() => {
    if (
      $activeTopNavTab !== 'squads' ||
      !openHubParent ||
      !effectiveHubChannel.channelId ||
      ($activeChannelId === effectiveHubChannel.channelId &&
        $activeHubChannelName === effectiveHubChannel.hubChannelName)
    ) {
      return;
    }
    activeChannelId.set(effectiveHubChannel.channelId);
    activeHubChannelName.set(effectiveHubChannel.hubChannelName);
  });

  $effect(() => {
    if ($activeTopNavTab === 'squads' && openHubParent) {
      scheduleHubParentPrefetch(openHubParent);
    }
  });

  $effect(() => {
    if (dashboardParentId && openHubParent) {
      scheduleDashboardPrefetch(openHubParent);
    }
  });

  $effect(() => {
    if (!showMlsChatView) {
      ChatViewComponent = null;
      return;
    }
    const token = ++chatViewLoadToken;
    void loadChatView().then((component) => {
      if (token === chatViewLoadToken) ChatViewComponent = component;
    });
  });

  function squadInfraRowsForParent(parent: Squad): SquadInfraDto[] | undefined {
    const id = parent.id;
    return Object.prototype.hasOwnProperty.call($squadInfraByParentId, id)
      ? ($squadInfraByParentId[id] ?? [])
      : undefined;
  }

  function treasurySafesForParent(parent: Squad): TreasurySafeEntry[] {
    return $treasurySafesByParentId[parent.id] ?? [];
  }

  async function handleConfirmImportSafe(params: {
    safeAddress: string;
    chain: string;
    label: string;
    entryId: string;
    txHash?: string;
  }) {
    if (!openHubParent || !onConfirmImportSafe) return;
    await onConfirmImportSafe(openHubParent, params);
  }
</script>

<div class="parent-main">
  {#if openHubParent && visitedHubDashboards.length > 0}
    {#each visitedHubDashboards as hub (hub.key)}
      <div
        class="hub-dashboard-keep-alive"
        hidden={!(showParentDashboard && currentHubDashboardKey === hub.key)}
      >
        <ParentDashboard
          parent={openHubParent}
          warGameStack={hub.warGameStack}
          treasurySafes={treasurySafesForParent(openHubParent)}
          squadInfraRows={squadInfraRowsForParent(openHubParent)}
          onConfirmImportSafe={handleConfirmImportSafe}
          {onPactoGovDeployComplete}
          {onSponsorDeployComplete}
          {onSquadAdminDeployComplete}
        />
      </div>
    {/each}
  {/if}
  {#if showSquadSettings && openHubParent}
    {#key `${openHubParent.id}:${SETTINGS_CHANNEL_ID}`}
      <SquadSettingsView parent={openHubParent} />
    {/key}
  {:else if showMlsChatView}
    {#if ChatViewComponent}
      <ChatViewComponent />
    {:else}
      <p class="surface-loading muted" role="status">{$t('app.loading.channel')}</p>
    {/if}
  {:else if showCreatingLoader}
    <p class="surface-loading muted" role="status">{$t('app.loading.squad')}</p>
  {:else if showOpenFailed}
    <p class="surface-loading muted" role="status">{$t('app.squadOpenFailed')}</p>
  {:else if !showParentDashboard}
    <p class="surface-loading muted" role="status">{$t('app.selectSquadChannel')}</p>
  {/if}
</div>

<style>
  .parent-main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .hub-dashboard-keep-alive {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .hub-dashboard-keep-alive[hidden] {
    display: none;
  }

  .surface-loading {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-muted);
  }
</style>
