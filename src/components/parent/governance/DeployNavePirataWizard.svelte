<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../../ui/Modal.svelte';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { getEvmAddress } from '../../../lib/api/auth';
  import { deployNavePirataForParent } from '../../../lib/governance/api';
  import { runOnChainInBackground } from '../../../lib/evm/on-chain-background';
  import { getAddress, isAddress } from 'viem';
  import SquadDeployNetworkField from './SquadDeployNetworkField.svelte';

  export let parentId: string;
  /** Established squad network; when set the picker is pinned to it. */
  export let squadNetwork: SupportedChainId | null = null;
  export let onClose: () => void;
  export let onComplete: (result: {
    txHash: string;
    chain: string;
    topHatId: string;
    safeAddress: string;
    providerPayload: string;
  }) => Promise<void>;

  const titleId = 'nave-pirata-wizard-title';
  const descId = 'nave-pirata-wizard-desc';

  let wizardStep: 1 | 2 | 3 = 1;
  let deployNetwork: SupportedChainId | '' = squadNetwork ?? '';
  let captainInput = '';
  let metadataUriInput = '';
  let saltNonceInput = '';
  let deployError = '';

  onMount(async () => {
    try {
      const addr = await getEvmAddress();
      if (addr?.trim() && isAddress(addr.trim() as `0x${string}`)) {
        captainInput = getAddress(addr.trim() as `0x${string}`);
      }
    } catch {
      /* optional default */
    }
  });

  function normalizedCaptain(): string | null {
    const t = captainInput.trim();
    if (!t || !isAddress(t as `0x${string}`)) return null;
    try {
      return getAddress(t as `0x${string}`);
    } catch {
      return null;
    }
  }

  function nextFromStep1() {
    deployError = '';
    if (!deployNetwork) {
      deployError = 'Select a network for this squad.';
      return;
    }
    wizardStep = 2;
  }

  function backToStep1() {
    deployError = '';
    wizardStep = 1;
  }

  function nextFromStep2() {
    deployError = '';
    const cap = normalizedCaptain();
    if (!cap) {
      deployError = 'Enter a valid captain wallet address (0x…).';
      return;
    }
    if (!metadataUriInput.trim()) {
      deployError = 'Metadata URI is required (e.g. IPFS or HTTPS JSON).';
      return;
    }
    wizardStep = 3;
  }

  function backToStep2() {
    deployError = '';
    wizardStep = 2;
  }

  async function confirmDeploy() {
    deployError = '';
    if (!deployNetwork) {
      deployError = 'Select a network for this squad.';
      return;
    }
    const cap = normalizedCaptain();
    if (!cap || !metadataUriInput.trim()) {
      deployError = 'Captain and metadata URI are required.';
      return;
    }
    const jobParams = {
      network: deployNetwork,
      parentId: parentId.trim(),
      captain: cap,
      metadataUri: metadataUriInput.trim(),
      saltNonce: saltNonceInput.trim() ? saltNonceInput.trim() : null,
    };
    onClose();
    runOnChainInBackground({
      startedToast: 'Pacto Gov deploy submitted. Confirmation continues in the background.',
      subject: 'Pacto Gov deploy',
      job: () => deployNavePirataForParent(jobParams),
      onSuccess: async (result) => {
        await onComplete({
          txHash: result.txHash,
          chain: result.chain,
          topHatId: result.topHatId,
          safeAddress: result.safeAddress,
          providerPayload: result.providerPayload,
        });
      },
    });
  }
</script>

<Modal
  {titleId}
  descriptionId={descId}
  {onClose}
  dismissible
  contentClass="deploy-nave-pirata-modal-panel"
>
  <h2 id={titleId}>Deploy Pacto Gov</h2>
  <p id={descId} class="nave-wizard-desc">
    Deploy the Nave Pirata factory bundle for this squad. Gas is paid from your embedded wallet. Factory and master
    copy addresses must be configured for this machine (see env vars in <code class="nave-wizard-code">nave_pirata_deploy</code>
    module docs).
  </p>

  <ol class="nave-wizard-steps" aria-label="Wizard progress">
    <li class:nave-wizard-step-done={wizardStep >= 1} class:nave-wizard-step-active={wizardStep === 1}>Network</li>
    <li class:nave-wizard-step-done={wizardStep >= 2} class:nave-wizard-step-active={wizardStep === 2}>Captain &amp; URI</li>
    <li class:nave-wizard-step-done={wizardStep >= 3} class:nave-wizard-step-active={wizardStep === 3}>Confirm</li>
  </ol>

  {#if wizardStep === 1}
    <div class="nave-wizard-field">
      <SquadDeployNetworkField
        id="nave-deploy-network"
        {squadNetwork}
        bind:value={deployNetwork}
        labelClass="nave-wizard-field-label"
        selectClass="nave-wizard-field-input nave-wizard-field-select"
      />
    </div>
    {#if deployError}
      <p class="input-error" role="alert">{deployError}</p>
    {/if}
    <p class="muted nave-wizard-hint">
      {#if squadNetwork}
        This squad's infrastructure is on {deployNetwork}. Uses the same RPC configuration as the embedded wallet.
      {:else}
        Locks this squad to the chosen network. Uses the same RPC configuration as the embedded wallet.
      {/if}
    </p>
    <div class="modal-actions nave-wizard-actions">
      <button type="button" class="btn-secondary" on:click={onClose}>Cancel</button>
      <button type="button" class="btn-primary" on:click={nextFromStep1}>Continue</button>
    </div>
  {:else if wizardStep === 2}
    <div class="nave-wizard-field">
      <label class="nave-wizard-field-label" for="nave-captain">Captain (EVM)</label>
      <input
        id="nave-captain"
        type="text"
        class="nave-wizard-field-input"
        placeholder="0x…"
        bind:value={captainInput}
        autocomplete="off"
      />
    </div>
    <div class="nave-wizard-field">
      <label class="nave-wizard-field-label" for="nave-metadata">Metadata URI</label>
      <input
        id="nave-metadata"
        type="text"
        class="nave-wizard-field-input"
        placeholder="https://… or ipfs://…"
        bind:value={metadataUriInput}
        autocomplete="off"
      />
    </div>
    <div class="nave-wizard-field">
      <label class="nave-wizard-field-label" for="nave-salt">Salt nonce (optional)</label>
      <input
        id="nave-salt"
        type="text"
        class="nave-wizard-field-input"
        placeholder="Decimal or 0x hex — empty uses an automatic nonce"
        bind:value={saltNonceInput}
        autocomplete="off"
      />
    </div>
    {#if deployError}
      <p class="input-error" role="alert">{deployError}</p>
    {/if}
    <div class="modal-actions nave-wizard-actions">
      <button type="button" class="btn-secondary" on:click={backToStep1}>Back</button>
      <button type="button" class="btn-primary" on:click={nextFromStep2}>Continue</button>
    </div>
  {:else}
    <dl class="nave-wizard-review">
      <dt>Network</dt>
      <dd>{deployNetwork}</dd>
      <dt>Captain</dt>
      <dd><code class="nave-review-code">{normalizedCaptain() ?? '—'}</code></dd>
      <dt>Metadata URI</dt>
      <dd class="nave-review-uri">{metadataUriInput.trim() || '—'}</dd>
      {#if saltNonceInput.trim()}
        <dt>Salt nonce</dt>
        <dd><code class="nave-review-code">{saltNonceInput.trim()}</code></dd>
      {/if}
    </dl>
    <p class="muted nave-wizard-hint">
      Squad timing defaults match production scripts (seven-day crew change / expiry, majority snapshot, 30% quorum).
    </p>
    {#if deployError}
      <p class="input-error" role="alert">{deployError}</p>
    {/if}
    <div class="modal-actions nave-wizard-actions">
      <button type="button" class="btn-secondary" on:click={backToStep2}>Back</button>
      <button type="button" class="btn-primary" on:click={confirmDeploy}>
        Deploy on-chain
      </button>
    </div>
  {/if}
</Modal>

<style>
  .nave-wizard-desc {
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--text-secondary);
    margin: 0 0 14px;
  }

  .nave-wizard-code {
    font-size: 0.8125rem;
  }

  .nave-wizard-steps {
    display: flex;
    gap: 12px;
    list-style: none;
    margin: 0 0 18px;
    padding: 0;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .nave-wizard-steps li {
    padding: 4px 0;
    border-bottom: 2px solid transparent;
  }

  .nave-wizard-step-active {
    color: var(--text-primary);
    border-bottom-color: var(--accent, var(--text-primary));
  }

  .nave-wizard-step-done:not(.nave-wizard-step-active) {
    opacity: 0.75;
  }

  .nave-wizard-hint {
    font-size: 0.8125rem;
    margin: 8px 0 0;
  }

  .nave-wizard-field {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    margin-bottom: 16px;
    width: 100%;
  }

  .nave-wizard-field-label {
    display: block;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin: 0;
    width: 100%;
  }

  .nave-wizard-field-input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.875rem;
    margin: 0;
  }

  .nave-wizard-field-select {
    cursor: pointer;
  }

  .nave-wizard-field-input:disabled,
  .nave-wizard-field-select:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .nave-wizard-actions {
    margin-top: 18px;
  }

  .nave-wizard-review {
    margin: 0;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 16px;
    font-size: 0.875rem;
  }

  .nave-wizard-review dt {
    margin: 0;
    color: var(--text-muted);
    font-weight: 500;
  }

  .nave-wizard-review dd {
    margin: 0;
    word-break: break-word;
  }

  .nave-review-code {
    font-size: 0.8125rem;
  }

  .nave-review-uri {
    font-size: 0.8125rem;
    word-break: break-all;
  }
</style>
