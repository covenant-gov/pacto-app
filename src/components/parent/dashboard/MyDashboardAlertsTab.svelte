<script lang="ts">
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
  <p class="muted">Loading alerts…</p>
{:else if showRosterCard && announcementsGroupId}
  <SquadRosterKeyInboxCard
    {parentId}
    announcementsGroupId={announcementsGroupId}
    onComplete={() => {
      showRosterCard = false;
    }}
  />
{:else}
  <p class="muted">No personal alerts right now.</p>
{/if}

<style>
  .muted {
    color: var(--text-muted);
    font-size: 0.875rem;
    padding: 8px 0;
  }
</style>
