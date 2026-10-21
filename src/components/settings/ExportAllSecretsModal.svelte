<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { Button } from '$lib/components/ui/button/index.js';
  import { clearClipboard, exportSensitiveToClipboard } from '../../lib/api/auth';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import {
    evmAccountSchemeLabel,
    listEvmAccounts,
    type EvmAccountRow,
  } from '../../lib/wallet/evm-accounts';
  import { showToast } from '../../stores/toast';
  import { appConfig } from '../../stores/app-config';
  import Modal from '../ui/Modal.svelte';
  import PinInput from '../auth/PinInput.svelte';
  import {
    formatExportAddress,
    parseExportBackoffSeconds,
    type SensitiveExportKind,
  } from './sensitive-export';
  import ExportModalStyles from './ExportModalStyles.svelte';

  let {
    open = false,
    onClose = () => {},
  }: {
    open?: boolean;
    onClose?: () => void;
  } = $props();

  const titleId = 'export-all-title';
  const descId = 'export-all-desc';
  /** `busyId` sentinel: the clear-clipboard call, which belongs to no row. */
  const CLEAR_BUSY_ID = '__clear__';

  interface ExportTarget {
    id: string;
    kind: SensitiveExportKind;
    accountId?: string;
    title: string;
    detail?: string;
  }

  let pin = $state('');
  let pinError = $state('');
  let busyId = $state<string | null>(null);
  let formEpoch = $state(0);
  let now = $state(Date.now());
  let backoffUntil = $state<Record<string, number>>({});
  let copiedIds = $state<Record<string, boolean>>({});
  let rowErrors = $state<Record<string, string>>({});
  let evmRows = $state<EvmAccountRow[]>([]);
  let loadState = $state<'loading' | 'ready' | 'error'>('loading');
  let loadError = $state('');
  let rootEl: HTMLDivElement | undefined = $state();
  let clipboardCleared = $state(false);
  let anyCopied = $derived(Object.values(copiedIds).some(Boolean));

  let wasOpen = false;
  let loadGen = 0;
  let pinDigitCount = $derived($appConfig.pinDigitCount);
  let pinReady = $derived(pin.length === pinDigitCount);

  let targets = $derived.by(() => {
    const rows: ExportTarget[] = [
      { id: 'nostr', kind: 'nostr', title: $t('export.modal.section.nostrPrivateKey') },
      { id: 'seed', kind: 'seed', title: $t('export.modal.label.seedPhrase') },
    ];
    for (const account of evmRows) {
      const name = account.label?.trim();
      const address = formatExportAddress(account.address);
      rows.push({
        id: `evm:${account.id}`,
        kind: 'evm',
        accountId: account.id,
        title: name || address,
        detail: name ? address : $t(evmAccountSchemeLabel(account.scheme)),
      });
    }
    return rows;
  });

  function remainingSeconds(id: string): number {
    const until = backoffUntil[id] ?? 0;
    if (until <= now) return 0;
    return Math.max(1, Math.ceil((until - now) / 1000));
  }

  function resetState(): void {
    pin = '';
    pinError = '';
    busyId = null;
    backoffUntil = {};
    copiedIds = {};
    clipboardCleared = false;
    rowErrors = {};
    evmRows = [];
    loadState = 'loading';
    loadError = '';
    formEpoch += 1;
    loadGen += 1;
  }

  function handleClose(): void {
    if (busyId) return;
    resetState();
    onClose();
  }

  async function loadAccounts(): Promise<void> {
    const gen = ++loadGen;
    loadState = 'loading';
    loadError = '';
    try {
      const rows = (await listEvmAccounts()) ?? [];
      if (gen !== loadGen) return;
      evmRows = rows;
      loadState = 'ready';
    } catch (e) {
      if (gen !== loadGen) return;
      evmRows = [];
      loadState = 'error';
      loadError = getInvokeErrorMessage(e, get(t)('export.modal.error.loadAccounts'));
    }
  }

  $effect(() => {
    const isOpen = open;
    if (isOpen && !wasOpen) {
      resetState();
      void loadAccounts();
    }
    wasOpen = isOpen;
  });

  $effect(() => {
    if (!open) return;
    const pending = Object.values(backoffUntil).some((until) => until > Date.now());
    if (!pending) return;
    const timer = setInterval(() => {
      now = Date.now();
    }, 250);
    return () => clearInterval(timer);
  });

  $effect(() => {
    if (!open) return;
    const el = rootEl;
    const timer = setTimeout(() => el?.querySelector('input')?.focus(), 50);
    return () => clearTimeout(timer);
  });

  async function copyTarget(target: ExportTarget): Promise<void> {
    if (busyId || !pinReady || remainingSeconds(target.id) > 0) return;
    busyId = target.id;
    rowErrors = { ...rowErrors, [target.id]: '' };
    const tFn = get(t);
    try {
      await exportSensitiveToClipboard(target.kind, target.accountId, pin);
      copiedIds = { ...copiedIds, [target.id]: true };
      clipboardCleared = false;
    } catch (e) {
      const message = getInvokeErrorMessage(e, tFn('export.error.couldNotExportSecrets'));
      const wait = parseExportBackoffSeconds(message);
      if (wait != null) {
        backoffUntil = { ...backoffUntil, [target.id]: Date.now() + wait * 1000 };
        now = Date.now();
      } else if (/incorrect pin/i.test(message)) {
        pin = '';
        pinError = message;
        formEpoch += 1;
      } else {
        rowErrors = { ...rowErrors, [target.id]: message };
      }
      showToast(message, undefined, undefined, { error: true });
    } finally {
      busyId = null;
    }
  }

  async function clearNow(): Promise<void> {
    if (busyId) return;
    busyId = CLEAR_BUSY_ID;
    try {
      await clearClipboard();
      copiedIds = {};
      clipboardCleared = true;
    } catch (e) {
      const message = getInvokeErrorMessage(e, get(t)('export.error.couldNotClearClipboard'));
      showToast(message, undefined, undefined, { error: true });
    } finally {
      busyId = null;
    }
  }
</script>

{#if open}
  <Modal {titleId} descriptionId={descId} onClose={handleClose} dismissible={!busyId}>
    <div class="sensitive-export" bind:this={rootEl}>
      <ExportModalStyles />
      <h2 id={titleId}>{$t('export.modal.title.all')}</h2>
      <p id={descId} class="export-desc">{$t('export.modal.subtitle.all')}</p>
      <p class="export-warning" role="note">
        <span class="export-warning-icon" aria-hidden="true">
          <TriangleAlert class="size-4" />
        </span>
        <span>{$t('export.modal.warning.all')}</span>
      </p>
      <p class="export-note">{$t('export.modal.warning.clipboardAll')}</p>

      {#key formEpoch}
        <PinInput
          title={$t('auth.pinEnterTitle')}
          {pinDigitCount}
          compact
          isProcessing={busyId !== null}
          error={pinError || null}
          onErrorClear={() => (pinError = '')}
          onChange={(next) => (pin = next)}
          onComplete={() => {}}
        />
      {/key}

      <h3 class="export-list-heading">{$t('export.modal.list.heading')}</h3>

      {#if loadState === 'loading'}
        <p class="export-status" role="status">
          <LoaderCircle class="inline size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {$t('export.modal.loading.accounts')}
        </p>
      {:else if loadState === 'error'}
        <div class="export-error" role="alert">{loadError}</div>
        <Button type="button" variant="outline" onclick={() => void loadAccounts()}>
          {$t('export.modal.action.retry')}
        </Button>
      {/if}

      <ul class="export-list">
        {#each targets as target (target.id)}
          {@const wait = remainingSeconds(target.id)}
          <li class="export-row">
            <div class="export-row-text">
              <div class="export-row-title">{target.title}</div>
              {#if target.detail}
                <div class="export-row-detail">{target.detail}</div>
              {/if}
              {#if busyId === target.id}
                <p class="export-status" role="status">{$t('export.modal.row.copying')}</p>
              {:else if copiedIds[target.id] && !rowErrors[target.id] && wait === 0}
                <p class="export-status export-status-ok" role="status">{$t('export.modal.row.copied')}</p>
              {:else if wait > 0}
                <p class="export-status" role="status">
                  {$t('export.modal.backoff.body', { values: { seconds: wait } })}
                </p>
              {:else if rowErrors[target.id]}
                <p class="export-error" role="alert">{rowErrors[target.id]}</p>
              {/if}
            </div>
            <Button
              type="button"
              class="h-10 shrink-0"
              disabled={!pinReady || busyId !== null || wait > 0}
              aria-label={wait > 0
                ? $t('export.modal.action.wait', { values: { seconds: wait } })
                : $t('export.modal.action.copyNamed', { values: { name: target.title } })}
              onclick={() => void copyTarget(target)}
            >
              {#if busyId === target.id}
                <LoaderCircle class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {/if}
              {#if wait > 0}
                {$t('export.modal.action.wait', { values: { seconds: wait } })}
              {:else}
                {$t('export.modal.action.copy')}
              {/if}
            </Button>
          </li>
        {/each}
      </ul>

      {#if loadState === 'ready' && evmRows.length === 0}
        <p class="export-status">{$t('export.modal.empty.noEvm')}</p>
      {/if}

      {#if clipboardCleared}
        <p class="export-status export-status-ok" role="status">
          {$t('export.modal.cleared.body')}
        </p>
      {/if}

      <div class="export-actions">
        <Button type="button" variant="outline" onclick={handleClose} disabled={busyId !== null}>
          {$t('settings.cancel')}
        </Button>
        {#if anyCopied}
          <Button
            type="button"
            onclick={() => void clearNow()}
            disabled={busyId !== null}
          >
            {#if busyId === CLEAR_BUSY_ID}
              <LoaderCircle class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {/if}
            {$t('export.modal.action.clearNow')}
          </Button>
        {/if}
      </div>
    </div>
  </Modal>
{/if}

