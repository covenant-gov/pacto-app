<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Modal from '../../ui/Modal.svelte';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';
  import { resolveSquadRosterEvmAddress } from '../../../lib/squad/squad-roster-binding';
  import { getActiveSquadEvmSignerAddress } from '../../../lib/wallet/evm-accounts';
  import {
    amountExceedsBalance,
    canonicalAddress,
    emptyBalance,
    fetchEvmBalance,
    reconcileSignerWallet,
    shortAddress,
    shouldPreferFundedDefault,
    withTimeout,
    type SignerBalance,
  } from '../../../lib/wallet/signer-balance';
  import type { PactoGovCaptainOption } from '../../../lib/governance/start-pacto-gov-deploy';
  import type { SquadSponsorDeploySignerWallet } from '../../../lib/governance/api';
  import {
    bootstrapCrewCandidates,
    canBootstrapCrewDuringDeploy,
    startHatsSponsorOnlyDeploy,
    startPactoGovAndSponsorDeploy,
    type CombinedGovSponsorDeployComplete,
  } from '../../../lib/governance/start-pacto-gov-and-sponsor-deploy';
  import { normalizeLeadingDotDecimalInput } from '../../../lib/wallet/amount-input';
  import { parseEther } from 'viem';

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
  let resolvingAddresses = true;
  let deployError = '';
  let initialDepositEth = '';
  let bootstrapCrew = false;
  let progressStep: '' | 'gov' | 'sponsor' | 'bootstrap' = '';
  let signerWallet: SquadSponsorDeploySignerWallet = 'squad';
  let defaultSignerAddress: string | null = null;
  let squadSignerAddress: string | null = null;
  let defaultBalance: SignerBalance = emptyBalance();
  let squadBalance: SignerBalance = emptyBalance();
  let refreshSeq = 0;
  let preferredPayerOnce = false;
  let deploying = false;
  let closed = false;

  $: sponsorOnly = !!existingTopHatId.trim();

  const SIGNER_LOOKUP_TIMEOUT_MS = 15_000;

  async function refreshSigners() {
    const seq = ++refreshSeq;
    resolvingAddresses = true;
    deployError = '';
    try {
      const [defaultAddr, squadAddr] = await withTimeout(
        Promise.all([
          getActiveSquadEvmSignerAddress(),
          resolveSquadRosterEvmAddress(parentId.trim()),
        ]),
        SIGNER_LOOKUP_TIMEOUT_MS,
        'Signer lookup',
      );
      if (seq !== refreshSeq) return;
      defaultSignerAddress = defaultAddr?.trim() || null;
      squadSignerAddress = squadAddr?.trim() || null;
      // MVP: deployer roster is always captain (hats + sponsor ACL).
      captainAddress = canonicalAddress(squadSignerAddress) ?? '';
      signerWallet = reconcileSignerWallet(signerWallet, defaultSignerAddress, squadSignerAddress);
    } catch (e) {
      if (seq === refreshSeq) {
        deployError = e instanceof Error ? e.message : 'Could not load signer addresses.';
        defaultSignerAddress = null;
        squadSignerAddress = null;
        captainAddress = '';
      }
    } finally {
      if (seq === refreshSeq) resolvingAddresses = false;
    }
    if (seq !== refreshSeq) return;
    const [defaultBal, squadBal] = await Promise.all([
      fetchEvmBalance(squadNetwork, defaultSignerAddress, {
        timeoutMs: SIGNER_LOOKUP_TIMEOUT_MS,
      }),
      fetchEvmBalance(squadNetwork, squadSignerAddress, { timeoutMs: SIGNER_LOOKUP_TIMEOUT_MS }),
    ]);
    if (seq !== refreshSeq) return;
    defaultBalance = defaultBal;
    squadBalance = squadBal;
    if (
      !preferredPayerOnce &&
      shouldPreferFundedDefault({
        defaultSignerAddress,
        squadSignerAddress,
        defaultBalanceRaw: defaultBalance.balanceRaw,
        squadBalanceRaw: squadBalance.balanceRaw,
      })
    ) {
      signerWallet = 'default';
      preferredPayerOnce = true;
    }
  }

  onMount(() => {
    void refreshSigners();
  });

  onDestroy(() => {
    closed = true;
    refreshSeq += 1;
  });

  $: defaultCanonical = canonicalAddress(defaultSignerAddress);
  $: squadCanonical = canonicalAddress(squadSignerAddress);
  $: signersAreSame =
    defaultCanonical != null && squadCanonical != null && defaultCanonical === squadCanonical;
  $: payFromEffective = (signersAreSame ? 'squad' : signerWallet) as SquadSponsorDeploySignerWallet;

  $: selectedBalance = signersAreSame
    ? squadBalance
    : signerWallet === 'default'
      ? defaultBalance
      : squadBalance;

  $: depositTrimmed = initialDepositEth.trim();
  $: depositExceedsBalance =
    depositTrimmed.length > 0 &&
    !selectedBalance.loading &&
    !selectedBalance.error &&
    amountExceedsBalance(depositTrimmed, selectedBalance.balanceRaw);

  $: bootstrapAllowed = canBootstrapCrewDuringDeploy({
    captainAddress,
    squadRosterAddress: squadSignerAddress,
    payFrom: payFromEffective,
  });
  $: if (!bootstrapAllowed && bootstrapCrew) {
    bootstrapCrew = false;
  }

  $: crewPreview = bootstrapCrewCandidates(captainMemberOptions, captainAddress).map((addr) => {
    const key = addr.toLowerCase();
    const opt = captainMemberOptions.find((o) => o.address.toLowerCase() === key);
    return { address: addr, label: opt?.label?.trim() || '' };
  });

  function onDepositInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    initialDepositEth = normalizeLeadingDotDecimalInput(el.value);
  }

  function executeDeploy() {
    if (deploying) return;
    deployError = '';
    progressStep = '';
    if (!squadNetwork) {
      deployError = 'Set the squad network in Settings before deploying.';
      return;
    }
    if (resolvingAddresses) {
      deployError = 'Loading signer addresses…';
      return;
    }
    if (!captainAddress || !squadCanonical) {
      deployError = 'Bind a squad-assigned EVM before deploying — you become captain.';
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
    if (depositExceedsBalance) {
      deployError = 'Deposit must leave room for gas on the selected payer.';
      return;
    }

    const payFrom = payFromEffective;
    const doBootstrap =
      bootstrapCrew &&
      canBootstrapCrewDuringDeploy({
        captainAddress,
        squadRosterAddress: squadSignerAddress,
        payFrom,
      });

    const onProgress = (step: 'gov' | 'sponsor' | 'bootstrap') => {
      if (!closed) progressStep = step;
    };
    const onReject = (message: string) => {
      deploying = false;
      deployError = message;
    };
    const onError = (message: string) => {
      deploying = false;
      deployError = message;
      progressStep = '';
    };
    const handleComplete = async (out: CombinedGovSponsorDeployComplete) => {
      await onComplete(out);
      onClose();
    };

    deploying = true;
    const ok = sponsorOnly
      ? startHatsSponsorOnlyDeploy({
          parentId: parentId.trim(),
          squadNetwork,
          topHatId: existingTopHatId.trim(),
          initialDepositWei: depositWei,
          bootstrapCrew: doBootstrap,
          memberOptions: captainMemberOptions,
          quartermaster: quartermaster.trim() || undefined,
          captainAddress: captainAddress || undefined,
          signerWallet: payFrom,
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
          bootstrapCrew: doBootstrap,
          memberOptions: captainMemberOptions,
          signerWallet: payFrom,
          onProgress,
          onReject,
          onError,
          onComplete: handleComplete,
        });
    if (!ok) {
      deploying = false;
    }
  }

  $: deployDisabled =
    deploying ||
    !squadNetwork ||
    resolvingAddresses ||
    depositExceedsBalance ||
    !squadCanonical ||
    !captainAddress ||
    (signersAreSame ? !squadCanonical : signerWallet === 'default' ? !defaultCanonical : !squadCanonical);
</script>

<Modal {titleId} descriptionId={descId} {onClose} dismissible={!deploying} contentClass="deploy-gov-sponsor-panel">
  <h2 id={titleId}>
    {sponsorOnly ? 'Deploy squad sponsor' : 'Deploy Pacto Gov + squad sponsor'}
  </h2>
  <p id={descId} class="deploy-desc">
    {#if sponsorOnly}
      Governance is live. Deploys a hats-linked sponsor for this squad’s top hat. Anyone may deposit;
      sponsorship follows captain and crew hats. Gas and deposit come from the payer below — not from hat
      identity.
    {:else}
      Deploys Nave Pirata (Hats + Safe), then a hats-linked sponsor. You become captain on your
      squad-assigned EVM. Pay gas and the sponsor deposit from Default or that key — Default pays only and
      does not receive hats.
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

  {#if signersAreSame}
    <div class="signer-single" aria-live="polite">
      <span class="label">Pay gas and deposit from</span>
      <p class="signer-single-addr">
        <code>{shortAddress(squadCanonical)}</code>
        <span class="muted note">Squad signer</span>
      </p>
      <p class="signer-balance muted">
        {#if resolvingAddresses || squadBalance.loading}
          Balance: …
        {:else if squadBalance.error}
          Balance unavailable
        {:else}
          Balance: {squadBalance.balanceDecimal} {squadBalance.symbol}
        {/if}
      </p>
    </div>
  {:else}
    <fieldset class="signer-fieldset" disabled={resolvingAddresses}>
      <legend class="label">Pay gas and deposit from</legend>
      <div class="signer-options">
        <label class="signer-option" class:selected={signerWallet === 'default'}>
          <input
            type="radio"
            name="gov-sponsor-deploy-signer"
            value="default"
            bind:group={signerWallet}
            disabled={!defaultSignerAddress}
          />
          <span class="signer-option-body">
            <span class="signer-option-title">Default signer</span>
            <span class="signer-option-sub">Same as DM wallet — pays only; no hats</span>
            <code class="signer-addr">{shortAddress(defaultSignerAddress)}</code>
            <span class="signer-balance">
              {#if resolvingAddresses || defaultBalance.loading}
                Balance: …
              {:else if defaultBalance.error}
                Balance unavailable
              {:else if defaultSignerAddress}
                Balance: {defaultBalance.balanceDecimal} {defaultBalance.symbol}
              {:else}
                Not configured
              {/if}
            </span>
          </span>
        </label>

        <label class="signer-option" class:selected={signerWallet === 'squad'}>
          <input
            type="radio"
            name="gov-sponsor-deploy-signer"
            value="squad"
            bind:group={signerWallet}
            disabled={!squadSignerAddress}
          />
          <span class="signer-option-body">
            <span class="signer-option-title">Squad-assigned signer</span>
            <span class="signer-option-sub">Bound to this squad roster</span>
            <code class="signer-addr">{shortAddress(squadSignerAddress)}</code>
            <span class="signer-balance">
              {#if resolvingAddresses || squadBalance.loading}
                Balance: …
              {:else if squadBalance.error}
                Balance unavailable
              {:else if squadSignerAddress}
                Balance: {squadBalance.balanceDecimal} {squadBalance.symbol}
              {:else}
                Not assigned
              {/if}
            </span>
          </span>
        </label>
      </div>
    </fieldset>
  {/if}

  <div class="field">
    <span class="label">Captain</span>
    {#if resolvingAddresses}
      <p class="hint muted">Loading your squad-assigned EVM…</p>
    {:else if squadCanonical}
      <p class="pinned">
        <code>{shortAddress(squadCanonical)}</code>
        <span class="muted note">· your squad-assigned EVM</span>
      </p>
      <p class="hint muted">
        {#if sponsorOnly}
          Hats sponsor and crew bootstrap require the captain hat on this address.
        {:else}
          Captain hat is minted here. Fee payer may differ; Default never receives hats.
        {/if}
      </p>
    {:else}
      <p class="hint muted">Bind a squad-assigned EVM for this squad before deploying.</p>
    {/if}
  </div>

  <div class="field">
    <label class="label" for="gov-sponsor-deposit">Initial sponsor deposit (ETH)</label>
    <input
      id="gov-sponsor-deposit"
      class="input"
      class:input-invalid={depositExceedsBalance}
      type="text"
      inputmode="decimal"
      placeholder="0.01"
      value={initialDepositEth}
      on:input={onDepositInput}
    />
    {#if depositExceedsBalance}
      <p class="input-error" role="alert">
        Deposit must stay below {selectedBalance.balanceDecimal}
        {selectedBalance.symbol} so this wallet can pay gas.
      </p>
    {/if}
  </div>

  <div class="field bootstrap-field">
    <label class="bootstrap-label" class:bootstrap-disabled={!bootstrapAllowed}>
      <input type="checkbox" bind:checked={bootstrapCrew} disabled={!bootstrapAllowed} />
      Bootstrap crew hats now
    </label>
    {#if !bootstrapAllowed}
      <p class="hint muted">
        {#if payFromEffective === 'default'}
          Not available when Default pays — switch to your squad-assigned signer, or mint crew later from
          Governance → Captain.
        {:else}
          Requires your squad-assigned EVM as captain. Mint later from Governance → Captain if needed.
        {/if}
      </p>
    {:else}
      <p class="hint muted">
        Optional. Mints crew hats for other squad-assigned EVMs. Signed by your captain key (self-funded
        when it has ETH; otherwise sponsored from the pool if eligible).
      </p>
    {/if}
    {#if bootstrapCrew && sponsorOnly && !quartermaster.trim()}
      <p class="hint warn-hint">
        Quartermaster address missing from gov payload — bootstrap will fail until it is present.
      </p>
    {/if}
    {#if bootstrapCrew && bootstrapAllowed}
      {#if crewPreview.length === 0}
        <p class="hint muted">No non-captain shared addresses to include yet.</p>
      {:else}
        <ul class="preview-list">
          {#each crewPreview as row (row.address)}
            <li>
              {#if row.label}
                <span class="preview-label">{row.label}</span>
                <span class="preview-sep">—</span>
              {/if}
              <code>{shortAddress(row.address)}</code>
            </li>
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
    <button type="button" class="btn-secondary" on:click={onClose} disabled={deploying}>Cancel</button>
    <button type="button" class="btn-primary" disabled={deployDisabled} on:click={executeDeploy}>
      {deploying ? 'Deploying…' : 'Deploy'}
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
  .input-invalid {
    border-color: var(--danger, #e53e3e);
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
  .bootstrap-disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .preview-list {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .preview-list li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }
  .preview-label {
    color: var(--text-primary);
  }
  .preview-sep {
    color: var(--text-muted);
  }
  .preview-list code {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
  .muted {
    color: var(--text-muted);
  }
  .signer-fieldset {
    margin: 0 0 14px;
    padding: 0;
    border: none;
    min-width: 0;
  }
  .signer-single {
    margin: 0 0 14px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
  }
  .signer-single-addr {
    margin: 4px 0 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
    font-size: 0.9375rem;
  }
  .signer-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .signer-option {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    cursor: pointer;
  }
  .signer-option.selected {
    border-color: var(--accent, #2dd4bf);
  }
  .signer-option-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .signer-option-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .signer-option-sub {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .signer-addr {
    font-size: 0.75rem;
    color: var(--text-secondary);
    word-break: break-all;
  }
  .signer-balance {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .input-error {
    margin: 6px 0 0;
    font-size: 0.8125rem;
    color: var(--danger, #e53e3e);
  }
</style>
