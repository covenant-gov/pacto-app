<script lang="ts">
  import Modal from '../ui/Modal.svelte';

  export let open: boolean;
  export let address: string;
  export let onClose: () => void;

  const titleId = 'wallet-receive-title';
  const descId = 'wallet-receive-desc';

  let copied = false;
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address.trim());
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      /* ignore */
    }
  }
</script>

{#if open && address.trim()}
  <Modal {titleId} descriptionId={descId} {onClose}>
    <h2 id={titleId}>Receive</h2>
    <p id={descId} class="receive-desc">
      Share this address to receive ETH and supported tokens on EVM networks where your wallet is active.
    </p>

    <div class="receive-address-row">
      <code class="receive-address">{address.trim()}</code>
      <button type="button" class="receive-copy" on:click={copyAddress}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  </Modal>
{/if}

<style>
  .receive-desc {
    margin: 0 0 20px;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .receive-address-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    flex-wrap: wrap;
  }

  .receive-address {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding: 10px 12px;
    font-size: 0.8125rem;
    line-height: 1.45;
    word-break: break-all;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-family: ui-monospace, monospace;
  }

  .receive-copy {
    flex-shrink: 0;
    padding: 10px 14px;
    font-size: 0.875rem;
    font-weight: 500;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-hover);
    color: var(--text-primary);
    cursor: pointer;
    font-family: inherit;
  }

  .receive-copy:hover {
    border-color: var(--text-muted);
  }
</style>
