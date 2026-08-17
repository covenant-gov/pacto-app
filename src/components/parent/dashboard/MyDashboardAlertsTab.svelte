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

  export let parentId = '';
  export let announcementsGroupId: string | null = null;

  let showRosterCard = false;
  let loading = true;

  $: prompts = ($govActionPromptsBySquadId[parentId] ?? []) as GovActionPrompt[];
  $: hasGovPrompts = prompts.length > 0;

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

<style>
  .muted {
    color: var(--text-muted);
    font-size: 0.875rem;
    padding: 8px 0;
  }
</style>
