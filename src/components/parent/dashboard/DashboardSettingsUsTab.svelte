<script lang="ts">
  import SquadBroadcastSettingsSection from './SquadBroadcastSettingsSection.svelte';
  import SquadIdentitySection from './SquadIdentitySection.svelte';
  import SquadStickersSection from './SquadStickersSection.svelte';
  import type { Squad } from '../../../stores/squads';

  let {
    squad,
    announcementsGroupId = null,
  }: {
    squad: Squad;
    announcementsGroupId?: string | null;
  } = $props();
</script>

<div class="settings-stack">
  <SquadIdentitySection {squad} />
  <SquadBroadcastSettingsSection {squad} />
  <SquadStickersSection {squad} {announcementsGroupId} />
</div>

<style>
  .settings-stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
</style>
