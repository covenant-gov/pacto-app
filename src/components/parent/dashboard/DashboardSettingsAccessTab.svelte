<script lang="ts">
  import SquadContentPolicySection from './SquadContentPolicySection.svelte';
  import SquadPrivilegesSection from './SquadPrivilegesSection.svelte';
  import type { ResolvedSquadAdminContext } from '../../../lib/governance/squad-admin-payload';
  import type { Squad } from '../../../stores/squads';
  import { resolvePollsMlsGroupId } from '../../../lib/parent-navbar';

  let {
    squad,
    parentId = '',
    privilegesAdmin = null,
    pactoGovRevision = '',
    memberEvmOptions = [],
  }: {
    squad: Squad;
    parentId?: string;
    privilegesAdmin?: ResolvedSquadAdminContext | null;
    pactoGovRevision?: string;
    memberEvmOptions?: { address: string; label: string }[];
  } = $props();
</script>

<div class="settings-stack">
  <SquadPrivilegesSection
    {parentId}
    {privilegesAdmin}
    {pactoGovRevision}
    {memberEvmOptions}
  />

  <SquadContentPolicySection parentId={squad.id} mlsGroupId={resolvePollsMlsGroupId(squad)} />
</div>

<style>
  .settings-stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
</style>
