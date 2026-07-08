<script lang="ts">
  import type { GovernanceUpdatedPayload } from '../../lib/announcements';
  import { getWalletNetworkDisplayName } from '../../lib/wallet/assets';
  import { parseSupportedChainId } from '../../lib/wallet/chains';
  import { formatMessageTimestamp } from '../../lib/utils/message-formatting';
  import { profiles } from '../../stores/profiles';
  import { getProfileDisplayName } from '../../lib/utils/profile';
  import PactoGovInfraList from '../parent/governance/PactoGovInfraList.svelte';

  export let payload: GovernanceUpdatedPayload;
  export let authorName: string;
  export let authorNpub: string | undefined = undefined;
  export let timestamp: string;

  $: displayName =
    (authorNpub ? getProfileDisplayName($profiles[authorNpub]) : '') || authorName || 'A member';
  $: networkLabel = getWalletNetworkDisplayName(parseSupportedChainId(payload.chain));
</script>

<div class="pacto-gov-deploy-body">
  <p class="pacto-gov-deploy-title">{displayName} deployed Pacto Gov</p>
  {#if networkLabel}
    <p class="pacto-gov-deploy-network">{networkLabel}</p>
  {/if}
  <PactoGovInfraList
    providerPayload={payload.provider_payload}
    topHatId={payload.canonical_ref ?? ''}
    chain={payload.chain}
  />
  {#if timestamp}
    <p class="pacto-gov-deploy-meta">{formatMessageTimestamp(timestamp)}</p>
  {/if}
</div>

<style>
  .pacto-gov-deploy-body {
    flex: 1;
    min-width: 0;
  }

  .pacto-gov-deploy-title {
    margin: 0;
    font-weight: 600;
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--text-primary);
  }

  .pacto-gov-deploy-network {
    margin: 4px 0 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .pacto-gov-deploy-meta {
    margin: 10px 0 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
