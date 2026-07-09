<script lang="ts">
  import LaunchpadModal from '../governance/LaunchpadModal.svelte';
  import SquadRolesModal from '../governance/SquadRolesModal.svelte';
  import ChainIdSelect from '../../wallet/ChainIdSelect.svelte';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { DEFAULT_CHAIN_ID } from '../../../lib/wallet/chains';
  import {
    loadDeployPactoGovModal,
    loadDeploySafeModal,
    loadDeploySquadAdminModal,
    loadDeploySquadSponsorModal,
  } from '../../../lib/parent/deploy-wizard-components';
  import type { PactoGovCaptainOption, PactoGovDeployComplete } from '../../../lib/governance/start-pacto-gov-deploy';

  export let parentId: string;
  export let announcementsGroupId: string | null = null;
  export let treasurySafeCount = 0;
  export let hasSponsor = false;
  export let hasPactoGov = false;
  export let hasSquadAdmin = false;
  export let vaultSafeCount = 0;
  export let squadAdminProxy = '';
  export let squadAdminNetwork: SupportedChainId = DEFAULT_CHAIN_ID;
  /** Established squad network; deploy modals pin to it, or prompt a pick when null. */
  export let squadNetwork: SupportedChainId | null = null;
  /** Sponsor clone address when sponsor infra is deployed. */
  export let sponsorAddress = '';
  export let memberEvmOptions: { address: string; label: string }[] = [];
  export let captainMemberOptions: PactoGovCaptainOption[] = [];

  export let showDeploySafeModal = false;
  export let showLaunchpad = false;
  export let showPactoGovDeploy = false;
  export let showSponsorDeploy = false;
  export let showSquadAdminDeploy = false;
  export let showSquadRolesModal = false;
  export let showSetSafeModal = false;

  export let setSafeInput = '';
  export let setSafeChain: SupportedChainId = DEFAULT_CHAIN_ID;
  export let setSafeLabel = '';
  export let setSafeError = '';
  export let setSafeSaving = false;

  export let onDeploySafeSuccess: (params: {
    safeAddress: string;
    chain: string;
    label: string;
    entryId: string;
    txHash?: string;
  }) => Promise<void> = async () => {};
  export let onPactoGovComplete: (out: PactoGovDeployComplete) => Promise<void> = async () => {};
  export let onSquadAdminComplete: (out: {
    chain: string;
    squadAdminProxy: string;
    providerPayload: string;
    infraRowId: string;
  }) => Promise<void> = async () => {};
  export let onSponsorComplete: (out: {
    chain: string;
    sponsorAddress: string;
    providerPayload: string;
    infraRowId: string;
  }) => Promise<void> = async () => {};
  export let onConfirmSetSafe: () => void | Promise<void> = () => {};
  export let onCloseSetSafe: () => void = () => {};
  export let onCloseDeploySafe: () => void = () => {};
  export let onCloseLaunchpad: () => void = () => {};
  export let onClosePactoGovDeploy: () => void = () => {};
  export let onCloseSponsorDeploy: () => void = () => {};
  export let onCloseSquadAdminDeploy: () => void = () => {};
  export let onCloseSquadRolesModal: () => void = () => {};
  export let onDeploySponsor: () => void = () => {};
  export let onDeploySquadAdmin: () => void = () => {};
  export let onDeployPactoGov: () => void = () => {};
  export let onDeploySafe: () => void = () => {};
  export let onImportSafe: () => void = () => {};

  let DeploySafeModalComponent: Awaited<ReturnType<typeof loadDeploySafeModal>> | null = null;
  let DeploySquadSponsorComponent: Awaited<ReturnType<typeof loadDeploySquadSponsorModal>> | null = null;
  let DeploySquadAdminComponent: Awaited<ReturnType<typeof loadDeploySquadAdminModal>> | null = null;
  let DeployPactoGovModalComponent: Awaited<ReturnType<typeof loadDeployPactoGovModal>> | null = null;

  $: if (showDeploySafeModal && !DeploySafeModalComponent) {
    void loadDeploySafeModal().then((c) => {
      DeploySafeModalComponent = c;
    });
  }
  $: if (showPactoGovDeploy && !DeployPactoGovModalComponent) {
    void loadDeployPactoGovModal().then((c) => {
      DeployPactoGovModalComponent = c;
    });
  }
  $: if (showSponsorDeploy && !DeploySquadSponsorComponent) {
    void loadDeploySquadSponsorModal().then((c) => {
      DeploySquadSponsorComponent = c;
    });
  }
  $: if (showSquadAdminDeploy && !DeploySquadAdminComponent) {
    void loadDeploySquadAdminModal().then((c) => {
      DeploySquadAdminComponent = c;
    });
  }
</script>

{#if showDeploySafeModal && parentId}
  {#if DeploySafeModalComponent}
    <DeploySafeModalComponent
      {parentId}
      {announcementsGroupId}
      {treasurySafeCount}
      {squadNetwork}
      onClose={onCloseDeploySafe}
      onSuccess={onDeploySafeSuccess}
    />
  {:else}
    <div class="modal-overlay wizard-loading-overlay" role="status" aria-live="polite">
      <p class="wizard-loading-text">Loading deploy wizard…</p>
    </div>
  {/if}
{/if}

{#if showPactoGovDeploy && parentId.trim()}
  {#if DeployPactoGovModalComponent}
    <DeployPactoGovModalComponent
      parentId={parentId.trim()}
      {squadNetwork}
      {captainMemberOptions}
      onClose={onClosePactoGovDeploy}
      onComplete={onPactoGovComplete}
    />
  {:else}
    <div class="modal-overlay wizard-loading-overlay" role="status" aria-live="polite">
      <p class="wizard-loading-text">Loading deploy modal…</p>
    </div>
  {/if}
{/if}

{#if showLaunchpad && parentId}
  <LaunchpadModal
    {hasSponsor}
    {hasPactoGov}
    {hasSquadAdmin}
    {vaultSafeCount}
    {squadNetwork}
    {sponsorAddress}
    hasAnnouncementsChannel={!!announcementsGroupId}
    onClose={onCloseLaunchpad}
    onDeploySponsor={onDeploySponsor}
    onDeploySquadAdmin={onDeploySquadAdmin}
    onDeployPactoGov={onDeployPactoGov}
    onDeploySafe={onDeploySafe}
    onImportSafe={onImportSafe}
  />
{/if}

{#if showSquadAdminDeploy && parentId.trim()}
  {#if DeploySquadAdminComponent}
    <DeploySquadAdminComponent
      parentId={parentId.trim()}
      {squadNetwork}
      onClose={onCloseSquadAdminDeploy}
      onComplete={onSquadAdminComplete}
    />
  {:else}
    <div class="modal-overlay wizard-loading-overlay" role="status" aria-live="polite">
      <p class="wizard-loading-text">Loading deploy wizard…</p>
    </div>
  {/if}
{/if}

{#if showSponsorDeploy && parentId.trim()}
  {#if DeploySquadSponsorComponent}
    <DeploySquadSponsorComponent
      parentId={parentId.trim()}
      {squadNetwork}
      onClose={onCloseSponsorDeploy}
      onComplete={onSponsorComplete}
    />
  {:else}
    <div class="modal-overlay wizard-loading-overlay" role="status" aria-live="polite">
      <p class="wizard-loading-text">Loading deploy wizard…</p>
    </div>
  {/if}
{/if}

{#if showSetSafeModal}
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="set-safe-title">
    <div class="modal-content">
      <h3 id="set-safe-title">Import Safe</h3>
      <p class="modal-desc">
        Add a Safe to this squad treasury. Members see automated treasury notices in #personal-alerts.
      </p>
      <label class="modal-field-label" for="import-safe-addr">Contract address</label>
      <input
        id="import-safe-addr"
        type="text"
        class="input-address"
        placeholder="0x..."
        bind:value={setSafeInput}
        aria-invalid={setSafeError ? 'true' : undefined}
        aria-describedby={setSafeError ? 'set-safe-error' : undefined}
      />
      <label class="modal-field-label" for="import-safe-chain">Network</label>
      <ChainIdSelect id="import-safe-chain" bind:value={setSafeChain} disabled={setSafeSaving} />
      <label class="modal-field-label" for="import-safe-label">Label (optional)</label>
      <input
        id="import-safe-label"
        type="text"
        class="input-address"
        placeholder="e.g. Operations"
        bind:value={setSafeLabel}
      />
      {#if setSafeError}
        <p id="set-safe-error" class="input-error" role="alert">{setSafeError}</p>
      {/if}
      <div class="modal-actions">
        <button type="button" class="btn-secondary" on:click={onCloseSetSafe} disabled={setSafeSaving}>Cancel</button>
        <button type="button" class="btn-primary" on:click={onConfirmSetSafe} disabled={setSafeSaving}
          >{setSafeSaving ? 'Saving…' : 'Add to treasury'}</button
        >
      </div>
    </div>
  </div>
{/if}

<SquadRolesModal
  open={showSquadRolesModal}
  onClose={onCloseSquadRolesModal}
  {squadAdminProxy}
  network={squadAdminNetwork}
  {memberEvmOptions}
/>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-content {
    background: var(--bg-panel);
    border-radius: 12px;
    padding: 24px;
    min-width: 320px;
    max-width: 90vw;
  }

  .modal-content h3 {
    margin: 0 0 8px 0;
    font-size: 1.25rem;
  }

  .modal-desc {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0 0 8px 0;
  }

  .modal-field-label {
    display: block;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-muted);
    margin: 12px 0 4px 0;
  }

  .input-address {
    width: 100%;
    padding: 10px 12px;
    font-family: monospace;
    font-size: 0.875rem;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    margin-bottom: 8px;
    box-sizing: border-box;
  }

  .input-error {
    font-size: 0.8rem;
    color: var(--danger, #e53e3e);
    margin: 0 0 12px 0;
  }

  .modal-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    margin-top: 16px;
  }

  .wizard-loading-overlay {
    z-index: 1001;
  }

  .wizard-loading-text {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }
</style>
