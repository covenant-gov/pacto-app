<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Check from '@lucide/svelte/icons/check';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { Button } from '$lib/components/ui/button/index.js';
  import { exportSensitiveToClipboard } from '../../lib/api/auth';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { evmAccountSchemeLabel, type EvmAccountRow } from '../../lib/wallet/evm-accounts';
  import { showToast } from '../../stores/toast';
  import { appConfig } from '../../stores/app-config';
  import Modal from '../ui/Modal.svelte';
  import PinInput from '../auth/PinInput.svelte';
  import { formatExportAddress, parseExportBackoffSeconds } from './sensitive-export';
  import ExportModalStyles from './ExportModalStyles.svelte';

  let {
    open = false,
    variant = 'evm',
    account = null,
    npub = '',
    onClose = () => {},
  }: {
    open?: boolean;
    /** `evm` | `nostr` | `seed` (BIP-39 recovery phrase). */
    variant?: 'evm' | 'nostr' | 'seed';
    account?: EvmAccountRow | null;
    /** Shown when `variant` is `nostr`. */
    npub?: string;
    onClose?: () => void;
  } = $props();

  const titleId = 'sensitive-export-title';
  const descId = 'sensitive-export-desc';

  type Phase = 'form' | 'copied';

  let phase = $state<Phase>('form');
  let pin = $state('');
  let pinError = $state('');
  let busy = $state(false);
  let formEpoch = $state(0);
  let backoffUntil = $state(0);
  let now = $state(Date.now());
  let rootEl: HTMLDivElement | undefined = $state();

  let wasOpen = false;
  let pinDigitCount = $derived($appConfig.pinDigitCount);
  let pinReady = $derived(pin.length === pinDigitCount);
  let backoffSeconds = $derived(
    backoffUntil > now ? Math.max(1, Math.ceil((backoffUntil - now) / 1000)) : 0
  );

  let title = $derived(
    variant === 'nostr'
      ? $t('export.modal.title.nsec')
      : variant === 'seed'
        ? $t('export.modal.title.seed')
        : $t('export.modal.title.privateKey')
  );

  let subtitle = $derived(
    variant === 'nostr' ? $t('export.modal.subtitle.nsec') : $t('export.modal.subtitle.seed')
  );

  let warning = $derived(
    variant === 'nostr'
      ? $t('export.modal.warning.nsec')
      : variant === 'seed'
        ? $t('export.modal.warning.seed')
        : $t('export.modal.warning.privateKey')
  );

  let identity = $derived.by(() => {
    if (variant === 'nostr') {
      return npub.trim() || $t('export.modal.fallback.thisAccount');
    }
    if (variant === 'seed') return $t('export.modal.label.seedPhrase');
    if (!account) return '';
    const name = account.label?.trim() || formatExportAddress(account.address);
    const scheme = $t(evmAccountSchemeLabel(account.scheme));
    const index = account.hdIndex != null ? `#${account.hdIndex}` : '';
    return [name, scheme, index].filter(Boolean).join(' · ');
  });

  function resetState(): void {
    phase = 'form';
    pin = '';
    pinError = '';
    busy = false;
    backoffUntil = 0;
    formEpoch += 1;
  }

  function handleClose(): void {
    if (busy) return;
    resetState();
    onClose();
  }

  function copyAgain(): void {
    resetState();
  }

  $effect(() => {
    const isOpen = open;
    if (isOpen && !wasOpen) resetState();
    wasOpen = isOpen;
  });

  $effect(() => {
    if (!open || backoffUntil <= Date.now()) return;
    const timer = setInterval(() => {
      now = Date.now();
    }, 250);
    return () => clearInterval(timer);
  });

  $effect(() => {
    if (!open || phase !== 'form' || (variant === 'evm' && !account)) return;
    const el = rootEl;
    const timer = setTimeout(() => el?.querySelector('input')?.focus(), 50);
    return () => clearTimeout(timer);
  });

  async function copySecret(): Promise<void> {
    if (busy || !pinReady || backoffSeconds > 0) return;
    if (variant === 'evm' && !account) return;
    busy = true;
    pinError = '';
    const tFn = get(t);
    try {
      await exportSensitiveToClipboard(
        variant,
        variant === 'evm' ? account!.id : undefined,
        pin
      );
      phase = 'copied';
      pin = '';
    } catch (e) {
      const fallback =
        variant === 'nostr'
          ? tFn('export.error.couldNotExportNsec')
          : variant === 'seed'
            ? tFn('export.error.couldNotExportSeedPhrase')
            : tFn('export.error.couldNotExportPrivateKey');
      const message = getInvokeErrorMessage(e, fallback);
      const wait = parseExportBackoffSeconds(message);
      if (wait != null) {
        backoffUntil = Date.now() + wait * 1000;
        now = Date.now();
      } else {
        pinError = message;
      }
      showToast(message, undefined, undefined, { error: true });
    } finally {
      busy = false;
    }
  }
</script>

{#if open}
  <Modal {titleId} descriptionId={descId} onClose={handleClose} dismissible={!busy}>
    <div class="sensitive-export" bind:this={rootEl}>
      <ExportModalStyles />
      <h2 id={titleId}>{title}</h2>

      {#if variant === 'evm' && !account}
        <p id={descId} class="export-desc">{$t('export.modal.empty.noAccount')}</p>
        <div class="export-actions">
          <Button type="button" onclick={handleClose}>{$t('export.modal.action.done')}</Button>
        </div>
      {:else if phase === 'copied'}
        <div class="export-success" role="status">
          <span class="export-success-icon" aria-hidden="true">
            <Check class="size-5" />
          </span>
          <div>
            <p class="export-success-title">{$t('export.modal.success.title')}</p>
            <p id={descId}>{$t('export.modal.success.clearedIn90')}</p>
          </div>
        </div>
        <div class="export-actions">
          <Button type="button" variant="outline" onclick={copyAgain}>
            {$t('export.modal.action.copyAgain')}
          </Button>
          <Button type="button" onclick={handleClose}>{$t('export.modal.action.done')}</Button>
        </div>
      {:else}
        {#if variant !== 'evm'}
          <p class="export-desc">{subtitle}</p>
        {/if}
        <p class="export-identity">{identity}</p>
        {#if variant === 'evm' && account}
          <p class="export-address">{formatExportAddress(account.address)}</p>
        {/if}
        <p class="export-warning" role="note">
          <span class="export-warning-icon" aria-hidden="true">
            <TriangleAlert class="size-4" />
          </span>
          <span id={descId}>{warning}</span>
        </p>
        <p class="export-note">{$t('export.modal.warning.clipboard')}</p>

        {#if backoffSeconds > 0}
          <p class="export-backoff" role="status">
            {$t('export.modal.backoff.body', { values: { seconds: backoffSeconds } })}
          </p>
        {/if}

        {#key formEpoch}
          <PinInput
            title={$t('auth.pinEnterTitle')}
            {pinDigitCount}
            compact
            isProcessing={busy}
            error={pinError || null}
            onErrorClear={() => (pinError = '')}
            onChange={(next) => (pin = next)}
            onComplete={() => {}}
          />
        {/key}

        <form
          onsubmit={(e) => {
            e.preventDefault();
            void copySecret();
          }}
        >
          <div class="export-actions">
            <Button type="button" variant="outline" onclick={handleClose} disabled={busy}>
              {$t('settings.cancel')}
            </Button>
            <Button type="submit" disabled={!pinReady || busy || backoffSeconds > 0}>
              {#if busy}
                <LoaderCircle class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {/if}
              {#if backoffSeconds > 0}
                {$t('export.modal.action.wait', { values: { seconds: backoffSeconds } })}
              {:else}
                {$t('export.modal.action.copyToClipboard')}
              {/if}
            </Button>
          </div>
        </form>
      {/if}
    </div>
  </Modal>
{/if}

