<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import DashboardAssetCard from './DashboardAssetCard.svelte';
  import type { StandaloneSquadAdminState } from '../../../lib/governance/squad-admin-payload';
  import { shortEvmAddress } from '../../../lib/governance/hats-tree-annotations';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';
  import { parseSupportedChainId } from '../../../lib/wallet/chains';
  import { copyTextToClipboard } from '../../../lib/wallet/clipboard-copy';
  import { openSquadSettings } from '../../../lib/navigation/open-squad-dashboard';
  import { showToast } from '../../../stores/toast';

  let {
    parentId = '',
    admin,
  }: {
    parentId?: string;
    admin: StandaloneSquadAdminState;
  } = $props();

  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  const networkLabel = $derived(getWalletNetworkDisplayName(parseSupportedChainId(admin.chain)));
  const variantHint = $derived(
    admin.variant === 'captain_hat'
      ? $t('governance.squadAdminCard.variantCaptainHat')
      : $t('governance.squadAdminCard.variantExtStandalone'),
  );

  async function copyProxy(): Promise<void> {
    const ok = await copyTextToClipboard(admin.proxy);
    if (!ok) {
      showToast(get(t)('governance.crew.toastCopyFailed'));
      return;
    }
    copied = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = false), 1500);
  }
</script>

<DashboardAssetCard
  headingId="squad-admin-status-heading"
  heading={$t('governance.squadAdminCard.title')}
  hint={variantHint}
>
  {#snippet headerAction()}
    <span class="deployed-badge">{$t('governance.squadAdminCard.deployed')}</span>
  {/snippet}
  <dl class="asset-dl">
    <dt>{$t('governance.squadAdminCard.proxyLabel')}</dt>
    <dd class="asset-dd-inline">
      <code title={admin.proxy}>{shortEvmAddress(admin.proxy)}</code>
      <button
        type="button"
        class="copy-btn"
        aria-label={copied
          ? $t('governance.common.copied')
          : $t('governance.squadAdminCard.copyProxy')}
        title={copied ? $t('governance.common.copied') : $t('governance.common.copy')}
        onclick={copyProxy}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
    </dd>
    <dt>{$t('governance.status.networkLabel')}</dt>
    <dd>{networkLabel}</dd>
  </dl>
  {#snippet footer()}
    <button type="button" class="btn-text" onclick={() => openSquadSettings(parentId)}>
      {$t('governance.squadAdminCard.managePrivileges')}
    </button>
  {/snippet}
</DashboardAssetCard>

<style>
  .deployed-badge {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-hover);
    color: var(--success);
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  code {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
  }

  .copy-btn {
    display: inline-flex;
    align-items: center;
    padding: 2px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .copy-btn:hover {
    color: var(--text-primary);
  }

  .btn-text {
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
