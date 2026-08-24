<script lang="ts">
  import { t } from 'svelte-i18n';
  import DashboardAssetCard from './DashboardAssetCard.svelte';
  import SquadRolesModal from '../governance/SquadRolesModal.svelte';
  import type { ResolvedSquadAdminContext } from '../../../lib/governance/squad-admin-payload';
  import { DEFAULT_CHAIN_ID, parseSupportedChainId } from '../../../lib/wallet/chains';

  let {
    parentId = '',
    privilegesAdmin = null,
    pactoGovRevision = '',
    memberEvmOptions = [],
  }: {
    parentId?: string;
    privilegesAdmin?: ResolvedSquadAdminContext | null;
    pactoGovRevision?: string;
    memberEvmOptions?: { address: string; label: string }[];
  } = $props();

  let showSquadRolesModal = $state(false);

  const canManage = $derived(!!privilegesAdmin?.proxy?.trim());
  const network = $derived(parseSupportedChainId(privilegesAdmin?.chain?.trim() || DEFAULT_CHAIN_ID));
  const warGameStack = $derived(privilegesAdmin?.source === 'pacto_gov_wargame');
</script>

{#if canManage || pactoGovRevision}
  <DashboardAssetCard headingId="squad-privileges-heading" heading={$t('governance.crew.privilegesLabel')}>
    {#snippet headerAction()}
      {#if canManage}
        <button type="button" class="btn-text" onclick={() => (showSquadRolesModal = true)}>
          {$t('governance.crew.manage')}
        </button>
      {/if}
    {/snippet}
    {#if pactoGovRevision}
      <code class="rev">{pactoGovRevision}</code>
    {/if}
  </DashboardAssetCard>
{/if}

{#if privilegesAdmin}
  <SquadRolesModal
    open={showSquadRolesModal}
    onClose={() => (showSquadRolesModal = false)}
    {parentId}
    squadAdminProxy={privilegesAdmin.proxy}
    {network}
    {memberEvmOptions}
    {warGameStack}
  />
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
  .rev {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
