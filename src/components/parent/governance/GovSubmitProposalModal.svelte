<script lang="ts">
  import { t } from 'svelte-i18n';
  import Modal from '../../ui/Modal.svelte';
  import GovProposeForm from './GovProposeForm.svelte';
  import type { GovernancePrivilege } from '../../../lib/governance/governance-privilege';

  let {
    open = false,
    onClose = () => {},
    network,
    parentId,
    treasuryAuthority,
    privilege,
    fundingHint = '',
    capabilitiesPending = false,
    onSubmitted = () => {},
  }: {
    open?: boolean;
    onClose?: () => void;
    network: string;
    parentId: string;
    treasuryAuthority: string;
    privilege: GovernancePrivilege;
    fundingHint?: string;
    capabilitiesPending?: boolean;
    onSubmitted?: () => void;
  } = $props();

  const titleId = 'gov-submit-proposal-title';
</script>

{#if open}
  <Modal {titleId} {onClose} contentClass="gov-action-modal">
    <h2 id={titleId} class="modal-title">{$t('governance.section.submitProposal')}</h2>
    <GovProposeForm
      {network}
      {parentId}
      {treasuryAuthority}
      {privilege}
      {fundingHint}
      {capabilitiesPending}
      onSubmitted={() => {
        onSubmitted();
        onClose();
      }}
    />
  </Modal>
{/if}

<style>
  :global(.gov-action-modal) {
    max-width: 32rem;
  }
  .modal-title {
    margin: 0 0 12px;
    font-size: 1.0625rem;
    font-weight: 600;
  }
</style>
