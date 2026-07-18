<script lang="ts">
  import Modal from '../ui/Modal.svelte';
  import UpdateAvailablePanel from './UpdateAvailablePanel.svelte';
  import { updateStatus } from '../../lib/updater/update-check';

  $: open =
    $updateStatus.status === 'available' ||
    $updateStatus.status === 'downloading' ||
    $updateStatus.status === 'installing' ||
    $updateStatus.status === 'error' ||
    $updateStatus.relaunchPending;

  $: title =
    $updateStatus.status === 'error'
      ? 'Update check failed'
      : $updateStatus.relaunchPending
        ? 'Update installed'
        : 'Update available';

  function closeModal(): void {
    const status = $updateStatus.status;
    if (status === 'downloading' || status === 'installing') return;
    updateStatus.reset();
  }
</script>

{#if open}
  <Modal
    titleId="update-available-title"
    onClose={closeModal}
    dismissible={$updateStatus.status !== 'downloading' && $updateStatus.status !== 'installing'}
  >
    <div class="update-modal">
      <h2 id="update-available-title">{title}</h2>
      <UpdateAvailablePanel />
    </div>
  </Modal>
{/if}

<style>
  .update-modal {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .update-modal h2 {
    margin: 0;
  }
</style>
