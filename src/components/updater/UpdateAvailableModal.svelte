<script lang="ts">
  import Modal from '../ui/Modal.svelte';
  import UpdateAvailablePanel from './UpdateAvailablePanel.svelte';
  import { updateStatus } from '../../lib/updater/update-check';

  $: open = $updateStatus.status === 'available' || $updateStatus.status === 'downloading' || $updateStatus.status === 'installing' || $updateStatus.status === 'error' || $updateStatus.relaunchPending;

  function closeModal(): void {
    // Only allow closing while idle; progress and errors keep the modal open.
    const status = $updateStatus.status;
    if (status === 'downloading' || status === 'installing') return;
    updateStatus.reset();
  }
</script>

{#if open}
  <Modal titleId="update-available-title" onClose={closeModal} dismissible={$updateStatus.status !== 'downloading' && $updateStatus.status !== 'installing'}>
    <div class="update-modal">
      <h2 id="update-available-title">Update available</h2>
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
