<script lang="ts">
  import { t } from 'svelte-i18n';
  import Modal from '../../ui/Modal.svelte';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { DEFAULT_CHAIN_ID } from '../../../lib/wallet/chains';
  import {
    getSquadDeployLaunchpadState,
    type LaunchpadDeployOptionDto,
    type LaunchpadDeployOptionId,
    type SquadDeployLaunchpadStateDto,
  } from '../../../lib/governance/api';
  import {
    launchpadCtaDisabled,
    launchpadDisabledReasonLabel,
    launchpadOptionI18nKey,
    launchpadOptionRoute,
    launchpadShortAddress,
    LAUNCHPAD_ADVANCED_OPTION_IDS,
    LAUNCHPAD_RECOMMENDED_OPTION_IDS,
    type LaunchpadRouteAction,
  } from '../../../lib/governance/launchpad-cta';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';

  let {
    parentId,
    squadNetwork = null,
    hasAnnouncementsChannel,
    onClose,
    onSelectAction,
  }: {
    parentId: string;
    squadNetwork?: SupportedChainId | null;
    hasAnnouncementsChannel: boolean;
    onClose: () => void;
    onSelectAction: (action: LaunchpadRouteAction) => void;
  } = $props();

  const titleId = 'deploy-governance-modal-title';
  const descId = 'deploy-governance-modal-desc';

  let loading = $state(true);
  let loadError = $state('');
  let launchpadState = $state<SquadDeployLaunchpadStateDto | null>(null);
  let selectedId: LaunchpadDeployOptionId | '' = $state('');

  const channelBlocked = $derived(launchpadCtaDisabled({ hasAnnouncementsChannel }));
  const network = $derived((squadNetwork ?? DEFAULT_CHAIN_ID).trim());

  const recommendedOptions = $derived(
    (launchpadState?.options ?? []).filter((o) =>
      LAUNCHPAD_RECOMMENDED_OPTION_IDS.includes(o.id as LaunchpadDeployOptionId),
    ),
  );
  const advancedOptions = $derived(
    (launchpadState?.options ?? []).filter((o) =>
      LAUNCHPAD_ADVANCED_OPTION_IDS.includes(o.id as LaunchpadDeployOptionId),
    ),
  );

  const selectedOption = $derived(
    launchpadState?.options.find((o) => o.id === selectedId) ?? null,
  );

  const canContinue = $derived(
    !channelBlocked &&
      !loading &&
      !loadError &&
      selectedOption != null &&
      selectedOption.enabled,
  );

  async function refreshState() {
    const pid = parentId.trim();
    if (!pid) {
      launchpadState = null;
      loading = false;
      return;
    }
    loading = true;
    loadError = '';
    try {
      const next = await getSquadDeployLaunchpadState({ parentId: pid, network });
      launchpadState = next;
      const firstEnabled =
        next.options.find((o) => o.enabled)?.id ??
        (LAUNCHPAD_RECOMMENDED_OPTION_IDS[0] as LaunchpadDeployOptionId);
      selectedId = (next.options.find((o) => o.enabled)?.id ?? firstEnabled) as LaunchpadDeployOptionId;
    } catch (e) {
      loadError = getInvokeErrorMessage(e, 'Could not load deploy options.');
      launchpadState = null;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void parentId;
    void network;
    void refreshState();
  });

  function selectOption(option: LaunchpadDeployOptionDto) {
    if (!option.enabled || channelBlocked) return;
    selectedId = option.id;
  }

  function continueDeploy() {
    if (!selectedOption?.enabled || channelBlocked) return;
    onClose();
    onSelectAction(launchpadOptionRoute(selectedOption.id));
  }

  function variantLabel(variant: string | null | undefined): string {
    const v = variant?.trim();
    if (!v) return '';
    if (v === 'ext') return 'Ext';
    if (v === 'hats' || v === 'SPONSOR') return 'Hats';
    if (v === 'gov') return 'Gov';
    if (v === 'ext_standalone') return 'Ext';
    return v;
  }
</script>

<Modal {titleId} descriptionId={descId} {onClose} contentClass="launchpad-modal-panel">
  <h2 id={titleId}>{$t('governance.launchpad.title')}</h2>
  <p id={descId} class="launchpad-desc">
    {$t('governance.launchpad.description')}
  </p>

  {#if channelBlocked}
    <p class="launchpad-channel-note muted" role="status">
      {$t('governance.launchpad.channelNote')}
    </p>
  {/if}

  {#if loading}
    <p class="launchpad-loading muted" role="status">{$t('governance.launchpad.loading')}</p>
  {:else if loadError}
    <p class="input-error" role="alert">{loadError}</p>
  {:else if launchpadState}
    <section class="launchpad-infra" aria-labelledby="launchpad-infra-heading">
      <h3 id="launchpad-infra-heading" class="launchpad-section-title">
        {$t('governance.launchpad.infraHeading')}
      </h3>
      <ul class="launchpad-infra-list" role="list">
        <li class="launchpad-infra-row">
          <span class="launchpad-infra-name">{$t('governance.launchpad.infra.pactoGov')}</span>
          {#if launchpadState.pactoGov.deployed}
            <span class="launchpad-deployed-status" role="status">
              <span class="launchpad-deployed-check" aria-hidden="true">✓</span>
              <code class="launchpad-deployed-addr">
                {launchpadShortAddress(launchpadState.pactoGov.deployedAddress)}
              </code>
            </span>
          {:else}
            <span class="launchpad-infra-pending muted">{$t('governance.launchpad.infra.notDeployed')}</span>
          {/if}
        </li>
        <li class="launchpad-infra-row">
          <span class="launchpad-infra-name">{$t('governance.launchpad.infra.sponsor')}</span>
          {#if launchpadState.sponsor.deployed}
            <span class="launchpad-deployed-status" role="status">
              <span class="launchpad-deployed-check" aria-hidden="true">✓</span>
              <span class="launchpad-infra-meta">
                {#if variantLabel(launchpadState.sponsor.variant)}
                  <span class="launchpad-variant">{variantLabel(launchpadState.sponsor.variant)}</span>
                {/if}
                <code class="launchpad-deployed-addr">
                  {launchpadShortAddress(launchpadState.sponsor.deployedAddress)}
                </code>
              </span>
            </span>
          {:else}
            <span class="launchpad-infra-pending muted">{$t('governance.launchpad.infra.notDeployed')}</span>
          {/if}
        </li>
        <li class="launchpad-infra-row">
          <span class="launchpad-infra-name">{$t('governance.launchpad.infra.squadAdmin')}</span>
          {#if launchpadState.admin.deployed}
            <span class="launchpad-deployed-status" role="status">
              <span class="launchpad-deployed-check" aria-hidden="true">✓</span>
              <code class="launchpad-deployed-addr">
                {launchpadShortAddress(launchpadState.admin.deployedAddress)}
              </code>
            </span>
          {:else}
            <span class="launchpad-infra-pending muted">{$t('governance.launchpad.infra.notDeployed')}</span>
          {/if}
        </li>
      </ul>
    </section>

    {#if recommendedOptions.length > 0}
      <section class="launchpad-options" aria-labelledby="launchpad-recommended-heading">
        <h3 id="launchpad-recommended-heading" class="launchpad-section-title">
          {$t('governance.launchpad.recommendedHeading')}
        </h3>
        <ul class="launchpad-option-list" role="radiogroup" aria-labelledby="launchpad-recommended-heading">
          {#each recommendedOptions as option (option.id)}
            <li>
              {@render optionRow(option)}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if advancedOptions.length > 0}
      <section class="launchpad-options" aria-labelledby="launchpad-advanced-heading">
        <h3 id="launchpad-advanced-heading" class="launchpad-section-title">
          {$t('governance.launchpad.advancedHeading')}
        </h3>
        <p class="launchpad-advanced-blurb muted">{$t('governance.launchpad.advancedBlurb')}</p>
        <ul class="launchpad-option-list" role="radiogroup" aria-labelledby="launchpad-advanced-heading">
          {#each advancedOptions as option (option.id)}
            <li>
              {@render optionRow(option)}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}

  <div class="modal-actions">
    <button type="button" class="btn-secondary" onclick={onClose}>{$t('governance.common.close')}</button>
    <button
      type="button"
      class="btn-primary"
      disabled={!canContinue}
      onclick={continueDeploy}
    >
      {$t('governance.launchpad.continue')}
    </button>
  </div>
</Modal>

{#snippet optionRow(option: LaunchpadDeployOptionDto)}
  <label
    class="launchpad-option"
    class:launchpad-option--disabled={!option.enabled || channelBlocked}
    class:launchpad-option--selected={selectedId === option.id}
  >
    <input
      type="radio"
      name="launchpad-deploy-option"
      value={option.id}
      checked={selectedId === option.id}
      disabled={!option.enabled || channelBlocked}
      onchange={() => selectOption(option)}
    />
    <span class="launchpad-option-body">
      <span class="launchpad-option-title">{$t(launchpadOptionI18nKey(option.id))}</span>
      {#if option.deployed && option.deployedAddress}
        <span class="launchpad-option-deployed">
          <span class="launchpad-deployed-check launchpad-deployed-check--sm" aria-hidden="true">✓</span>
          <code>{launchpadShortAddress(option.deployedAddress)}</code>
        </span>
      {/if}
      {#if !option.enabled && option.disabledReasonKey}
        <span class="launchpad-option-reason muted">
          {launchpadDisabledReasonLabel(option, $t)}
        </span>
      {/if}
    </span>
  </label>
{/snippet}

<style>
  .launchpad-desc {
    margin: 0 0 16px;
    max-width: 52ch;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .launchpad-channel-note,
  .launchpad-loading {
    font-size: 0.875rem;
    margin: -8px 0 16px;
    max-width: 52ch;
  }

  .launchpad-section-title {
    margin: 0 0 10px;
    font-size: 0.8125rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .launchpad-infra {
    margin: 0 0 18px;
  }

  .launchpad-infra-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    overflow: hidden;
  }

  .launchpad-infra-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
  }

  .launchpad-infra-row:last-child {
    border-bottom: none;
  }

  .launchpad-infra-name {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .launchpad-infra-pending {
    font-size: 0.8125rem;
  }

  .launchpad-infra-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    min-width: 0;
  }

  .launchpad-variant {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .launchpad-options {
    margin: 0 0 16px;
  }

  .launchpad-advanced-blurb {
    margin: 0 0 10px;
    max-width: 52ch;
    font-size: 0.8125rem;
    line-height: 1.45;
  }

  .launchpad-option-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .launchpad-option {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--bg-elevated);
    cursor: pointer;
  }

  .launchpad-option--selected {
    border-color: var(--border-strong, var(--brand));
  }

  .launchpad-option--disabled {
    opacity: 0.72;
    cursor: not-allowed;
  }

  .launchpad-option-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .launchpad-option-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .launchpad-option-deployed {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.75rem;
    color: var(--success);
  }

  .launchpad-option-reason {
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  .launchpad-deployed-status {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .launchpad-deployed-check {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--success) 18%, transparent);
    color: var(--success);
    font-size: 0.875rem;
    font-weight: 700;
    line-height: 22px;
    text-align: center;
  }

  .launchpad-deployed-check--sm {
    width: 18px;
    height: 18px;
    font-size: 0.75rem;
    line-height: 18px;
  }

  .launchpad-deployed-addr {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--text-secondary);
    word-break: break-all;
  }

  .muted {
    color: var(--text-muted);
  }
</style>
