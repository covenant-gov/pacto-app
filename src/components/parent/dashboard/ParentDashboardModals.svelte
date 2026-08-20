<script lang="ts">
  import { t } from 'svelte-i18n';
  import LaunchpadModal from '../governance/LaunchpadModal.svelte';
  import SquadRolesModal from '../governance/SquadRolesModal.svelte';
  import ChainIdSelect from '../../wallet/ChainIdSelect.svelte';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { DEFAULT_CHAIN_ID } from '../../../lib/wallet/chains';
  import {
    loadDeployPactoGovAndSponsorModal,
    loadDeployPactoGovModal,
    loadDeploySafeModal,
    loadDeploySquadAdminModal,
    loadDeploySquadSponsorExtModal,
  } from '../../../lib/parent/deploy-wizard-components';
  import type { PactoGovCaptainOption, PactoGovDeployComplete } from '../../../lib/governance/start-pacto-gov-deploy';
  import type { CombinedGovSponsorDeployComplete } from '../../../lib/governance/start-pacto-gov-and-sponsor-deploy';

  interface Props {
    parentId: string;
    announcementsGroupId?: string | null;
    treasurySafeCount?: number;
    hasSponsor?: boolean;
    hasPactoGov?: boolean;
    hasSquadAdmin?: boolean;
    squadAdminProxy?: string;
    squadAdminNetwork?: SupportedChainId;
    /** Established squad network; deploy modals pin to it, or prompt a pick when null. */
    squadNetwork?: SupportedChainId | null;
    /** Sponsor clone address when sponsor infra is deployed. */
    sponsorAddress?: string;
    /** Pacto Gov reference (Safe / proxy / top hat) when deployed. */
    pactoGovAddress?: string;
    memberEvmOptions?: { address: string; label: string }[];
    captainMemberOptions?: PactoGovCaptainOption[];

    showDeploySafeModal?: boolean;
    showLaunchpad?: boolean;
    showPactoGovDeploy?: boolean;
    showGovAndSponsorDeploy?: boolean;
    showExtSponsorDeploy?: boolean;
    showSquadAdminDeploy?: boolean;
    showSquadRolesModal?: boolean;
    showSetSafeModal?: boolean;
    /** When set, combined wizard finishes hats sponsor only. */
    existingTopHatId?: string;
    quartermaster?: string;

    setSafeInput?: string;
    setSafeChain?: SupportedChainId;
    setSafeLabel?: string;
    setSafeError?: string;
    setSafeSaving?: boolean;

    onDeploySafeSuccess?: (params: {
      safeAddress: string;
      chain: string;
      label: string;
      entryId: string;
      txHash?: string;
    }) => Promise<void>;
    onPactoGovComplete?: (out: PactoGovDeployComplete) => Promise<void>;
    onGovAndSponsorComplete?: (out: CombinedGovSponsorDeployComplete) => Promise<void>;
    onSquadAdminComplete?: (out: {
      chain: string;
      squadAdminProxy: string;
      providerPayload: string;
      infraRowId: string;
    }) => Promise<void>;
    onExtSponsorComplete?: (out: {
      txHash: string;
      chain: string;
      sponsorAddress: string;
      providerPayload: string;
      infraRowId: string;
    }) => Promise<void>;
    onConfirmSetSafe?: () => void | Promise<void>;
    onCloseSetSafe?: () => void;
    onCloseDeploySafe?: () => void;
    onCloseLaunchpad?: () => void;
    onClosePactoGovDeploy?: () => void;
    onCloseGovAndSponsorDeploy?: () => void;
    onCloseExtSponsorDeploy?: () => void;
    onCloseSquadAdminDeploy?: () => void;
    onCloseSquadRolesModal?: () => void;
    onDeploySquadAdmin?: () => void;
    onDeployPactoGov?: () => void;
    onDeployGovAndSponsor?: () => void;
    onDeployExtSponsor?: () => void;
  }

  let {
    parentId,
    announcementsGroupId = null,
    treasurySafeCount = 0,
    hasSponsor = false,
    hasPactoGov = false,
    hasSquadAdmin = false,
    squadAdminProxy = '',
    squadAdminNetwork = DEFAULT_CHAIN_ID,
    squadNetwork = null,
    sponsorAddress = '',
    pactoGovAddress = '',
    memberEvmOptions = [],
    captainMemberOptions = [],

    showDeploySafeModal = $bindable(false),
    showLaunchpad = $bindable(false),
    showPactoGovDeploy = $bindable(false),
    showGovAndSponsorDeploy = $bindable(false),
    showExtSponsorDeploy = $bindable(false),
    showSquadAdminDeploy = $bindable(false),
    showSquadRolesModal = $bindable(false),
    showSetSafeModal = $bindable(false),
    existingTopHatId = '',
    quartermaster = '',

    setSafeInput = $bindable(''),
    setSafeChain = $bindable(DEFAULT_CHAIN_ID),
    setSafeLabel = $bindable(''),
    setSafeError = $bindable(''),
    setSafeSaving = $bindable(false),

    onDeploySafeSuccess = async () => {},
    onPactoGovComplete = async () => {},
    onGovAndSponsorComplete = async () => {},
    onSquadAdminComplete = async () => {},
    onExtSponsorComplete = async () => {},
    onConfirmSetSafe = () => {},
    onCloseSetSafe = () => {},
    onCloseDeploySafe = () => {},
    onCloseLaunchpad = () => {},
    onClosePactoGovDeploy = () => {},
    onCloseGovAndSponsorDeploy = () => {},
    onCloseExtSponsorDeploy = () => {},
    onCloseSquadAdminDeploy = () => {},
    onCloseSquadRolesModal = () => {},
    onDeploySquadAdmin = () => {},
    onDeployPactoGov = () => {},
    onDeployGovAndSponsor = () => {},
    onDeployExtSponsor = () => {},
  }: Props = $props();

  let DeploySafeModalComponent = $state<Awaited<ReturnType<typeof loadDeploySafeModal>> | null>(null);
  let DeploySquadAdminComponent = $state<Awaited<ReturnType<typeof loadDeploySquadAdminModal>> | null>(null);
  let DeployPactoGovModalComponent = $state<Awaited<ReturnType<typeof loadDeployPactoGovModal>> | null>(null);
  let DeployGovAndSponsorComponent = $state<
    Awaited<ReturnType<typeof loadDeployPactoGovAndSponsorModal>> | null
  >(null);
  let DeployExtSponsorComponent = $state<Awaited<ReturnType<typeof loadDeploySquadSponsorExtModal>> | null>(
    null,
  );

  $effect(() => {
    if (showDeploySafeModal && !DeploySafeModalComponent) {
      void loadDeploySafeModal().then((c) => {
        DeploySafeModalComponent = c;
      });
    }
  });
  $effect(() => {
    if (showPactoGovDeploy && !DeployPactoGovModalComponent) {
      void loadDeployPactoGovModal().then((c) => {
        DeployPactoGovModalComponent = c;
      });
    }
  });
  $effect(() => {
    if (showGovAndSponsorDeploy && !DeployGovAndSponsorComponent) {
      void loadDeployPactoGovAndSponsorModal().then((c) => {
        DeployGovAndSponsorComponent = c;
      });
    }
  });
  $effect(() => {
    if (showSquadAdminDeploy && !DeploySquadAdminComponent) {
      void loadDeploySquadAdminModal().then((c) => {
        DeploySquadAdminComponent = c;
      });
    }
  });
  $effect(() => {
    if (showExtSponsorDeploy && !DeployExtSponsorComponent) {
      void loadDeploySquadSponsorExtModal().then((c) => {
        DeployExtSponsorComponent = c;
      });
    }
  });
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
      <p class="wizard-loading-text">{$t('governance.importSafe.wizardLoading')}</p>
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
      <p class="wizard-loading-text">{$t('governance.importSafe.modalLoading')}</p>
    </div>
  {/if}
{/if}

{#if showGovAndSponsorDeploy && parentId.trim()}
  {#if DeployGovAndSponsorComponent}
    <DeployGovAndSponsorComponent
      parentId={parentId.trim()}
      announcementsGroupId={announcementsGroupId?.trim() || null}
      {squadNetwork}
      {captainMemberOptions}
      {existingTopHatId}
      {quartermaster}
      onClose={onCloseGovAndSponsorDeploy}
      onComplete={onGovAndSponsorComplete}
    />
  {:else}
    <div class="modal-overlay wizard-loading-overlay" role="status" aria-live="polite">
      <p class="wizard-loading-text">{$t('governance.importSafe.modalLoading')}</p>
    </div>
  {/if}
{/if}

{#if showLaunchpad && parentId}
  <LaunchpadModal
    {hasSponsor}
    {hasPactoGov}
    {hasSquadAdmin}
    {sponsorAddress}
    {pactoGovAddress}
    squadAdminAddress={squadAdminProxy}
    hasAnnouncementsChannel={!!announcementsGroupId}
    onClose={onCloseLaunchpad}
    onDeployGovAndSponsor={onDeployGovAndSponsor}
    onDeployPactoGov={onDeployPactoGov}
    onDeployExtSponsor={onDeployExtSponsor}
    onDeploySquadAdmin={onDeploySquadAdmin}
  />
{/if}

{#if showExtSponsorDeploy && parentId.trim()}
  {#if DeployExtSponsorComponent}
    <DeployExtSponsorComponent
      parentId={parentId.trim()}
      {squadNetwork}
      onClose={onCloseExtSponsorDeploy}
      onComplete={onExtSponsorComplete}
    />
  {:else}
    <div class="modal-overlay wizard-loading-overlay" role="status" aria-live="polite">
      <p class="wizard-loading-text">{$t('governance.importSafe.wizardLoading')}</p>
    </div>
  {/if}
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
      <p class="wizard-loading-text">{$t('governance.importSafe.wizardLoading')}</p>
    </div>
  {/if}
{/if}

{#if showSetSafeModal}
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="set-safe-title">
    <div class="modal-content">
      <h3 id="set-safe-title">{$t('governance.importSafe.title')}</h3>
      <p class="modal-desc">{$t('governance.importSafe.desc')}</p>
      <label class="modal-field-label" for="import-safe-addr">{$t('governance.importSafe.addressLabel')}</label>
      <input
        id="import-safe-addr"
        type="text"
        class="input-address"
        placeholder={$t('governance.importSafe.addressPlaceholder')}
        bind:value={setSafeInput}
        aria-invalid={setSafeError ? 'true' : undefined}
        aria-describedby={setSafeError ? 'set-safe-error' : undefined}
      />
      <label class="modal-field-label" for="import-safe-chain">{$t('governance.importSafe.networkLabel')}</label>
      <ChainIdSelect id="import-safe-chain" bind:value={setSafeChain} disabled={setSafeSaving} />
      <label class="modal-field-label" for="import-safe-label">{$t('governance.importSafe.labelLabel')}</label>
      <input
        id="import-safe-label"
        type="text"
        class="input-address"
        placeholder={$t('governance.importSafe.labelPlaceholder')}
        bind:value={setSafeLabel}
      />
      {#if setSafeError}
        <p id="set-safe-error" class="input-error" role="alert">{setSafeError}</p>
      {/if}
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick={onCloseSetSafe} disabled={setSafeSaving}>{$t('governance.common.cancel')}</button>
        <button type="button" class="btn-primary" onclick={onConfirmSetSafe} disabled={setSafeSaving}
          >{setSafeSaving ? $t('governance.importSafe.adding') : $t('governance.importSafe.add')}</button
        >
      </div>
    </div>
  </div>
{/if}

<SquadRolesModal
  open={showSquadRolesModal}
  onClose={onCloseSquadRolesModal}
  {parentId}
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
    background: var(--bg-elevated);
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
