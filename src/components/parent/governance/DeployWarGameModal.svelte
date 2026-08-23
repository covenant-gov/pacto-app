<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import Modal from '../../ui/Modal.svelte';
  import { resolveSquadRosterEvmAddress } from '../../../lib/squad/squad-roster-binding';
  import {
    startWarGameDeploy,
    type WarGameDeployComplete,
  } from '../../../lib/governance/start-war-game-deploy';
  import type { SquadSponsorDeploySignerWallet } from '../../../lib/governance/api';
  import {
    WAR_GAME_SQUAD_PARAMS,
    squadParamsIfCustomized,
    validateSquadParams,
  } from '../../../lib/governance/squad-params';
  import SquadParamsCustomizeFields from './SquadParamsCustomizeFields.svelte';
  import { WAR_GAME_PUBLIC_RULES_URL } from '../../../lib/governance/war-game-links';
  import { openExternalUrl } from '../../../lib/utils/open-external';
  import { getAddress, isAddress, parseEther } from 'viem';
  import { normalizeLeadingDotDecimalInput } from '../../../lib/wallet/amount-input';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';
  import { DEFAULT_SQUAD_PRACTICE_NETWORK } from '../../../lib/squad/squad-network';
  import { shortEvmAddress as shortAddress } from '../../../lib/governance/hats-tree-annotations';

  let {
    parentId,
    announcementsGroupId = null,
    practiceNetwork = undefined,
    redeploy = false,
    memberOptions = [],
    onClose,
    onComplete,
  }: {
    parentId: string;
    announcementsGroupId?: string | null;
    practiceNetwork?: SupportedChainId;
    redeploy?: boolean;
    memberOptions?: { address: string; label?: string }[];
    onClose: () => void;
    onComplete: (out: WarGameDeployComplete) => void | Promise<void>;
  } = $props();

  const titleId = 'deploy-war-game-title';
  const descId = 'deploy-war-game-desc';
  const tFn = get(t);

  let myRosterEvm = $state('');
  let resolvingDeployer = $state(true);
  let deploying = $state(false);
  let deployError = $state('');
  let customizeParams = $state(false);
  let crewChangeDelaySecs = $state(WAR_GAME_SQUAD_PARAMS.crewChangeDelaySecs);
  let proposalExpirySecs = $state(WAR_GAME_SQUAD_PARAMS.proposalExpirySecs);
  let crewVoteMode = $state(WAR_GAME_SQUAD_PARAMS.crewVoteMode);
  let quorumBps = $state(WAR_GAME_SQUAD_PARAMS.quorumBps);
  let depositEth = $state('0.01');
  let signerWallet: SquadSponsorDeploySignerWallet = $state('default');

  const customizeInvalid = $derived(
    customizeParams &&
      !!validateSquadParams({
        crewChangeDelaySecs,
        proposalExpirySecs,
        crewVoteMode,
        quorumBps,
      }),
  );

  const depositWei = $derived.by(() => {
    try {
      const wei = parseEther(depositEth.trim().replace(/,/g, '') || '0');
      return wei > 0n ? wei.toString() : null;
    } catch {
      return null;
    }
  });

  $effect(() => {
    const pid = parentId.trim();
    let cancelled = false;
    resolvingDeployer = true;
    myRosterEvm = '';
    void resolveSquadRosterEvmAddress(pid)
      .then((raw) => {
        if (cancelled) return;
        if (raw?.trim() && isAddress(raw.trim() as `0x${string}`)) {
          myRosterEvm = getAddress(raw.trim() as `0x${string}`);
        }
      })
      .catch(() => {
        if (!cancelled) myRosterEvm = '';
      })
      .finally(() => {
        if (!cancelled) resolvingDeployer = false;
      });
    return () => {
      cancelled = true;
    };
  });

  function executeDeploy() {
    if (deploying) return;
    deployError = '';
    if (resolvingDeployer) {
      deployError = tFn('governance.deployWarGame.error.loadingEvm');
      return;
    }
    if (!myRosterEvm) {
      deployError = tFn('governance.deployWarGame.error.noBoundEvm');
      return;
    }
    if (!depositWei) {
      deployError = tFn('governance.deployWarGame.error.invalidDeposit');
      return;
    }
    const squadParams = squadParamsIfCustomized(customizeParams, {
      crewChangeDelaySecs,
      proposalExpirySecs,
      crewVoteMode,
      quorumBps,
    });
    if (squadParams && validateSquadParams(squadParams)) {
      deployError = tFn('governance.squadParams.error.invalid');
      return;
    }
    deploying = true;
    const started = startWarGameDeploy({
      parentId: parentId.trim(),
      announcementsGroupId,
      network: practiceNetwork ?? DEFAULT_SQUAD_PRACTICE_NETWORK,
      captain: myRosterEvm,
      initialDepositWei: depositWei,
      signerWallet,
      squadParams,
      memberOptions,
      onReject: (message) => {
        deploying = false;
        deployError = message;
      },
      onError: (message) => {
        deploying = false;
        deployError = message;
      },
      onComplete: async (out) => {
        await onComplete(out);
        onClose();
      },
    });
    if (!started) deploying = false;
  }
</script>

<Modal {titleId} descriptionId={descId} {onClose} dismissible={!deploying} contentClass="deploy-war-game-panel">
  <h2 id={titleId}>
    {redeploy ? $t('governance.deployWarGame.redeployTitle') : $t('governance.deployWarGame.title')}
  </h2>
  <p id={descId} class="war-game-deploy-desc">
    {$t('governance.deployWarGame.description')}
    <button
      type="button"
      class="war-game-rules-link"
      onclick={() => void openExternalUrl(WAR_GAME_PUBLIC_RULES_URL)}
    >
      {$t('governance.deployWarGame.rulesLink')}
    </button>
  </p>

  <div class="war-game-deploy-field">
    <span class="war-game-deploy-label">{$t('governance.deployWarGame.networkLabel')}</span>
    <p class="war-game-deploy-pinned">
      {getWalletNetworkDisplayName(practiceNetwork ?? DEFAULT_SQUAD_PRACTICE_NETWORK)}
      <span class="war-game-deploy-pinned-note">{$t('governance.field.squadNetworkSuffix')}</span>
    </p>
  </div>

  <div class="war-game-deploy-field">
    <span class="war-game-deploy-label">{$t('governance.deployWarGame.captainLabel')}</span>
    {#if myRosterEvm}
      <p class="war-game-deploy-pinned">
        <code>{shortAddress(myRosterEvm)}</code>
        <span class="war-game-deploy-pinned-note">{$t('governance.deployWarGame.captainYou')}</span>
      </p>
    {:else}
      <p class="war-game-deploy-hint muted">{$t('governance.deployWarGame.captainNoEvmHint')}</p>
    {/if}
  </div>

  <fieldset class="war-game-deploy-field" disabled={deploying}>
    <legend class="war-game-deploy-label">{$t('governance.deployWarGame.payFrom')}</legend>
    <label class="signer-option">
      <input type="radio" name="war-game-signer" value="default" bind:group={signerWallet} />
      <span>{$t('governance.deployGovAndSponsor.signer.default.title')}</span>
    </label>
    <label class="signer-option">
      <input type="radio" name="war-game-signer" value="squad" bind:group={signerWallet} />
      <span>{$t('governance.deployGovAndSponsor.signer.squad.title')}</span>
    </label>
  </fieldset>

  <div class="war-game-deploy-field">
    <label class="war-game-deploy-label" for="war-game-deposit">
      {$t('governance.deployWarGame.depositLabel')}
    </label>
    <input
      id="war-game-deposit"
      class="input"
      type="text"
      inputmode="decimal"
      placeholder={$t('governance.deployWarGame.depositPlaceholder')}
      value={depositEth}
      disabled={deploying}
      oninput={(e) => {
        depositEth = normalizeLeadingDotDecimalInput((e.currentTarget as HTMLInputElement).value);
      }}
    />
    <p class="war-game-deploy-hint muted">{$t('governance.deployWarGame.depositHint')}</p>
  </div>

  <SquadParamsCustomizeFields
    bind:customizing={customizeParams}
    bind:crewChangeDelaySecs
    bind:proposalExpirySecs
    bind:crewVoteMode
    bind:quorumBps
    disabled={deploying}
    customizeHintKey="governance.deployWarGame.customizeHint"
  />

  {#if redeploy}
    <p class="war-game-deploy-hint muted">{$t('governance.deployWarGame.redeployHint')}</p>
  {/if}

  {#if deployError}
    <p class="input-error" role="alert">{deployError}</p>
  {/if}

  <div class="modal-actions">
    <button type="button" class="btn-secondary" onclick={onClose} disabled={deploying}>{$t('governance.common.cancel')}</button>
    <button
      type="button"
      class="btn-primary"
      disabled={
        deploying ||
        resolvingDeployer ||
        !myRosterEvm ||
        !depositWei ||
        customizeInvalid
      }
      onclick={executeDeploy}
    >
      {deploying ? $t('governance.common.deploying') : $t('governance.common.execute')}
    </button>
  </div>
</Modal>

<style>
  .war-game-deploy-desc {
    margin: 0 0 16px;
    font-size: 0.9375rem;
    line-height: 1.5;
  }
  .war-game-deploy-field {
    margin: 0 0 14px;
    border: none;
    padding: 0;
  }
  .war-game-deploy-label {
    display: block;
    margin: 0 0 6px;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-muted);
  }
  .war-game-deploy-pinned {
    margin: 0;
    font-size: 0.875rem;
  }
  .war-game-deploy-pinned-note {
    color: var(--text-muted);
  }
  .war-game-deploy-hint {
    margin: 6px 0 0;
    font-size: 0.8125rem;
    line-height: 1.4;
  }
  .war-game-rules-link {
    display: inline;
    margin-left: 4px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .signer-option {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 0;
    font-size: 0.875rem;
  }
</style>
