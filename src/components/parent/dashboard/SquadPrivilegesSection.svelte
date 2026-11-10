<script lang="ts">
  import { t } from 'svelte-i18n';
  import DashboardAssetCard from './DashboardAssetCard.svelte';
  import type { ResolvedSquadAdminContext } from '../../../lib/governance/squad-admin-payload';
  import { openSquadCrewPrivileges } from '../../../lib/navigation/open-squad-dashboard';

  let {
    parentId = '',
    privilegesAdmin = null,
    pactoGovRevision = '',
  }: {
    parentId?: string;
    privilegesAdmin?: ResolvedSquadAdminContext | null;
    pactoGovRevision?: string;
    /** Unused — privileges manage UI lives under Crew. */
    memberEvmOptions?: { address: string; label: string }[];
  } = $props();

  const canManage = $derived(!!privilegesAdmin?.proxy?.trim());
</script>

{#if canManage || pactoGovRevision}
  <DashboardAssetCard headingId="squad-privileges-heading" heading={$t('governance.crew.privilegesLabel')}>
    {#snippet headerAction()}
      {#if canManage}
        <button type="button" class="btn-text" onclick={() => openSquadCrewPrivileges(parentId)}>
          {$t('governance.privileges.openInCrew')}
        </button>
      {/if}
    {/snippet}
    <p class="muted">{$t('governance.privileges.settingsPointer')}</p>
    {#if pactoGovRevision}
      <code class="rev">{pactoGovRevision}</code>
    {/if}
  </DashboardAssetCard>
{/if}

<style>
  .btn-text {
    padding: 4px 8px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .muted {
    margin: 0 0 8px;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .rev {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
