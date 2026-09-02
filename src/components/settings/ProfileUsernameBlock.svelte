<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import { usernameNameAvailable } from '../../lib/api/username';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { ZERO_ADDRESS } from '../../lib/wallet/assets';
  import { requireBackupVerified } from '../../stores/backup-verification';
  import { profileUsernameFocusNonce } from '../../stores/navigation';
  import { showToast } from '../../stores/toast';
  import {
    USERNAME_NETWORK,
    cancelUsernameAddressTransfer,
    claimUsername,
    claimUsernameAddressTransfer,
    claimedUsername,
    hasPendingUsernameTransfer,
    initiateUsernameAddressTransfer,
    isUsernameVerified,
    isValidUsernameFormat,
    refreshUsernameState,
    usernameState,
  } from '../../stores/username';

  let draftName = $state('');
  let availability: 'idle' | 'checking' | 'available' | 'taken' | 'invalid' = $state('idle');
  let newAddress = $state('');
  let lastFocusNonce = $state(0);

  const username = $derived($claimedUsername);
  const verified = $derived($isUsernameVerified);
  const pending = $derived($hasPendingUsernameTransfer);
  const busy = $derived($usernameState.busy);
  const record = $derived($usernameState.record);
  const status = $derived($usernameState.status);
  const pendingAddress = $derived.by(() => {
    const addr = record?.pendingAddress?.trim().toLowerCase();
    if (!addr || addr === ZERO_ADDRESS.toLowerCase()) return null;
    return record?.pendingAddress?.trim() ?? null;
  });

  $effect(() => {
    void refreshUsernameState();
  });

  $effect(() => {
    const nonce = $profileUsernameFocusNonce;
    if (nonce <= lastFocusNonce) return;
    lastFocusNonce = nonce;
    queueMicrotask(() => {
      document
        .getElementById('settings-profile-username')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  $effect(() => {
    const name = draftName.trim();
    if (!name) {
      availability = 'idle';
      return;
    }
    if (!isValidUsernameFormat(name)) {
      availability = 'invalid';
      return;
    }
    availability = 'checking';
    let cancelled = false;
    const handle = setTimeout(() => {
      void usernameNameAvailable(USERNAME_NETWORK, name)
        .then((ok) => {
          if (cancelled) return;
          availability = ok ? 'available' : 'taken';
        })
        .catch(() => {
          if (cancelled) return;
          availability = 'idle';
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  });

  function shortAddr(addr: string): string {
    const a = addr.trim();
    if (a.length < 12) return a;
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
  }

  function isValidEvmAddress(value: string): boolean {
    return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
  }

  async function onClaim() {
    if (!requireBackupVerified()) return;
    const name = draftName.trim();
    if (!isValidUsernameFormat(name) || availability === 'taken') return;
    try {
      const result = await claimUsername(name);
      const tFn = get(t);
      showToast(
        tFn('profile.username.claimSuccess', { values: { path: result.path } }),
      );
      draftName = '';
    } catch (e) {
      showToast(getInvokeErrorMessage(e), undefined, undefined, { error: true });
    }
  }

  async function onInitiate() {
    if (!requireBackupVerified()) return;
    if (!isValidEvmAddress(newAddress)) {
      showToast(get(t)('profile.username.invalidAddress'), undefined, undefined, { error: true });
      return;
    }
    try {
      const result = await initiateUsernameAddressTransfer(newAddress);
      showToast(
        get(t)('profile.username.transferSuccess', { values: { path: result.path } }),
      );
      newAddress = '';
    } catch (e) {
      showToast(getInvokeErrorMessage(e), undefined, undefined, { error: true });
    }
  }

  async function onClaimTransfer() {
    if (!requireBackupVerified()) return;
    try {
      const result = await claimUsernameAddressTransfer();
      showToast(
        get(t)('profile.username.transferSuccess', { values: { path: result.path } }),
      );
    } catch (e) {
      showToast(getInvokeErrorMessage(e), undefined, undefined, { error: true });
    }
  }

  async function onCancelTransfer() {
    if (!requireBackupVerified()) return;
    try {
      const result = await cancelUsernameAddressTransfer();
      showToast(
        get(t)('profile.username.transferSuccess', { values: { path: result.path } }),
      );
    } catch (e) {
      showToast(getInvokeErrorMessage(e), undefined, undefined, { error: true });
    }
  }

  function claimEnabled(
    avail: 'idle' | 'checking' | 'available' | 'taken' | 'invalid',
    name: string,
    isBusy: boolean,
  ): boolean {
    if (isBusy) return false;
    if (!isValidUsernameFormat(name)) return false;
    return avail === 'available' || avail === 'idle';
  }

  const canClaim = $derived(claimEnabled(availability, draftName, busy));
</script>

<section
  id="settings-profile-username"
  class="profile-username"
  aria-label={$t('profile.username.ariaLabel')}
>
  <h3 class="profile-username-title">{$t('profile.username.title')}</h3>

  {#if status === 'loading' || status === 'idle'}
    <p class="profile-username-muted">{$t('profile.username.loading')}</p>
  {:else if status === 'error' && !username}
    <p class="profile-username-error" role="alert">
      {$usernameState.error || $t('profile.username.loadError')}
    </p>
  {:else if username}
    <p class="profile-username-claimed">
      <span>{$t('profile.username.claimed', { values: { username } })}</span>
      {#if verified}
        <span class="profile-username-verified" title={$t('profile.username.verified')}>✓</span>
      {:else}
        <span class="profile-username-unverified">{$t('profile.username.unverified')}</span>
      {/if}
    </p>
    {#if record?.evmAddress}
      <p class="profile-username-meta">
        {$t('profile.username.boundEvm')}:
        <code>{shortAddr(record.evmAddress)}</code>
      </p>
    {/if}

    {#if pending}
      <div class="profile-username-pending" role="status">
        <p class="profile-username-pending-title">{$t('profile.username.pendingTransfer')}</p>
        {#if pendingAddress}
          <p class="profile-username-meta">
            {$t('profile.username.pendingTo', { values: { address: shortAddr(pendingAddress) } })}
          </p>
        {/if}
        <div class="profile-username-actions">
          <button type="button" class="btn-primary" disabled={busy} onclick={() => void onClaimTransfer()}>
            {busy ? $t('profile.username.working') : $t('profile.username.claimTransfer')}
          </button>
          <button type="button" class="btn-secondary" disabled={busy} onclick={() => void onCancelTransfer()}>
            {$t('profile.username.cancelTransfer')}
          </button>
        </div>
      </div>
    {:else}
      <div class="profile-username-rotate">
        <label class="profile-username-field" for="profile-username-new-evm">
          <span>{$t('profile.username.newAddressLabel')}</span>
          <input
            id="profile-username-new-evm"
            type="text"
            spellcheck="false"
            autocomplete="off"
            placeholder={$t('profile.username.newAddressPlaceholder')}
            bind:value={newAddress}
            disabled={busy}
          />
        </label>
        <div class="profile-username-actions">
          <button type="button" class="btn-secondary" disabled={busy} onclick={() => void onInitiate()}>
            {busy ? $t('profile.username.working') : $t('profile.username.initiateTransfer')}
          </button>
        </div>
      </div>
    {/if}
  {:else}
    <label class="profile-username-field" for="profile-username-input">
      <span>{$t('profile.username.label')}</span>
      <input
        id="profile-username-input"
        type="text"
        spellcheck="false"
        autocomplete="off"
        maxlength="32"
        placeholder={$t('profile.username.placeholder')}
        bind:value={draftName}
        disabled={busy}
      />
    </label>
    <p class="profile-username-hint">{$t('profile.username.hint')}</p>
    {#if availability === 'invalid'}
      <p class="profile-username-error" role="alert">{$t('profile.username.invalid')}</p>
    {:else if availability === 'checking'}
      <p class="profile-username-muted">{$t('profile.username.checking')}</p>
    {:else if availability === 'available'}
      <p class="profile-username-ok">{$t('profile.username.available')}</p>
    {:else if availability === 'taken'}
      <p class="profile-username-error" role="alert">{$t('profile.username.taken')}</p>
    {/if}
    <div class="profile-username-actions">
      <button
        type="button"
        class="btn-primary"
        disabled={!canClaim}
        onclick={() => void onClaim()}
      >
        {busy ? $t('profile.username.claiming') : $t('profile.username.claim')}
      </button>
    </div>
  {/if}
</section>

<style>
  .profile-username {
    margin-top: 16px;
    padding: 12px 14px;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--bg-panel);
    display: flex;
    flex-direction: column;
    gap: 8px;
    scroll-margin-top: 24px;
  }

  .profile-username-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .profile-username-claimed {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 1rem;
    font-weight: 500;
    color: var(--text-primary);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .profile-username-verified {
    color: var(--success);
    font-family: inherit;
  }

  .profile-username-unverified {
    font-family: inherit;
    font-size: 0.8125rem;
    font-weight: 400;
    color: var(--text-muted);
  }

  .profile-username-meta {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .profile-username-meta code {
    font-size: 0.8125rem;
  }

  .profile-username-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .profile-username-field input {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-elevated);
    color: var(--text-primary);
    padding: 8px 10px;
    font-size: 0.9375rem;
  }

  .profile-username-field input:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 1px;
  }

  .profile-username-hint,
  .profile-username-muted {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .profile-username-error {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--danger);
  }

  .profile-username-ok {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--success);
  }

  .profile-username-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .profile-username-pending,
  .profile-username-rotate {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
  }

  .profile-username-pending-title {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--warning);
  }

  .btn-primary,
  .btn-secondary {
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-primary {
    border: none;
    background: var(--brand);
    color: var(--on-brand);
  }

  .btn-primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .btn-secondary {
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    color: var(--text-primary);
  }

  .btn-secondary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
