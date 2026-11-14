<script lang="ts">
  import { t } from 'svelte-i18n';
  import backIcon from '../../icons/chevron-double-left.svg';
  import { currentUser } from '../../stores/auth-session';
  import { activeView } from '../../stores/navigation';
  import { showEvmDashGas, usernameState } from '../../stores/username';
  import type { EvmAccountRow } from '../../lib/wallet/evm-accounts';
  import ProfileSection from '../settings/ProfileSection.svelte';
  import EvmDashGasSection from '../settings/EvmDashGasSection.svelte';
  import PactoNftStrip from './PactoNftStrip.svelte';
  import ProfileWalletHero from './ProfileWalletHero.svelte';
  import ProfileEvmAccounts from './ProfileEvmAccounts.svelte';

  let userNpub = $derived($currentUser?.npub || '');
  let dashVisible = $derived(showEvmDashGas($usernameState));
  let evmAccountList: EvmAccountRow[] = $state([]);
  let accountsEpoch = $state(0);

  function goBack() {
    $activeView = 'hub';
  }
</script>

<div class="account-profile">
  <header class="account-profile-header">
    <button type="button" class="account-profile-back" onclick={goBack} aria-label={$t('nav.profile.backAria')}>
      <img src={backIcon} alt="" class="account-profile-back-icon" />
      <span>{$t('nav.settings.back')}</span>
    </button>
    <h1 class="account-profile-title">{$t('nav.profile.title')}</h1>
  </header>

  <div class="account-profile-main">
    <div class="account-profile-stack">
      <ProfileSection />
      <PactoNftStrip />
      {#if userNpub}
        <ProfileWalletHero
          accountNpub={userNpub}
          {evmAccountList}
          onAccountsChanged={async () => {
            accountsEpoch += 1;
          }}
        />
        <ProfileEvmAccounts bind:evmAccountList {accountsEpoch} />
        {#if dashVisible}
          <EvmDashGasSection />
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .account-profile {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    height: 100%;
    min-height: 0;
    overflow: hidden;
    border-left: 1px solid var(--border-subtle);
  }

  .account-profile-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 24px 24px 20px;
    min-width: 0;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .account-profile-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-family: inherit;
    cursor: pointer;
    flex-shrink: 0;
  }

  .account-profile-back:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .account-profile-back:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  .account-profile-back-icon {
    width: 18px;
    height: 18px;
    display: block;
    filter: var(--icon-dropdown-filter);
  }

  .account-profile-title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-primary);
    min-width: 0;
  }

  .account-profile-main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding: 24px 32px 64px;
    box-sizing: border-box;
  }

  .account-profile-stack {
    display: flex;
    flex-direction: column;
    gap: 32px;
    max-width: 720px;
    width: 100%;
  }
</style>
