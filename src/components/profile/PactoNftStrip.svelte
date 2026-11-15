<script lang="ts">
  import { t } from 'svelte-i18n';
  import { pactoNftCatalog } from '../../lib/wallet/pacto-nft-catalog';
  import { getWalletNetworkDisplayName } from '../../lib/wallet/assets';
  import {
    USERNAME_NETWORK,
    claimedUsername,
    hasPendingUsernameTransfer,
    usernameState,
  } from '../../stores/username';
  import UsernameAddressRotateModal from './UsernameAddressRotateModal.svelte';
  import CopyableKeyPill from '../ui/CopyableKeyPill.svelte';

  const catalog = pactoNftCatalog(USERNAME_NETWORK);
  const usernameEntry = $derived(catalog.find((row) => row.kind === 'username') ?? null);
  const username = $derived($claimedUsername);
  const tokenId = $derived($usernameState.record?.tokenId?.trim() || $usernameState.cached?.tokenId?.trim() || '');
  const minted = $derived(!!username && !!tokenId && tokenId !== '0');
  const boundAddress = $derived($usernameState.record?.evmAddress?.trim() || '');
  const pending = $derived($hasPendingUsernameTransfer);

  let rotateOpen = $state(false);
</script>

<section class="nft-strip" aria-labelledby="profile-nfts-heading">
  <h2 id="profile-nfts-heading" class="nft-strip-title">{$t('profile.nfts.title')}</h2>
  <div class="nft-strip-scroller">
    {#if minted && usernameEntry && username}
      <article class="nft-card">
        <div class="nft-card-art" aria-hidden="true">{username.slice(0, 1).toUpperCase()}</div>
        <div class="nft-card-body">
          <p class="nft-card-kind">{$t('profile.nfts.username')}</p>
          <p class="nft-card-name">{username}</p>
          <p class="nft-card-meta">
            {$t('profile.nfts.tokenId', { values: { id: tokenId } })}
            · {getWalletNetworkDisplayName(usernameEntry.network)}
          </p>
          {#if boundAddress}
            <div class="nft-card-bound">
              <span class="nft-card-bound-label">{$t('profile.username.boundEvm')}</span>
              <CopyableKeyPill value={boundAddress} ariaLabel={$t('profile.nfts.copyBoundEvm')} />
            </div>
          {/if}
          {#if pending}
            <p class="nft-card-pending" role="status">{$t('profile.username.pendingTransfer')}</p>
          {/if}
          <button
            type="button"
            class="nft-card-rotate"
            onclick={() => (rotateOpen = true)}
          >
            {pending
              ? $t('profile.nfts.managePendingTransfer')
              : $t('profile.nfts.rotateBoundAddress')}
          </button>
        </div>
      </article>
    {:else}
      <article class="nft-card nft-card--empty">
        <div class="nft-card-art nft-card-art--empty" aria-hidden="true"></div>
        <div class="nft-card-body">
          <p class="nft-card-kind">{$t('profile.nfts.unclaimedSlot')}</p>
          <p class="nft-card-name">{$t('profile.nfts.empty')}</p>
        </div>
      </article>
    {/if}
  </div>
</section>

<UsernameAddressRotateModal open={rotateOpen} onClose={() => (rotateOpen = false)} />

<style>
  .nft-strip {
    min-width: 0;
  }

  .nft-strip-title {
    margin: 0 0 12px;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .nft-strip-scroller {
    display: flex;
    gap: 12px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    padding-bottom: 4px;
  }

  .nft-card {
    flex: 0 0 auto;
    width: min(240px, 80vw);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    background: var(--bg-elevated);
    overflow: hidden;
  }

  .nft-card-art {
    height: 88px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--brand);
    color: var(--on-brand);
    font-size: 2rem;
    font-weight: 700;
  }

  .nft-card-art--empty {
    background: var(--bg-hover);
  }

  .nft-card-body {
    padding: 12px 14px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .nft-card-kind,
  .nft-card-meta {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .nft-card-name {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .nft-card-bound {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    margin: 2px 0 0;
  }

  .nft-card-bound-label {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .nft-card-pending {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--warning);
  }

  .nft-card-rotate {
    margin-top: 4px;
    align-self: flex-start;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-panel);
    color: var(--text-primary);
    padding: 6px 10px;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
  }

  .nft-card-rotate:hover {
    background: var(--bg-hover);
  }

  .nft-card-rotate:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 1px;
  }
</style>
