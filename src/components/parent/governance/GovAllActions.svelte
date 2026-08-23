<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import GovCtaButton from './GovCtaButton.svelte';
  import GovHatRequiredBanner from './GovHatRequiredBanner.svelte';
  import GovSubmitProposalModal from './GovSubmitProposalModal.svelte';
  import GovVoteModeModal from './GovVoteModeModal.svelte';
  import {
    gateRequiresCaptainOrCrew,
    isHatRequiredReason,
    type CtaGate,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';

  let {
    network,
    parentId,
    treasuryAuthority,
    privilege,
    capabilitiesPending = false,
    onSubmitted = () => {},
  }: {
    network: string;
    parentId: string;
    treasuryAuthority: string;
    privilege: GovernancePrivilege;
    capabilitiesPending?: boolean;
    onSubmitted?: () => void;
  } = $props();

  const tFn = get(t);
  const PENDING_GATE: CtaGate = { enabled: false, reason: 'governance.status.loading' };
  const sharedGate = $derived(capabilitiesPending ? PENDING_GATE : gateRequiresCaptainOrCrew(privilege));

  let showPropose = $state(false);
  let showVoteMode = $state(false);
</script>

<div class="all-actions">
  {#if treasuryAuthority}
    {#if !sharedGate.enabled && isHatRequiredReason(sharedGate.reason)}
      <GovHatRequiredBanner reason={sharedGate.reason} />
    {/if}
    <div class="row">
      <GovCtaButton
        label={tFn('governance.action.submitProposal')}
        variant="primary"
        gate={sharedGate}
        onClick={() => (showPropose = true)}
      />
      <GovCtaButton
        label={tFn('governance.shell.openVoteMode')}
        variant="primary"
        gate={sharedGate}
        onClick={() => (showVoteMode = true)}
      />
    </div>
  {:else}
    <p class="muted">{$t('governance.governance.placeholder')}</p>
  {/if}
</div>

<GovSubmitProposalModal
  open={showPropose}
  onClose={() => (showPropose = false)}
  {network}
  {parentId}
  {treasuryAuthority}
  {privilege}
  {capabilitiesPending}
  {onSubmitted}
/>

<GovVoteModeModal
  open={showVoteMode}
  onClose={() => (showVoteMode = false)}
  {network}
  {parentId}
  {treasuryAuthority}
  {privilege}
  {onSubmitted}
/>

<style>
  .all-actions {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .muted {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
</style>
