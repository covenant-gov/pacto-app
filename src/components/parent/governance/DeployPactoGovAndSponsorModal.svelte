<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../../ui/Modal.svelte';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';
  import { resolveSquadRosterEvmAddress } from '../../../lib/squad/squad-roster-binding';
  import type { PactoGovCaptainOption } from '../../../lib/governance/start-pacto-gov-deploy';
  import {
    bootstrapCrewCandidates,
    startHatsSponsorOnlyDeploy,
    startPactoGovAndSponsorDeploy,
    type CombinedGovSponsorDeployComplete,
  } from '../../../lib/governance/start-pacto-gov-and-sponsor-deploy';
  import { normalizeLeadingDotDecimalInput } from '../../../lib/wallet/amount-input';
  import { getAddress, isAddress, parseEther } from 'viem';

  export let parentId: string;
  export let squadNetwork: SupportedChainId | null = null;
  export let captainMemberOptions: PactoGovCaptainOption[] = [];
  /** When set, skips Nave Pirata and deploys hats sponsor for this top hat. */
  export let existingTopHatId = '';
  /** Required for bootstrap when finishing sponsor after gov already exists. */
  export let quartermaster = '';
  export let onClose: () => void;
  export let onComplete: (out: CombinedGovSponsorDeployComplete) => void | Promise<void>;

  const titleId = 'deploy-gov-sponsor-title';
  const descId = 'deploy-gov-sponsor-desc';

  let captainAddress = '';
  let resolvingDeployer = true;
  let deployError = '';
  let initialDepositEth = '';
  let bootstrapCrew = false;
  let progressStep: '' | 'gov' | 'sponsor' | 'bootstrap' = '';

  $: sponsorOnly = !!existingTopHatId.trim();

  function shortAddress(addr: string): string {
    if (addr.length < 18) return addr;
    return `${addr.slice(0, 10)}…${addr.slice(-8)}`;
  }

  function pickDefaultCaptain(deployer: string | null) {
    if (captainAddress) return;
    const opts = captainMemberOptions;
    if (deployer) {
      const match = opts.find((o) => o.address.toLowerCase() === deployer.toLowerCase());
      if (match) {
        captainAddress = match.address;
        return;
      }
    }
    if (opts.length > 0) captainAddress = opts[0].address;
  }

  onMount(async () => {
    resolvingDeployer = true;
    let deployer: string | null = null;
    try {
      const raw = await resolveSquadRosterEvmAddress(parentId.trim());
      if (raw?.trim() && isAddress(raw.trim() as `0x${string}`)) {
        deployer = getAddress(raw.trim() as `0x${string}`);
      }
    } catch {
      // fall through
    } finally {
      resolvingDeployer = false;
    }
    pickDefaultCaptain(deployer);
  });

  $: if (!resolvingDeployer && !captainAddress && captainMemberOptions.length > 0) {
    pickDefaultCaptain(null);
  }

  $: crewPreview = bootstrapCrewCandidates(captainMemberOptions, captainAddress);

  function onDepositInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    initialDepositEth = normalizeLeadingDotDecimalInput(el.value);
  }

  function executeDeploy() {
    deployError = '';
    progressStep = '';
    if (!squadNetwork) {
      deployError = 'Set the squad network in Settings before deploying.';
      return;
    }
    if (resolvingDeployer) {
      deployError = 'Loading your squad EVM address…';
      return;
    }
    if (!sponsorOnly && !captainAddress) {
      deployError = 'Pick a captain with a shared squad EVM address.';
      return;
    }
    let depositWei: string;
    try {
      const wei = parseEther(initialDepositEth.trim().replace(/,/g, '') || '0');
      if (wei <= 0n) {
        deployError = 'Enter an initial sponsor deposit greater than zero.';
        return;
      }
      depositWei = wei.toString();
    } catch {
      deployError = 'Invalid deposit amount.';
      return;
    }

    const onProgress = (step: 'gov' | 'sponsor' | 'bootstrap') => {
      progressStep = step;
    };
    const onReject = (message: string) => {
      deployError = message;
    };
    const onError = (message: string) => {
      deployError = message;
      progressStep = '';
    };
    const handleComplete = async (out: CombinedGovSponsorDeployComplete) => {
      await onComplete(out);
      onClose();
    };

    const ok = sponsorOnly
      ? startHatsSponsorOnlyDeploy({
          parentId: parentId.trim(),
          squadNetwork,
          topHatId: existingTopHatId.trim(),
          initialDepositWei: depositWei,
          bootstrapCrew,
          memberOptions: captainMemberOptions,
          quartermaster: quartermaster.trim() || undefined,
          captainAddress: captainAddress || undefined,
          onProgress,
          onReject,
          onError,
          onComplete: handleComplete,
        })
      : startPactoGovAndSponsorDeploy({
          parentId: parentId.trim(),
          squadNetwork,
          captain: captainAddress,
          initialDepositWei: depositWei,
          bootstrapCrew,
          memberOptions: captainMemberOptions,
          onProgress,
          onReject,
          onError,
          onComplete: handleComplete,
        });
    if (ok) {
      onClose();
    }
  }

  $: deployDisabled =
    !squadNetwork ||
    resolvingDeployer ||
    (!sponsorOnly && (captainMemberOptions.length === 0 || !captainAddress));
</script>

<Modal {titleId} descriptionId={descId} {onClose} dismissible contentClass="deploy-gov-sponsor-panel">
  <h2 id={titleId}>
    {sponsorOnly ? 'Deploy squad sponsor' : 'Deploy Pacto Gov + squad sponsor'}
  </h2>
  <p id={descId} class="deploy-desc">
    {#if sponsorOnly}
      Governance is live. Deploys a hats-linked sponsor for this squad’s top hat. Optional crew bootstrap
      mints via quartermaster.
    {:else}
      Deploys Nave Pirata (Hats + Safe), then a hats-linked sponsor. Gas sponsorship follows captain and crew
      hats. If you pick someone else as captain, you only get a crew hat when bootstrap runs.
    {/if}
  </p>

  <div class="field">
    <span class="label">Squad network</span>
    {#if squadNetwork}
      <p class="pinned">
        {getWalletNetworkDisplayName(squadNetwork)}
        <span class="muted note">· change in Settings</span>
      </p>
    {:else}
      <p class="pinned warn">Not set — choose a network in Settings before deploying.</p>
    {/if}
  </div>

  {#if !sponsorOnly}
    <div class="field">
      <label class="label" for="gov-sponsor-captain">Captain</label>
      {#if captainMemberOptions.length === 0}
        <p class="hint muted">No members have shared an EVM address yet.</p>
      {:else}
        <select
          id="gov-sponsor-captain"
          class="select"
          bind:value={captainAddress}
          disabled={resolvingDeployer}
        >
          {#each captainMemberOptions as opt (opt.npub)}
            <option value={opt.address}>{opt.label} — {shortAddress(opt.address)}</option>
          {/each}
        </select>
      {/if}
    </div>
  {:else if captainMemberOptions.length > 0}
    <div class="field">
      <label class="label" for="gov-sponsor-captain">Captain (bootstrap exclude)</label>
      <select
        id="gov-sponsor-captain"
        class="select"
        bind:value={captainAddress}
        disabled={resolvingDeployer}
      >
        {#each captainMemberOptions as opt (opt.npub)}
          <option value={opt.address}>{opt.label} — {shortAddress(opt.address)}</option>
        {/each}
      </select>
      <p class="hint muted">Used only to skip the captain when bootstrapping crew hats.</p>
    </div>
  {/if}

  <div class="field">
    <label class="label" for="gov-sponsor-deposit">Initial sponsor deposit (ETH)</label>
    <input
      id="gov-sponsor-deposit"
      class="input"
      type="text"
      inputmode="decimal"
      placeholder="0.01"
      value={initialDepositEth}
      on:input={onDepositInput}
    />
  </div>

  <div class="field bootstrap-field">
    <label class="bootstrap-label">
      <input type="checkbox" bind:checked={bootstrapCrew} />
      Bootstrap crew hats now
    </label>
    <p class="hint muted">
      Optional. Only members who already shared an EVM (except the captain) are minted. Skip if keys are
      incomplete — mint later from Governance → Captain.
    </p>
    {#if bootstrapCrew && sponsorOnly && !quartermaster.trim()}
      <p class="hint warn-hint">Quartermaster address missing from gov payload — bootstrap will fail until it is present.</p>
    {/if}
    {#if bootstrapCrew}
      {#if crewPreview.length === 0}
        <p class="hint muted">No non-captain shared addresses to include yet.</p>
      {:else}
        <ul class="preview-list">
          {#each crewPreview as addr (addr)}
            <li><code>{shortAddress(addr)}</code></li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>

  {#if progressStep}
    <p class="muted" role="status">
      {#if progressStep === 'gov'}
        Deploying governance…
      {:else if progressStep === 'sponsor'}
        Deploying hats sponsor…
      {:else}
        Bootstrapping crew…
      {/if}
    </p>
  {/if}

  {#if deployError}
    <p class="input-error" role="alert">{deployError}</p>
  {/if}

  <div class="modal-actions">
    <button type="button" class="btn-secondary" on:click={onClose}>Cancel</button>
    <button type="button" class="btn-primary" disabled={deployDisabled} on:click={executeDeploy}>
      Deploy
    </button>
  </div>
</Modal>

<style>
  .deploy-desc {
    margin: 0 0 16px;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--text-secondary);
    max-width: 52ch;
  }
  .field {
    margin-bottom: 14px;
  }
  .label {
    display: block;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin: 0 0 6px;
  }
  .pinned {
    margin: 0;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated, var(--bg-panel));
    color: var(--text-primary);
    font-size: 0.9375rem;
  }
  .pinned.warn {
    color: var(--text-secondary);
  }
  .note {
    font-size: 0.8125rem;
  }
  .select,
  .input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.9375rem;
  }
  .hint {
    margin: 6px 0 0;
    font-size: 0.8125rem;
    line-height: 1.4;
  }
  .warn-hint {
    color: var(--danger, #e53e3e);
  }
  .bootstrap-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.875rem;
    color: var(--text-primary);
    cursor: pointer;
  }
  .preview-list {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .preview-list code {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
  .muted {
    color: var(--text-muted);
  }
</style>
