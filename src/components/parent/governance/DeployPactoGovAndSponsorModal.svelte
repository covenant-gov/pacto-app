<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
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
  import {
    PRODUCTION_SQUAD_PARAMS,
    squadParamsIfCustomized,
    validateSquadParams,
  } from '../../../lib/governance/squad-params';
  import SquadParamsCustomizeFields from './SquadParamsCustomizeFields.svelte';
  import SquadRosterEvmGatePanel from './SquadRosterEvmGatePanel.svelte';
  import { normalizeLeadingDotDecimalInput } from '../../../lib/wallet/amount-input';
  import { walletBuildAndSendTransaction } from '../../../lib/wallet/backend-wallet';
  import { waitForOnChainConfirmationInBackground } from '../../../lib/evm/on-chain-background';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { listSquadMemberEvmInvokeArgs } from '../../../lib/squad/squad-member-evm-share';
  import { formatEther, parseEther } from 'viem';

  let {
    parentId,
    announcementsGroupId = null,
    squadNetwork = null,
    captainMemberOptions = [],
    existingTopHatId = '',
    quartermaster = '',
    onClose,
    onComplete,
  }: {
    parentId: string;
    /** Prefer #announcements MLS id for roster resolve when it differs from parentId. */
    announcementsGroupId?: string | null;
    squadNetwork?: SupportedChainId | null;
    captainMemberOptions?: PactoGovCaptainOption[];
    /** When set, skips Nave Pirata and deploys hats sponsor for this top hat. */
    existingTopHatId?: string;
    /** Required for bootstrap when finishing sponsor after gov already exists. */
    quartermaster?: string;
    onClose: () => void;
    onComplete: (out: CombinedGovSponsorDeployComplete) => void | Promise<void>;
  } = $props();

  const titleId = 'deploy-gov-sponsor-title';
  const descId = 'deploy-gov-sponsor-desc';

  const tFn = get(t);

  let captainAddress = $state('');
  let resolvingAddresses = $state(true);
  let deployError = $state('');
  let fundTransferEth = $state('');
  let initialDepositEth = $state('');
  let bootstrapCrew = $state(false);
  let progressStep: '' | 'fund' | 'gov' | 'sponsor' | 'bootstrap' = $state('');
  let signerWallet = $state<SquadSponsorDeploySignerWallet>('squad');
  let defaultSignerAddress: string | null = $state(null);
  let squadSignerAddress: string | null = $state(null);
  let defaultBalance: SignerBalance = $state(emptyBalance());
  let squadBalance: SignerBalance = $state(emptyBalance());
  let refreshSeq = 0;
  let preferredPayerOnce = false;
  let deploying = $state(false);
  let closed = false;
  let customizeParams = $state(false);
  let crewChangeDelaySecs = $state(PRODUCTION_SQUAD_PARAMS.crewChangeDelaySecs);
  let proposalExpirySecs = $state(PRODUCTION_SQUAD_PARAMS.proposalExpirySecs);
  let crewVoteMode = $state(PRODUCTION_SQUAD_PARAMS.crewVoteMode);
  let quorumBps = $state(PRODUCTION_SQUAD_PARAMS.quorumBps);

  const sponsorOnly = $derived(!!existingTopHatId.trim());

  const SIGNER_LOOKUP_TIMEOUT_MS = 15_000;

  async function refreshSigners() {
    const seq = ++refreshSeq;
    resolvingAddresses = true;
    deployError = '';
    try {
      const rosterArgs = listSquadMemberEvmInvokeArgs(parentId.trim(), announcementsGroupId);
      const rosterLookupId = rosterArgs.parentId || parentId.trim();
      const [defaultAddr, squadAddr] = await Promise.race([
        Promise.all([
          getActiveSquadEvmSignerAddress(),
          resolveSquadRosterEvmAddress(rosterLookupId),
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  tFn('governance.deployGovAndSponsor.error.signerLookupTimeout', {
                    values: { seconds: SIGNER_LOOKUP_TIMEOUT_MS / 1000 },
                  }),
                ),
              ),
            SIGNER_LOOKUP_TIMEOUT_MS,
          ),
        ),
      ]);
      if (seq !== refreshSeq) return;
      defaultSignerAddress = defaultAddr?.trim() || null;
      squadSignerAddress = squadAddr?.trim() || null;
      // MVP: deployer roster is always captain (hats + sponsor ACL).
      captainAddress = canonicalAddress(squadSignerAddress) ?? '';
      signerWallet = reconcileSignerWallet(signerWallet, defaultSignerAddress, squadSignerAddress);
    } catch (e) {
      if (seq === refreshSeq) {
        deployError = e instanceof Error ? e.message : tFn('governance.deployGovAndSponsor.error.loadSigners');
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

  const defaultCanonical = $derived(canonicalAddress(defaultSignerAddress));
  const squadCanonical = $derived(canonicalAddress(squadSignerAddress));
  const signersAreSame = $derived(
    defaultCanonical != null && squadCanonical != null && defaultCanonical === squadCanonical,
  );
  const rosterLookupId = $derived(
    listSquadMemberEvmInvokeArgs(parentId.trim(), announcementsGroupId).parentId ||
      parentId.trim(),
  );
  const needsSquadEvmGate = $derived(!resolvingAddresses && !squadCanonical);
  /** Default only funds the squad key; on-chain deploy always signs as squad/captain. */
  const needsFundTransfer = $derived(!signersAreSame && signerWallet === 'default');
  const payFromEffective = $derived(
    (signersAreSame || needsFundTransfer ? 'squad' : signerWallet) as SquadSponsorDeploySignerWallet,
  );

  const selectedBalance = $derived(
    signersAreSame
      ? squadBalance
      : needsFundTransfer
        ? defaultBalance
        : signerWallet === 'default'
          ? defaultBalance
          : squadBalance,
  );

  const transferTrimmed = $derived(fundTransferEth.trim());
  const depositTrimmed = $derived(initialDepositEth.trim());

  const transferExceedsDefault = $derived(
    needsFundTransfer &&
      transferTrimmed.length > 0 &&
      !defaultBalance.loading &&
      !defaultBalance.error &&
      amountExceedsBalance(transferTrimmed, defaultBalance.balanceRaw),
  );

  const depositExceedsTransfer = $derived.by(() => {
    if (!needsFundTransfer || !depositTrimmed || !transferTrimmed) return false;
    try {
      const dep = parseEther(depositTrimmed.replace(/,/g, ''));
      const fund = parseEther(transferTrimmed.replace(/,/g, ''));
      return dep <= 0n || fund <= 0n || dep >= fund;
    } catch {
      return false;
    }
  });

  const depositExceedsBalance = $derived(
    needsFundTransfer
      ? depositExceedsTransfer
      : depositTrimmed.length > 0 &&
          !selectedBalance.loading &&
          !selectedBalance.error &&
          amountExceedsBalance(depositTrimmed, selectedBalance.balanceRaw),
  );

  const bootstrapAllowed = $derived(
    canBootstrapCrewDuringDeploy({
      captainAddress,
      squadRosterAddress: squadSignerAddress,
      payFrom: payFromEffective,
    }),
  );

  $effect(() => {
    if (!bootstrapAllowed && bootstrapCrew) {
      bootstrapCrew = false;
    }
  });

  /** Default is payer-only when it differs from the bound squad/captain key. */
  const bootstrapExcludeAddresses = $derived(
    defaultCanonical && squadCanonical && defaultCanonical !== squadCanonical ? [defaultCanonical] : [],
  );

  const crewPreview = $derived(
    bootstrapCrewCandidates(captainMemberOptions, captainAddress, bootstrapExcludeAddresses).map((addr) => {
      const key = addr.toLowerCase();
      const opt = captainMemberOptions.find((o) => o.address.toLowerCase() === key);
      return { address: addr, label: opt?.label?.trim() || '' };
    }),
  );

  function onTransferInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    fundTransferEth = normalizeLeadingDotDecimalInput(el.value);
  }

  function onDepositInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    initialDepositEth = normalizeLeadingDotDecimalInput(el.value);
  }

  async function executeDeploy() {
    if (deploying) return;
    deployError = '';
    progressStep = '';
    if (!squadNetwork) {
      deployError = tFn('governance.deployGovAndSponsor.error.noNetwork');
      return;
    }
    if (resolvingAddresses) {
      deployError = tFn('governance.deployGovAndSponsor.error.loadingSigners');
      return;
    }
    if (!captainAddress || !squadCanonical) {
      deployError = tFn('governance.deployGovAndSponsor.error.noBoundEvm');
      return;
    }

    const squadParams = sponsorOnly
      ? null
      : squadParamsIfCustomized(customizeParams, {
          crewChangeDelaySecs,
          proposalExpirySecs,
          crewVoteMode,
          quorumBps,
        });
    if (squadParams && validateSquadParams(squadParams)) {
      deployError = tFn('governance.squadParams.error.invalid');
      return;
    }

    let transferWei: bigint | null = null;
    if (needsFundTransfer) {
      if (!defaultCanonical) {
        deployError = tFn('governance.deployGovAndSponsor.error.noDefaultSigner');
        return;
      }
      try {
        transferWei = parseEther(transferTrimmed.replace(/,/g, '') || '0');
        if (transferWei <= 0n) {
          deployError = tFn('governance.deployGovAndSponsor.transfer.error.amountRequired');
          return;
        }
      } catch {
        deployError = tFn('governance.deployGovAndSponsor.transfer.error.invalidAmount');
        return;
      }
      if (transferExceedsDefault) {
        deployError = tFn('governance.deployGovAndSponsor.transfer.error.gasRoom');
        return;
      }
    }

    let depositWei: string;
    try {
      const wei = parseEther(depositTrimmed.replace(/,/g, '') || '0');
      if (wei <= 0n) {
        deployError = tFn('governance.deployGovAndSponsor.deposit.error.greaterThanZero');
        return;
      }
      if (transferWei != null && wei >= transferWei) {
        deployError = tFn('governance.deployGovAndSponsor.deposit.error.mustBeLessThanTransfer');
        return;
      }
      depositWei = wei.toString();
    } catch {
      deployError = tFn('governance.deployGovAndSponsor.deposit.error.invalid');
      return;
    }
    if (depositExceedsBalance) {
      deployError = needsFundTransfer
        ? tFn('governance.deployGovAndSponsor.deposit.error.lessThanTransferGas')
        : tFn('governance.deployGovAndSponsor.deposit.error.gasRoom');
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

    const startDeploy = () => {
      const ok = sponsorOnly
        ? startHatsSponsorOnlyDeploy({
            parentId: parentId.trim(),
            squadNetwork,
            topHatId: existingTopHatId.trim(),
            initialDepositWei: depositWei,
            bootstrapCrew: doBootstrap,
            memberOptions: captainMemberOptions,
            bootstrapExcludeAddresses,
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
            announcementsGroupId,
            squadNetwork,
            captain: captainAddress,
            initialDepositWei: depositWei,
            bootstrapCrew: doBootstrap,
            memberOptions: captainMemberOptions,
            bootstrapExcludeAddresses,
            signerWallet: payFrom,
            squadParams,
            onProgress,
            onReject,
            onError,
            onComplete: handleComplete,
          });
      if (!ok) {
        deploying = false;
        progressStep = '';
      }
    };

    deploying = true;

    if (needsFundTransfer && transferWei != null && squadCanonical && squadNetwork) {
      progressStep = 'fund';
      const send = await walletBuildAndSendTransaction(
        '',
        squadNetwork,
        'ETH',
        formatEther(transferWei),
        null,
        squadCanonical,
        false,
      );
      if (!send.ok) {
        deploying = false;
        progressStep = '';
        deployError = getInvokeErrorMessage(send.message, tFn('governance.deployGovAndSponsor.error.transferFailed'));
        return;
      }
      onClose();
      waitForOnChainConfirmationInBackground(squadNetwork, send.result.txHash, {
        subject: tFn('governance.deployGovAndSponsor.progress.fund'),
        parentId: parentId.trim(),
        actionKey: `gov-fund:${send.result.txHash}`,
        onConfirmed: () => {
          startDeploy();
        },
        onFailed: (message) => {
          deploying = false;
          progressStep = '';
          deployError = getInvokeErrorMessage(message, tFn('governance.deployGovAndSponsor.error.transferFailed'));
        },
      });
      return;
    }

    startDeploy();
  }

  const customizeInvalid = $derived(
    !sponsorOnly &&
      customizeParams &&
      !!validateSquadParams({
        crewChangeDelaySecs,
        proposalExpirySecs,
        crewVoteMode,
        quorumBps,
      }),
  );

  const deployDisabled = $derived(
    deploying ||
      !squadNetwork ||
      resolvingAddresses ||
      depositExceedsBalance ||
      transferExceedsDefault ||
      !squadCanonical ||
      !captainAddress ||
      customizeInvalid ||
      (needsFundTransfer && (!transferTrimmed || !defaultCanonical)) ||
      (signersAreSame ? !squadCanonical : signerWallet === 'default' ? !defaultCanonical : !squadCanonical),
  );
</script>

<Modal {titleId} descriptionId={descId} {onClose} dismissible contentClass="deploy-gov-sponsor-panel">
  <h2 id={titleId}>
    {$t(sponsorOnly ? 'governance.deployGovAndSponsor.title.sponsorOnly' : 'governance.deployGovAndSponsor.title.full')}
  </h2>
  <p id={descId} class="deploy-desc">
    {#if sponsorOnly}
      {$t('governance.deployGovAndSponsor.description.sponsorOnly')}
    {:else}
      {$t('governance.deployGovAndSponsor.description.full')}
    {/if}
  </p>

  <div class="field">
    <span class="label">{$t('governance.deployGovAndSponsor.labels.squadNetwork')}</span>
    {#if squadNetwork}
      <p class="pinned">
        {getWalletNetworkDisplayName(squadNetwork)}
        <span class="muted note">{$t('governance.common.changeInSettings')}</span>
      </p>
    {:else}
      <p class="pinned warn">{$t('governance.deployGovAndSponsor.networkNotSet')}</p>
    {/if}
  </div>

  {#if needsSquadEvmGate}
    <SquadRosterEvmGatePanel rosterLookupId={rosterLookupId} onBound={refreshSigners} />
  {:else}
  {#if signersAreSame}
    <div class="signer-single" aria-live="polite">
      <span class="label">{$t('governance.deployGovAndSponsor.labels.payFrom')}</span>
      <p class="signer-single-addr">
        <code>{shortAddress(squadCanonical)}</code>
        <span class="muted note">{$t('governance.deployGovAndSponsor.signer.singleNote')}</span>
      </p>
      <p class="signer-balance muted">
        {#if resolvingAddresses || squadBalance.loading}
          {$t('governance.common.balanceLoading')}
        {:else if squadBalance.error}
          {$t('governance.common.balanceUnavailable')}
        {:else}
          {$t('governance.common.balance', { values: { balance: squadBalance.balanceDecimal, symbol: squadBalance.symbol } })}
        {/if}
      </p>
    </div>
  {:else}
    <fieldset class="signer-fieldset" disabled={resolvingAddresses}>
      <legend class="label">{$t('governance.deployGovAndSponsor.labels.payFrom')}</legend>
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
            <span class="signer-option-title">{$t('governance.deployGovAndSponsor.signer.default.title')}</span>
            <span class="signer-option-sub">{$t('governance.deployGovAndSponsor.signer.default.sub')}</span>
            <code class="signer-addr">{shortAddress(defaultSignerAddress)}</code>
            <span class="signer-balance">
              {#if resolvingAddresses || defaultBalance.loading}
                {$t('governance.common.balanceLoading')}
              {:else if defaultBalance.error}
                {$t('governance.common.balanceUnavailable')}
              {:else if defaultSignerAddress}
                {$t('governance.common.balance', { values: { balance: defaultBalance.balanceDecimal, symbol: defaultBalance.symbol } })}
              {:else}
                {$t('governance.common.notConfigured')}
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
            <span class="signer-option-title">{$t('governance.deployGovAndSponsor.signer.squad.title')}</span>
            <span class="signer-option-sub">{$t('governance.deployGovAndSponsor.signer.squad.sub')}</span>
            <code class="signer-addr">{shortAddress(squadSignerAddress)}</code>
            <span class="signer-balance">
              {#if resolvingAddresses || squadBalance.loading}
                {$t('governance.common.balanceLoading')}
              {:else if squadBalance.error}
                {$t('governance.common.balanceUnavailable')}
              {:else if squadSignerAddress}
                {$t('governance.common.balance', { values: { balance: squadBalance.balanceDecimal, symbol: squadBalance.symbol } })}
              {:else}
                {$t('governance.common.notAssigned')}
              {/if}
            </span>
          </span>
        </label>
      </div>

      {#if needsFundTransfer}
        <div class="fund-transfer" aria-live="polite">
          <label class="label" for="gov-sponsor-fund-transfer">{$t('governance.deployGovAndSponsor.transfer.label')}</label>
          <input
            id="gov-sponsor-fund-transfer"
            class="input"
            class:input-invalid={transferExceedsDefault}
            type="text"
            inputmode="decimal"
            placeholder={$t('governance.deployGovAndSponsor.transfer.placeholder')}
            value={fundTransferEth}
            oninput={onTransferInput}
            disabled={deploying}
          />
          <p class="hint muted">
            {$t('governance.deployGovAndSponsor.transfer.hint')}
          </p>
          {#if transferExceedsDefault}
            <p class="input-error" role="alert">
              {$t('governance.deployGovAndSponsor.transfer.error.exceedsBalance', { values: { balance: defaultBalance.balanceDecimal, symbol: defaultBalance.symbol } })}
            </p>
          {/if}
        </div>
      {/if}
    </fieldset>
  {/if}

  <div class="field">
    <span class="label">{$t('governance.deployGovAndSponsor.captain.label')}</span>
    {#if resolvingAddresses}
      <p class="hint muted">{$t('governance.common.loadingSquadAssignedEvm')}</p>
    {:else if squadCanonical}
      <p class="pinned">
        <code>{shortAddress(squadCanonical)}</code>
        <span class="muted note">{$t('governance.common.yourSquadAssignedEvm')}</span>
      </p>
      <p class="hint muted">
        {#if sponsorOnly}
          {$t('governance.deployGovAndSponsor.captain.hint.sponsorOnly')}
        {:else}
          {$t('governance.deployGovAndSponsor.captain.hint.full')}
        {/if}
      </p>
    {:else}
      <p class="hint muted">{$t('governance.deployGovAndSponsor.captain.noEvm')}</p>
    {/if}
  </div>

  <div class="field">
    <label class="label" for="gov-sponsor-deposit">{$t('governance.deployGovAndSponsor.deposit.label')}</label>
    <input
      id="gov-sponsor-deposit"
      class="input"
      class:input-invalid={depositExceedsBalance}
      type="text"
      inputmode="decimal"
      placeholder={$t('governance.deployGovAndSponsor.deposit.placeholder')}
      value={initialDepositEth}
      oninput={onDepositInput}
      disabled={deploying}
    />
    {#if depositExceedsBalance}
      <p class="input-error" role="alert">
        {#if needsFundTransfer}
          {$t('governance.deployGovAndSponsor.deposit.error.exceedsTransfer')}
        {:else}
          {$t('governance.deployGovAndSponsor.deposit.error.exceedsBalance', { values: { balance: selectedBalance.balanceDecimal, symbol: selectedBalance.symbol } })}
        {/if}
      </p>
    {/if}
  </div>

  {#if !sponsorOnly}
    <SquadParamsCustomizeFields
      bind:customizing={customizeParams}
      bind:crewChangeDelaySecs
      bind:proposalExpirySecs
      bind:crewVoteMode
      bind:quorumBps
      disabled={deploying}
    />
  {/if}

  <div class="field bootstrap-field">
    <label class="bootstrap-label" class:bootstrap-disabled={!bootstrapAllowed}>
      <input type="checkbox" bind:checked={bootstrapCrew} disabled={!bootstrapAllowed} />
      {$t('governance.deployGovAndSponsor.bootstrap.label')}
    </label>
    {#if !bootstrapAllowed}
      <p class="hint muted">
        {$t('governance.deployGovAndSponsor.bootstrap.hint.disabled')}
      </p>
    {:else}
      <p class="hint muted">
        {$t('governance.deployGovAndSponsor.bootstrap.hint.enabled')}
      </p>
    {/if}
    {#if bootstrapCrew && sponsorOnly && !quartermaster.trim()}
      <p class="hint warn-hint">
        {$t('governance.deployGovAndSponsor.bootstrap.warning.noQuartermaster')}
      </p>
    {/if}
    {#if bootstrapCrew && bootstrapAllowed}
      {#if crewPreview.length === 0}
        <p class="hint muted">{$t('governance.deployGovAndSponsor.bootstrap.preview.empty')}</p>
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
  {/if}

  {#if progressStep}
    <p class="muted" role="status">
      {#if progressStep === 'fund'}
        {$t('governance.deployGovAndSponsor.progress.fund')}
      {:else if progressStep === 'gov'}
        {$t('governance.deployGovAndSponsor.progress.gov')}
      {:else if progressStep === 'sponsor'}
        {$t('governance.deployGovAndSponsor.progress.sponsor')}
      {:else}
        {$t('governance.deployGovAndSponsor.progress.bootstrap')}
      {/if}
    </p>
  {/if}

  {#if deployError}
    <p class="input-error" role="alert">{deployError}</p>
  {/if}

  <div class="modal-actions">
    <button type="button" class="btn-secondary" onclick={onClose} disabled={deploying}>{$t('governance.common.cancel')}</button>
    <button type="button" class="btn-primary btn-primary-action" disabled={deployDisabled} onclick={executeDeploy}>
      {deploying
        ? $t('governance.common.deploying')
        : needsSquadEvmGate
          ? $t('governance.deployGate.assignButton')
          : $t('governance.common.deploy')}
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
  .fund-transfer {
    margin-top: 10px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated, var(--bg-panel));
  }
  .fund-transfer .label {
    margin-bottom: 6px;
  }
  .fund-transfer .hint {
    margin-top: 6px;
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
    border-color: var(--brand, #2dd4bf);
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
  .btn-primary-action:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
