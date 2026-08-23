<script lang="ts">
  import { t } from 'svelte-i18n';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import SquadRosterKeyInboxCard from '../../inbox/SquadRosterKeyInboxCard.svelte';
  import GovActionPromptCard from './GovActionPromptCard.svelte';
  import { needsSquadRosterKeyChoice } from '../../../lib/squad/squad-roster-key-choice';
  import {
    govActionPromptsBySquadId,
    refreshGovActionPromptsForSquad,
  } from '../../../stores/gov-action-prompts';
  import { squads } from '../../../stores/squads';
  import type { GovActionPrompt } from '../../../lib/governance/gov-action-prompts';

  interface Props {
    parentId?: string;
    announcementsGroupId?: string | null;
  }

  let { parentId = '', announcementsGroupId = null }: Props = $props();

  let showRosterCard = $state(false);
  let loading = $state(true);

  const prompts = $derived(($govActionPromptsBySquadId[parentId] ?? []) as GovActionPrompt[]);
  const hasGovPrompts = $derived(prompts.length > 0);

  async function refreshNeed() {
    if (!parentId) {
      showRosterCard = false;
      loading = false;
      return;
    }
    loading = true;
    try {
      showRosterCard = await needsSquadRosterKeyChoice(parentId, announcementsGroupId);
      const squad = get(squads).find((s) => s.id === parentId);
      if (squad) {
        await refreshGovActionPromptsForSquad(squad);
      }
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void refreshNeed();
  });
</script>

<section class="dashboard-section" aria-labelledby="my-alerts-heading">
  <h3 id="my-alerts-heading" class="section-heading">{$t('governance.dashboardView.alerts')}</h3>
  {#if loading && !showRosterCard && !hasGovPrompts}
    <p class="muted">{$t('governance.alerts.loading')}</p>
  {:else}
    {#if showRosterCard && announcementsGroupId}
      <SquadRosterKeyInboxCard
        {parentId}
        announcementsGroupId={announcementsGroupId}
        onComplete={() => {
          showRosterCard = false;
        }}
      />
    {/if}

    {#each prompts as prompt (prompt.sourceEventId)}
      <GovActionPromptCard {prompt} />
    {/each}

    {#if !showRosterCard && !hasGovPrompts}
      <p class="muted">{$t('governance.alerts.empty')}</p>
    {/if}
  {/if}
</section>

<style>
  .dashboard-section {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }
  .section-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0 0 12px;
  }
  .muted {
    color: var(--text-muted);
    font-size: 0.875rem;
    padding: 8px 0;
  }
</style>
