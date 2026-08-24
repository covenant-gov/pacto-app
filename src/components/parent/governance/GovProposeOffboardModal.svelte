<script lang="ts">
  import { t } from 'svelte-i18n';
  import Modal from '../../ui/Modal.svelte';
  import GovCrewOffboardPanel from './GovCrewOffboardPanel.svelte';
  import type { QuartermasterStatusDto } from '../../../lib/governance/api';
  import type { GovernancePrivilege } from '../../../lib/governance/governance-privilege';

  let {
    open = false,
    onClose = () => {},
    network,
    parentId,
    quartermaster,
    privilege,
    mutinyActive = false,
    qmStatus = null,
    memberEvmOptions = [],
    memberOptionsLoading = false,
    onSubmitted = () => {},
  }: {
    open?: boolean;
    onClose?: () => void;
    network: string;
    parentId: string;
    quartermaster: string;
    privilege: GovernancePrivilege;
    mutinyActive?: boolean;
    qmStatus?: QuartermasterStatusDto | null;
    memberEvmOptions?: { address: string; label: string }[];
    memberOptionsLoading?: boolean;
    onSubmitted?: () => void;
  } = $props();

  const titleId = 'gov-propose-offboard-title';
</script>

{#if open}
  <Modal {titleId} {onClose} contentClass="gov-action-modal">
    <h2 id={titleId} class="modal-title">{$t('governance.action.proposeOffboard')}</h2>
    <GovCrewOffboardPanel
      {network}
      {parentId}
      {quartermaster}
      {privilege}
      {mutinyActive}
      {qmStatus}
      {memberEvmOptions}
      {memberOptionsLoading}
      onRefresh={() => {
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
