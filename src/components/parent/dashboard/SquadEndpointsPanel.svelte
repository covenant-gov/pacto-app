<script lang="ts">
  import { t } from 'svelte-i18n';
  import EditIconButton from '../../ui/EditIconButton.svelte';
  import { getBundlerStatus, type BundlerStatusSource } from '../../../lib/api/bundler';
  import {
    formatSquadRpcLabel,
    squadRpcHasBackup,
    type SquadRpcConfig,
  } from '../../../lib/squad/squad-rpc';
  import { openExternalUrl } from '../../../lib/utils/open-external';
  import { squadStatusRpcFocusNonce } from '../../../stores/navigation';
  import type { SupportedChainId } from '../../../lib/wallet/chains';

  const ALCHEMY_SIGNUP_URL = 'https://www.alchemy.com/';
  const POCKET_SIGNUP_URL = 'https://pocket.network/';
  const PIMLICO_DASHBOARD_URL = 'https://dashboard.pimlico.io/';

  let {
    squadNetwork = null,
    squadRpcConfig = null,
    onSetSquadRpcPrimary = async () => {},
    onSetSquadRpcBackup = async () => {},
    onClearSquadRpcPrimary = async () => {},
  }: {
    squadNetwork?: SupportedChainId | null;
    squadRpcConfig?: SquadRpcConfig | null;
    onSetSquadRpcPrimary?: (url: string) => string | void | Promise<string | void>;
    onSetSquadRpcBackup?: (url: string) => string | void | Promise<string | void>;
    onClearSquadRpcPrimary?: () => void | Promise<void>;
  } = $props();

  let editingRpc = $state<'primary' | 'backup' | null>(null);
  let rpcUrlDraft = $state('');
  let rpcFormError = $state('');
  let rpcPublishing = $state(false);
  let rpcInputEl = $state<HTMLInputElement | null>(null);
  let lastRpcFocusNonce = $state(0);

  let bundlerSource = $state<BundlerStatusSource | null>(null);
  let bundlerLoading = $state(false);
  let bundlerError = $state(false);

  const rpcLabelRaw = $derived(formatSquadRpcLabel(squadRpcConfig));
  const rpcLabel = $derived(
    rpcLabelRaw.startsWith('squad.rpc.') ? $t(rpcLabelRaw) : rpcLabelRaw,
  );
  const rpcHasBackup = $derived(squadRpcHasBackup(squadRpcConfig));
  const rpcPrimaryIsCustom = $derived(squadRpcConfig?.rpc1.kind === 'url');

  const bundlerStatusKey = $derived(
    bundlerSource === 'pimlico'
      ? 'squad.bundler.statusPimlico'
      : bundlerSource === 'blocked_alchemy_override'
        ? 'squad.bundler.statusBlockedAlchemy'
        : 'squad.bundler.statusNone',
  );
  const bundlerHintKey = $derived(
    bundlerSource === 'blocked_alchemy_override'
      ? 'squad.bundler.hintBlocked'
      : 'squad.bundler.hint',
  );

  $effect(() => {
    const nonce = $squadStatusRpcFocusNonce;
    if (nonce <= lastRpcFocusNonce) return;
    lastRpcFocusNonce = nonce;
    openRpcEdit('primary');
    if (typeof document !== 'undefined') {
      queueMicrotask(() => {
        document.getElementById('squad-status-rpc')?.scrollIntoView({ block: 'nearest' });
        rpcInputEl?.focus();
      });
    }
  });

  $effect(() => {
    const network = squadNetwork ?? 'sepolia';
    let cancelled = false;
    bundlerLoading = true;
    bundlerError = false;
    void getBundlerStatus(network)
      .then((dto) => {
        if (cancelled) return;
        bundlerSource = dto.source;
      })
      .catch(() => {
        if (cancelled) return;
        bundlerError = true;
        bundlerSource = null;
      })
      .finally(() => {
        if (!cancelled) bundlerLoading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  function openRpcEdit(mode: 'primary' | 'backup') {
    editingRpc = mode;
    rpcUrlDraft = '';
    rpcFormError = '';
  }

  function cancelRpcEdit() {
    editingRpc = null;
    rpcUrlDraft = '';
    rpcFormError = '';
  }

  async function applyRpcEdit() {
    if (rpcPublishing || !editingRpc) return;
    rpcPublishing = true;
    rpcFormError = '';
    try {
      const err = await Promise.resolve(
        editingRpc === 'backup' ? onSetSquadRpcBackup(rpcUrlDraft) : onSetSquadRpcPrimary(rpcUrlDraft),
      );
      if (typeof err === 'string' && err.trim()) {
        rpcFormError = err;
        return;
      }
      cancelRpcEdit();
    } finally {
      rpcPublishing = false;
    }
  }

  async function clearRpcPrimary() {
    if (rpcPublishing) return;
    rpcPublishing = true;
    try {
      await Promise.resolve(onClearSquadRpcPrimary());
      cancelRpcEdit();
    } finally {
      rpcPublishing = false;
    }
  }
</script>

<div class="endpoints">
  <section class="endpoint-card" id="squad-status-rpc" aria-labelledby="squad-chain-rpc-heading">
    <div class="card-head">
      <div class="card-titles">
        <h3 id="squad-chain-rpc-heading" class="card-title">{$t('squad.rpc.chainTitle')}</h3>
        <p class="card-hint">{$t('squad.rpc.chainHint')}</p>
      </div>
      {#if !editingRpc}
        <EditIconButton
          ariaLabel={$t('squad.rpc.editAria')}
          title={$t('squad.rpc.editTitle')}
          on:click={() => openRpcEdit('primary')}
        />
      {/if}
    </div>

    {#if editingRpc}
      <label class="field-label" for="squad-rpc-url-input">{$t('squad.rpc.urlLabel')}</label>
      <input
        id="squad-rpc-url-input"
        bind:this={rpcInputEl}
        class="rpc-input"
        type="url"
        bind:value={rpcUrlDraft}
        placeholder={$t('squad.rpc.placeholder')}
        aria-label={editingRpc === 'backup' ? $t('squad.rpc.backupAria') : $t('squad.rpc.primaryAria')}
      />
      {#if rpcFormError}
        <p class="rpc-error" role="alert">{rpcFormError}</p>
      {/if}
      <div class="card-actions">
        <button
          type="button"
          class="btn-primary"
          disabled={!rpcUrlDraft.trim() || rpcPublishing}
          onclick={() => void applyRpcEdit()}
        >
          {rpcPublishing ? $t('squad.rpc.saving') : $t('squad.rpc.save')}
        </button>
        <button type="button" class="btn-secondary" disabled={rpcPublishing} onclick={cancelRpcEdit}>
          {$t('squad.rpc.cancel')}
        </button>
      </div>
    {:else}
      <div class="status-row">
        <span class="status-value">{rpcLabel}</span>
        {#if rpcHasBackup}
          <span class="muted backup-hint">{$t('squad.rpc.backupHint')}</span>
        {/if}
      </div>
      <div class="card-actions">
        <button type="button" class="btn-secondary" disabled={rpcPublishing} onclick={() => openRpcEdit('primary')}>
          {$t('squad.rpc.addCustom')}
        </button>
        {#if rpcPrimaryIsCustom}
          <button type="button" class="btn-secondary" disabled={rpcPublishing} onclick={() => openRpcEdit('backup')}>
            {$t('squad.rpc.addBackup')}
          </button>
          <button type="button" class="btn-ghost" disabled={rpcPublishing} onclick={() => void clearRpcPrimary()}>
            {$t('squad.rpc.usePublic')}
          </button>
        {/if}
      </div>
    {/if}

    <p class="providers-label">{$t('squad.rpc.providersHint')}</p>
    <div class="provider-links">
      <button type="button" class="link-btn" onclick={() => void openExternalUrl(ALCHEMY_SIGNUP_URL)}>
        {$t('squad.rpc.providerAlchemy')}
      </button>
      <span class="sep" aria-hidden="true">·</span>
      <button type="button" class="link-btn" onclick={() => void openExternalUrl(POCKET_SIGNUP_URL)}>
        {$t('squad.rpc.providerPocket')}
      </button>
    </div>
    <p class="muted share-note">{$t('squad.rpc.shareNote')}</p>
  </section>

  <section class="endpoint-card" aria-labelledby="squad-bundler-heading">
    <div class="card-titles">
      <h3 id="squad-bundler-heading" class="card-title">{$t('squad.bundler.title')}</h3>
      {#if bundlerLoading && !bundlerSource}
        <p class="status-value muted">{$t('squad.bundler.loading')}</p>
      {:else if bundlerError}
        <p class="rpc-error" role="alert">{$t('squad.bundler.error')}</p>
      {:else}
        <p class="status-value" class:status-ok={bundlerSource === 'pimlico'} class:status-warn={bundlerSource !== 'pimlico'}>
          {$t(bundlerStatusKey)}
        </p>
      {/if}
    </div>
    <p class="card-hint">{$t(bundlerHintKey)}</p>
    <button type="button" class="link-btn" onclick={() => void openExternalUrl(PIMLICO_DASHBOARD_URL)}>
      {$t('squad.bundler.getKey')}
    </button>
  </section>
</div>

<style>
  .endpoints {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 4px 0 12px;
  }

  .endpoint-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
  }

  .card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .card-titles {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .card-title {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .card-hint,
  .share-note,
  .providers-label {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.45;
    color: var(--text-muted);
  }

  .status-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
  }

  .status-value {
    margin: 0;
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .status-ok {
    color: var(--success);
  }

  .status-warn {
    color: var(--text-secondary);
  }

  .backup-hint {
    font-size: 0.75rem;
  }

  .field-label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .rpc-input {
    width: 100%;
    box-sizing: border-box;
    font-size: 0.8125rem;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
  }

  .card-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .btn-primary,
  .btn-secondary,
  .btn-ghost {
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
  }

  .btn-primary {
    border: none;
    background: var(--brand);
    color: var(--on-brand);
  }

  .btn-secondary {
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
  }

  .btn-secondary:hover:not(:disabled),
  .btn-ghost:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .btn-ghost {
    border: none;
    background: transparent;
    color: var(--text-secondary);
  }

  .btn-primary:disabled,
  .btn-secondary:disabled,
  .btn-ghost:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .provider-links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
  }

  .link-btn {
    padding: 0;
    border: none;
    background: transparent;
    color: var(--brand);
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .sep {
    color: var(--text-muted);
  }

  .rpc-error {
    margin: 0;
    font-size: 0.75rem;
    color: var(--danger);
  }

  .muted {
    color: var(--text-muted);
  }
</style>
