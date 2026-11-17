<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import { usernameNameAvailable } from '../../lib/api/username';
  import { getWalletNetworkDisplayName } from '../../lib/wallet/assets';
  import { pactoNftCatalog } from '../../lib/wallet/pacto-nft-catalog';
  import { usernameClaimErrorMessage } from '../../lib/username/username-claim-errors';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { requireBackupVerified } from '../../stores/backup-verification';
  import { showToast } from '../../stores/toast';
  import {
    USERNAME_NETWORK,
    claimUsername,
    claimedUsername,
    hasPendingUsernameTransfer,
    isValidUsernameFormat,
    needsForcedUsernameLinkRestore,
    normalizeUsernameInput,
    publishBoundDisplayName,
    refreshUsernameState,
    usernameKind0BindError,
    usernameState,
  } from '../../stores/username';
  import CopyableKeyPill from '../ui/CopyableKeyPill.svelte';
  import InfoTip from '../ui/InfoTip.svelte';
  import RefreshIconButton from '../ui/RefreshIconButton.svelte';
  import UsernameAddressRotateModal from './UsernameAddressRotateModal.svelte';

  const catalog = pactoNftCatalog(USERNAME_NETWORK);
  const usernameEntry = $derived(catalog.find((row) => row.kind === 'username') ?? null);

  let draftName = $state('');
  let availability: 'idle' | 'checking' | 'available' | 'taken' | 'invalid' = $state('idle');
  let rotateOpen = $state(false);
  let publishingKind0 = $state(false);

  const username = $derived($claimedUsername);
  const tokenId = $derived(
    $usernameState.record?.tokenId?.trim() || $usernameState.cached?.tokenId?.trim() || '',
  );
  const minted = $derived(!!username && !!tokenId && tokenId !== '0');
  const boundAddress = $derived($usernameState.record?.evmAddress?.trim() || '');
  const pending = $derived($hasPendingUsernameTransfer);
  const busy = $derived($usernameState.busy);
  const status = $derived($usernameState.status);
  const forceRestore = $derived(needsForcedUsernameLinkRestore($usernameState));
  const restoring = $derived($usernameState.status === 'loading');
  const kind0Error = $derived($usernameKind0BindError);

  $effect(() => {
    void refreshUsernameState();
  });

  $effect(() => {
    if (minted) return;
    const name = normalizeUsernameInput(draftName);
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

  async function onClaim() {
    if (!requireBackupVerified()) return;
    const name = normalizeUsernameInput(draftName);
    if (!isValidUsernameFormat(name) || availability === 'taken') return;
    try {
      const result = await claimUsername(name);
      const tFn = get(t);
      const bindError = get(usernameKind0BindError);
      if (bindError) {
        showToast(bindError, undefined, undefined, { error: true });
      } else {
        showToast(tFn('profile.username.claimSuccess', { values: { path: result.path } }));
      }
      draftName = '';
    } catch (e) {
      showToast(usernameClaimErrorMessage(e), undefined, undefined, { error: true });
    }
  }

  async function retryKind0() {
    if (!username || publishingKind0) return;
    publishingKind0 = true;
    try {
      await publishBoundDisplayName(username);
    } catch (e) {
      showToast(getInvokeErrorMessage(e), undefined, undefined, { error: true });
    } finally {
      publishingKind0 = false;
    }
  }
</script>

<div class="username-nft">
  {#if minted && username}
    <h2 class="username-nft-title">{$t('profile.nfts.username')}</h2>
    <p class="username-nft-name">{username}</p>
    {#if usernameEntry}
      <p class="username-nft-meta">
        {$t('profile.nfts.tokenId', { values: { id: tokenId } })}
        · {getWalletNetworkDisplayName(usernameEntry.network)}
      </p>
    {/if}
    {#if boundAddress}
      <div class="username-nft-bound">
        <span class="username-nft-meta">{$t('profile.username.boundEvm')}</span>
        <CopyableKeyPill value={boundAddress} ariaLabel={$t('profile.nfts.copyBoundEvm')} />
      </div>
    {/if}
    {#if pending}
      <p class="username-nft-pending" role="status">{$t('profile.username.pendingTransfer')}</p>
    {/if}
    {#if forceRestore}
      <div class="username-nft-actions">
        <RefreshIconButton
          spinning={restoring}
          ariaLabel={$t('profile.username.retryLinkRestore')}
          title={$t('profile.username.retryLinkRestore')}
          onclick={() => void refreshUsernameState({ forceLinkRestore: true })}
        />
      </div>
    {/if}
    {#if kind0Error}
      <p class="username-nft-error" role="alert">{kind0Error}</p>
      <button type="button" class="btn-secondary" disabled={publishingKind0} onclick={() => void retryKind0()}>
        {$t('profile.username.retryKind0')}
      </button>
    {/if}
    <button type="button" class="btn-primary" onclick={() => (rotateOpen = true)}>
      {pending ? $t('profile.nfts.managePendingTransfer') : $t('profile.nfts.rotateBoundAddress')}
    </button>
  {:else if status === 'loading' || status === 'idle'}
    <p class="username-nft-meta">{$t('profile.username.loading')}</p>
  {:else}
    <h2 class="username-nft-title">{$t('profile.nfts.claimTitle')}</h2>
    {#if status === 'error'}
      <p class="username-nft-error" role="alert">
        {$usernameState.error || $t('profile.username.loadError')}
      </p>
    {/if}
    <div class="username-nft-field">
      <div class="username-nft-label-row">
        <label for="profile-username-input">{$t('profile.username.label')}</label>
        <InfoTip text={$t('profile.username.hint')} ariaLabel={$t('profile.username.hintAria')} />
      </div>
      <input
        id="profile-username-input"
        type="text"
        spellcheck="false"
        autocomplete="off"
        maxlength="64"
        placeholder={$t('profile.username.placeholder')}
        bind:value={draftName}
        disabled={busy}
      />
    </div>
    {#if availability === 'invalid'}
      <p class="username-nft-error" role="alert">{$t('profile.username.invalid')}</p>
    {:else if availability === 'checking'}
      <p class="username-nft-meta">{$t('profile.username.checking')}</p>
    {:else if availability === 'available'}
      <p class="username-nft-ok">{$t('profile.username.available')}</p>
    {:else if availability === 'taken'}
      <p class="username-nft-error" role="alert">{$t('profile.username.taken')}</p>
    {/if}
    <button type="button" class="btn-primary" disabled={!canClaim} onclick={() => void onClaim()}>
      {busy ? $t('profile.username.claiming') : $t('profile.username.claim')}
    </button>
  {/if}
</div>

<UsernameAddressRotateModal open={rotateOpen} onClose={() => (rotateOpen = false)} />

<style>
  .username-nft {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    min-width: 0;
  }

  .username-nft-title {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .username-nft-name {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .username-nft-meta {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .username-nft-bound {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  .username-nft-pending {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--warning);
  }

  .username-nft-error {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--danger);
  }

  .username-nft-ok {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--success);
  }

  .username-nft-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: min(100%, 360px);
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .username-nft-label-row {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .username-nft-field input {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-elevated);
    color: var(--text-primary);
    padding: 8px 10px;
    font-size: 0.9375rem;
  }

  .username-nft-field input:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 1px;
  }

  .username-nft-actions {
    display: flex;
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
