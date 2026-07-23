<script lang="ts">
  import { t } from 'svelte-i18n';
  import SquadRosterKeyInboxCard from '../../inbox/SquadRosterKeyInboxCard.svelte';
  import { needsSquadRosterKeyChoice } from '../../../lib/squad/squad-roster-key-choice';
  import { onMount } from 'svelte';

  export let parentId = '';
  export let announcementsGroupId: string | null = null;

  let showRosterCard = false;
  let loading = true;

  async function refreshNeed() {
    if (!parentId) {
      showRosterCard = false;
      loading = false;
      return;
    }
    loading = true;
    try {
      showRosterCard = await needsSquadRosterKeyChoice(parentId, announcementsGroupId);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void refreshNeed();
  });
</script>

{#if loading}
  <p class="muted">{$t('governance.alerts.loading')}</p>
{:else if showRosterCard && announcementsGroupId}
  <SquadRosterKeyInboxCard
    {parentId}
    announcementsGroupId={announcementsGroupId}
    onComplete={() => {
      showRosterCard = false;
    }}
  />
{:else}
  <p class="muted">{$t('governance.alerts.empty')}</p>
{/if}

<style>
  .muted {
    color: var(--text-muted);
    font-size: 0.875rem;
    padding: 8px 0;
  }
</style>
