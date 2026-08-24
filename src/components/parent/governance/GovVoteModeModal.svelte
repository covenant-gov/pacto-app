<script lang="ts">
  import { t } from 'svelte-i18n';
  import Modal from '../../ui/Modal.svelte';
  import CrewVoteModeSettings from './CrewVoteModeSettings.svelte';
  import type { GovernancePrivilege } from '../../../lib/governance/governance-privilege';

  let {
    open = false,
    onClose = () => {},
    network,
    parentId,
    treasuryAuthority,
    privilege,
    onSubmitted = () => {},
  }: {
    open?: boolean;
    onClose?: () => void;
    network: string;
    parentId: string;
    treasuryAuthority: string;
    privilege: GovernancePrivilege;
    onSubmitted?: () => void;
  } = $props();

  const titleId = 'gov-vote-mode-title';
</script>

{#if open}
  <Modal {titleId} {onClose} contentClass="gov-action-modal">
    <h2 id={titleId} class="modal-title">{$t('governance.section.crewVoteSettings')}</h2>
    <CrewVoteModeSettings
      {network}
      {parentId}
      {treasuryAuthority}
      {privilege}
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
