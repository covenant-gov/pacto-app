<script lang="ts">
  import Modal from '../../ui/Modal.svelte';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { deploySquadAdminForParent } from '../../../lib/governance/api';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { parseWalletOpError } from '../../../lib/wallet/backend-wallet';

  export let parentId: string;
  /** When set, deploy uses captain_hat variant with this hat id. */
  export let captainHatId: string | null = null;
  export let onClose: () => void;
  export let onComplete: (result: {
    txHash: string;
    chain: string;
    squadAdminProxy: string;
    providerPayload: string;
    infraRowId: string;
  }) => Promise<void>;

  const titleId = 'deploy-squad-admin-title';
  const descId = 'deploy-squad-admin-desc';

  let deployNetwork: SupportedChainId = 'sepolia';
  let deployError = '';
  let deploying = false;

  $: variant = captainHatId?.trim() ? ('captain_hat' as const) : ('ext_standalone' as const);

  async function confirmDeploy() {
    deployError = '';
    deploying = true;
    try {
      const result = await deploySquadAdminForParent({
        network: deployNetwork,
        parentId: parentId.trim(),
        variant,
        captainHatId: captainHatId?.trim() || null,
      });
      await onComplete({
        txHash: result.txHash,
        chain: result.chain,
        squadAdminProxy: result.squadAdminProxy,
        providerPayload: result.providerPayload,
        infraRowId: result.infraRowId,
      });
      onClose();
    } catch (e) {
      let raw = getInvokeErrorMessage(e, 'Squad Admin deploy failed.');
      const parsed = parseWalletOpError(raw);
      if (parsed?.message) raw = parsed.message;
      deployError = raw;
    } finally {
      deploying = false;
    }
  }
</script>

<Modal {titleId} descriptionId={descId} {onClose} dismissible={!deploying} contentClass="deploy-squad-admin-panel">
  <h2 id={titleId}>Deploy Squad Admin</h2>
  <p id={descId} class="squad-admin-deploy-desc">
    {#if variant === 'captain_hat'}
      Creates a hat-gated Squad Admin clone for captain hat <code>{captainHatId}</code>.
    {:else}
      Creates an address-gated Squad Admin clone owned by your embedded wallet. Use Settings → Manage squad roles to
      register roles and assign executors.
    {/if}
    Gas is paid from your embedded wallet.
  </p>

  <div class="squad-admin-deploy-field">
    <label class="squad-admin-deploy-label" for="squad-admin-deploy-network">Network</label>
    <select
      id="squad-admin-deploy-network"
      class="squad-admin-deploy-input squad-admin-deploy-select"
      bind:value={deployNetwork}
      disabled={deploying}
    >
      <option value="sepolia">Sepolia</option>
      <option value="mainnet">Ethereum</option>
      <option value="optimism">Optimism</option>
    </select>
  </div>

  {#if deployError}
    <p class="input-error" role="alert">{deployError}</p>
  {/if}

  <div class="modal-actions">
    <button type="button" class="btn-secondary" on:click={onClose} disabled={deploying}>Cancel</button>
    <button type="button" class="btn-primary" on:click={confirmDeploy} disabled={deploying}>
      {deploying ? 'Deploying…' : 'Deploy on-chain'}
    </button>
  </div>
</Modal>

<style>
  .squad-admin-deploy-desc {
    margin: 0 0 16px;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--text-secondary);
    max-width: 52ch;
  }

  .squad-admin-deploy-field {
    margin-bottom: 14px;
  }

  .squad-admin-deploy-label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-muted);
    margin-bottom: 6px;
  }

  .squad-admin-deploy-input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .squad-admin-deploy-select {
    max-width: 240px;
  }
</style>
