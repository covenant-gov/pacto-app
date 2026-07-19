<script lang="ts">
  import type { SquadDashboardChannelMode } from '../../../stores/app';
  import { showToast } from '../../../stores/toast';
  import { TREASURY_SAFE_UI_CAP } from '../../../lib/treasury/treasury-safes';
  import { requireBackupVerified } from '../../../stores/backup-verification';
  import { DEFAULT_CHAIN_ID, type SupportedChainId } from '../../../lib/wallet/chains';
  import { govAndSponsorCompletionToast } from '../../../lib/governance/deploy-completion';
  import type {
    PactoGovCaptainOption,
    PactoGovDeployComplete,
  } from '../../../lib/governance/start-pacto-gov-deploy';
  import type { CombinedGovSponsorDeployComplete } from '../../../lib/governance/start-pacto-gov-and-sponsor-deploy';
  import ParentDashboardModals from './ParentDashboardModals.svelte';

  export let parentId: string;
  export let announcementsGroupId: string | null = null;
  export let treasurySafeCount = 0;
  export let hasSponsor = false;
  export let hasPactoGov = false;
  export let hasSquadAdmin = false;
  export let squadAdminProxy = '';
  export let squadAdminNetwork: SupportedChainId = DEFAULT_CHAIN_ID;
  /** Established squad network; deploy modals pin to it, or prompt a pick when null. */
  export let squadNetwork: SupportedChainId | null = null;
  /** Sponsor clone address when sponsor infra is deployed. */
  export let sponsorAddress = '';
  /** Pacto Gov reference (Safe / proxy / top hat) when deployed. */
  export let pactoGovAddress = '';
  /** Top hat id of the deployed Pacto Gov row ('' before gov deploy). */
  export let pactoGovTopHatId = '';
  export let quartermaster = '';
  export let memberEvmOptions: { address: string; label: string }[] = [];
  export let captainMemberOptions: PactoGovCaptainOption[] = [];

  export let onConfirmImportSafe:
    | ((params: {
        safeAddress: string;
        chain: string;
        label: string;
        entryId: string;
        txHash?: string;
      }) => Promise<void>)
    | undefined = undefined;
  export let onPactoGovDeployComplete:
    | ((params: {
        parentId: string;
        announcementsGroupId: string;
        chain: string;
        topHatId: string;
        providerPayload: string;
        safeAddress: string;
        txHash: string;
        infraRowId?: string;
      }) => Promise<void>)
    | undefined = undefined;
  export let onSponsorDeployComplete:
    | ((params: {
        parentId: string;
        announcementsGroupId: string;
        chain: string;
        sponsorAddress: string;
        providerPayload: string;
        infraRowId: string;
      }) => Promise<void>)
    | undefined = undefined;
  export let onSquadAdminDeployComplete:
    | ((params: {
        parentId: string;
        announcementsGroupId: string;
        chain: string;
        squadAdminProxy: string;
        providerPayload: string;
        infraRowId: string;
      }) => Promise<void>)
    | undefined = undefined;

  /** Navigate the dashboard after a deploy completes. */
  export let onNavigate: (view: SquadDashboardChannelMode) => void = () => {};
  /** Warm member/EVM caches before a deploy wizard opens. */
  export let onPrefetchDeployContext: () => void = () => {};

  let showSetSafeModal = false;
  let showDeploySafeModal = false;
  let showLaunchpad = false;
  let showPactoGovDeploy = false;
  let showGovAndSponsorDeploy = false;
  let showExtSponsorDeploy = false;
  let showSquadAdminDeploy = false;
  let showSquadRolesModal = false;

  let setSafeInput = '';
  let setSafeChain: SupportedChainId = DEFAULT_CHAIN_ID;
  let setSafeLabel = '';
  let setSafeError = '';
  let setSafeSaving = false;

  /** Combined wizard finishes the hats sponsor only when gov exists without a sponsor. */
  $: existingTopHatId = hasPactoGov && !hasSponsor ? pactoGovTopHatId : '';

  export function openLaunchpad(): void {
    if (!requireBackupVerified()) return;
    showLaunchpad = true;
  }

  export function openSetSafe(): void {
    if (!parentId?.trim()) return;
    showSetSafeModal = true;
    setSafeInput = '';
    setSafeChain = squadNetwork ?? DEFAULT_CHAIN_ID;
    setSafeLabel = '';
    setSafeError = '';
  }

  export function openDeploySafe(): void {
    if (!requireBackupVerified()) return;
    if (parentId?.trim()) {
      showDeploySafeModal = true;
    }
  }

  export function openPactoGovDeploy(): void {
    if (!requireBackupVerified()) return;
    if (hasPactoGov) {
      onNavigate('governance');
      return;
    }
    if (parentId?.trim()) {
      onPrefetchDeployContext();
      showPactoGovDeploy = true;
    }
  }

  export function openGovAndSponsorDeploy(): void {
    if (!requireBackupVerified()) return;
    if (hasSponsor) {
      showToast('Squad sponsor is already deployed for this parent.');
      return;
    }
    if (hasPactoGov && !pactoGovTopHatId.trim()) {
      showToast('Missing Pacto Gov top hat id — cannot finish hats sponsor.');
      return;
    }
    if (parentId?.trim()) {
      onPrefetchDeployContext();
      showGovAndSponsorDeploy = true;
    }
  }

  export function openExtSponsorDeploy(): void {
    if (!requireBackupVerified()) return;
    if (hasSponsor) {
      showToast('Squad sponsor is already deployed for this parent.');
      return;
    }
    if (parentId?.trim()) {
      showExtSponsorDeploy = true;
    }
  }

  export function openSquadAdminDeploy(): void {
    if (!requireBackupVerified()) return;
    if (hasSquadAdmin) {
      onNavigate('crew');
      showSquadRolesModal = true;
      return;
    }
    if (parentId?.trim()) showSquadAdminDeploy = true;
  }

  export function openSquadRolesModal(): void {
    showSquadRolesModal = true;
  }

  function closeSetSafeModal(): void {
    showSetSafeModal = false;
    setSafeInput = '';
    setSafeLabel = '';
    setSafeError = '';
  }

  async function confirmSetSafe(): Promise<void> {
    if (!requireBackupVerified()) return;
    const addr = setSafeInput.trim();
    if (!addr) {
      setSafeError = 'Enter a Safe address';
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      setSafeError = 'Invalid address (expected 0x + 40 hex chars)';
      return;
    }
    if (!onConfirmImportSafe) {
      setSafeError = 'Import Safe is not available';
      return;
    }
    if (treasurySafeCount >= TREASURY_SAFE_UI_CAP) {
      setSafeError = `At most ${TREASURY_SAFE_UI_CAP} Safes are shown per squad. Remove one from another client or use a fresh parent.`;
      return;
    }
    setSafeSaving = true;
    setSafeError = '';
    try {
      const entryId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `te-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await onConfirmImportSafe({
        safeAddress: addr,
        chain: setSafeChain,
        label: setSafeLabel.trim(),
        entryId,
      });
      closeSetSafeModal();
      onNavigate('treasury');
      showToast('Safe imported and added to treasury.');
    } catch (e) {
      setSafeError = (e as Error)?.message ?? 'Failed to import Safe';
    } finally {
      setSafeSaving = false;
    }
  }

  async function handleDeploySafeSuccess(params: {
    safeAddress: string;
    chain: string;
    label: string;
    entryId: string;
    txHash?: string;
  }): Promise<void> {
    if (!onConfirmImportSafe) {
      throw new Error('Treasury save is not available in this context.');
    }
    await onConfirmImportSafe({
      safeAddress: params.safeAddress,
      chain: params.chain,
      label: params.label.trim() || 'Deployed multisig',
      entryId: params.entryId,
      txHash: params.txHash,
    });
    showToast('Safe deployed and added to treasury.');
    onNavigate('treasury');
  }

  async function handlePactoGovComplete(out: PactoGovDeployComplete): Promise<void> {
    await onPactoGovDeployComplete?.({
      parentId: parentId.trim(),
      announcementsGroupId: announcementsGroupId?.trim() ?? '',
      chain: out.chain,
      topHatId: out.topHatId,
      providerPayload: out.providerPayload,
      safeAddress: out.safeAddress,
      txHash: out.txHash,
      infraRowId: out.infraRowId,
    });
    showPactoGovDeploy = false;
    onNavigate('governance');
    showToast('Pacto Gov deployed — Governance and Roles tabs are live.');
  }

  async function handleGovAndSponsorComplete(
    out: CombinedGovSponsorDeployComplete,
  ): Promise<void> {
    if (out.gov) {
      await onPactoGovDeployComplete?.({
        parentId: parentId.trim(),
        announcementsGroupId: announcementsGroupId?.trim() ?? '',
        chain: out.gov.chain,
        topHatId: out.gov.topHatId,
        providerPayload: out.gov.providerPayload,
        safeAddress: out.gov.safeAddress,
        txHash: out.gov.txHash,
        infraRowId: out.gov.infraRowId,
      });
    }
    if (out.sponsor) {
      await onSponsorDeployComplete?.({
        parentId: parentId.trim(),
        announcementsGroupId: announcementsGroupId?.trim() ?? '',
        chain: out.sponsor.chain,
        sponsorAddress: out.sponsor.sponsorAddress,
        providerPayload: out.sponsor.providerPayload,
        infraRowId: out.sponsor.infraRowId,
      });
    }
    showGovAndSponsorDeploy = false;
    onNavigate('governance');
    const toast = govAndSponsorCompletionToast(out);
    const retry = toast.action
      ? {
          label: toast.actionLabel ?? '',
          action: () => {
            if (toast.action === 'open-launchpad') openLaunchpad();
            else onNavigate('governance');
          },
        }
      : undefined;
    showToast(toast.message, undefined, retry, toast.error ? { error: true } : undefined);
  }

  async function handleExtSponsorComplete(out: {
    chain: string;
    sponsorAddress: string;
    providerPayload: string;
    infraRowId: string;
  }): Promise<void> {
    await onSponsorDeployComplete?.({
      parentId: parentId.trim(),
      announcementsGroupId: announcementsGroupId?.trim() ?? '',
      chain: out.chain,
      sponsorAddress: out.sponsorAddress,
      providerPayload: out.providerPayload,
      infraRowId: out.infraRowId,
    });
    showExtSponsorDeploy = false;
    onNavigate('treasury');
    showToast('Squad sponsor Ext deployed — manage allowlist from Treasury.');
  }

  async function handleSquadAdminComplete(out: {
    chain: string;
    squadAdminProxy: string;
    providerPayload: string;
    infraRowId: string;
  }): Promise<void> {
    await onSquadAdminDeployComplete?.({
      parentId: parentId.trim(),
      announcementsGroupId: announcementsGroupId?.trim() ?? '',
      chain: out.chain,
      squadAdminProxy: out.squadAdminProxy,
      providerPayload: out.providerPayload,
      infraRowId: out.infraRowId,
    });
    showToast('Squad Admin deployed — open Crew to manage privileges.');
    onNavigate('crew');
  }
</script>

<ParentDashboardModals
  {parentId}
  {announcementsGroupId}
  {treasurySafeCount}
  {hasSponsor}
  {hasPactoGov}
  {hasSquadAdmin}
  {squadAdminProxy}
  {squadAdminNetwork}
  {squadNetwork}
  {sponsorAddress}
  {pactoGovAddress}
  {captainMemberOptions}
  {memberEvmOptions}
  {existingTopHatId}
  {quartermaster}
  bind:showDeploySafeModal
  bind:showLaunchpad
  bind:showPactoGovDeploy
  bind:showGovAndSponsorDeploy
  bind:showExtSponsorDeploy
  bind:showSquadAdminDeploy
  bind:showSquadRolesModal
  bind:showSetSafeModal
  bind:setSafeInput
  bind:setSafeChain
  bind:setSafeLabel
  bind:setSafeError
  bind:setSafeSaving
  onCloseDeploySafe={() => (showDeploySafeModal = false)}
  onCloseLaunchpad={() => (showLaunchpad = false)}
  onClosePactoGovDeploy={() => (showPactoGovDeploy = false)}
  onCloseGovAndSponsorDeploy={() => (showGovAndSponsorDeploy = false)}
  onCloseExtSponsorDeploy={() => (showExtSponsorDeploy = false)}
  onCloseSquadAdminDeploy={() => (showSquadAdminDeploy = false)}
  onCloseSquadRolesModal={() => (showSquadRolesModal = false)}
  onCloseSetSafe={closeSetSafeModal}
  onConfirmSetSafe={confirmSetSafe}
  onDeploySquadAdmin={openSquadAdminDeploy}
  onDeployPactoGov={openPactoGovDeploy}
  onDeployGovAndSponsor={openGovAndSponsorDeploy}
  onDeployExtSponsor={openExtSponsorDeploy}
  onDeploySafe={openDeploySafe}
  onImportSafe={openSetSafe}
  onDeploySafeSuccess={handleDeploySafeSuccess}
  onPactoGovComplete={handlePactoGovComplete}
  onGovAndSponsorComplete={handleGovAndSponsorComplete}
  onExtSponsorComplete={handleExtSponsorComplete}
  onSquadAdminComplete={handleSquadAdminComplete}
/>
