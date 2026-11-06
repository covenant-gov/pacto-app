<script lang="ts">
  import { isAddress } from 'viem';
  import RefreshIconButton from '../../ui/RefreshIconButton.svelte';
  import TokenAmountRow from '../../ui/TokenAmountRow.svelte';
  import DashboardAssetCard from '../dashboard/DashboardAssetCard.svelte';
  import {
    buildTrackedTokenAnnouncePayload,
    getEvmErc20Balance,
    listSquadTrackedTokens,
    publishSquadTrackedTokenAnnounce,
    removeSquadTrackedToken,
    upsertSquadTrackedToken,
    type SquadTrackedTokenRow,
  } from '../../../lib/governance/squad-tracked-tokens';
  import {
    fetchGovModuleReadCached,
    isGovModuleReadStale,
    peekGovModuleRead,
    safeBalancesCacheKey,
  } from '../../../lib/governance/gov-module-read-cache';
  import {
    gateRequiresCaptainOrCrew,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import { getEvmNativeBalance } from '../../../lib/wallet/backend-wallet';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { showToast } from '../../../stores/toast';
  import { squadTrackedTokensNonceByParentId } from '../../../stores/navigation';
  import { requireBackupVerified } from '../../../stores/backup-verification';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { explorerAddressUrl, parseSupportedChainId, safeAppHomeUrl } from '../../../lib/wallet/chains';
  import { openExternalUrl } from '../../../lib/utils/open-external';
  import { withReadPlaneLimit } from '../../../lib/evm/read-plane-limiter';
  import { shortEvmAddress } from '../../../lib/governance/hats-tree-annotations';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';

  interface Props {
    network: string;
    parentId: string;
    safeAddress: string;
    announcementsGroupId?: string;
    privilege: GovernancePrivilege;
  }

  let { network, parentId, safeAddress, announcementsGroupId = '', privilege }: Props = $props();

  type SafeBalancesSnapshot = {
    nativeRaw: string;
    nativeSymbol: string;
    rows: SquadTrackedTokenRow[];
    tokenRaws: Record<string, string | null>;
    loadError: string;
  };

  const tFn = get(t);

  let rows = $state<SquadTrackedTokenRow[]>([]);
  let nativeRaw = $state('');
  let nativeSymbol = $state('');
  let tokenRaws = $state<Record<string, string | null>>({});
  let loading = $state(false);
  let refreshing = $state(false);
  let loadError = $state('');
  let addAddress = $state('');
  let addBusy = $state(false);
  let lastLoadKey = $state('');

  const manageGate = $derived(gateRequiresCaptainOrCrew(privilege));
  const chainKey = $derived(
    (parseSupportedChainId(network) ?? network.trim().toLowerCase()) as SupportedChainId,
  );
  const safe = $derived(safeAddress.trim());
  const explorerUrl = $derived(safe ? explorerAddressUrl(parseSupportedChainId(network), safe) : null);
  const safeAppUrl = $derived(safe ? safeAppHomeUrl(parseSupportedChainId(network), safe) : null);
  const trackedOnChain = $derived(
    rows.filter((r) => r.chain.trim().toLowerCase() === String(chainKey).toLowerCase()),
  );

  function applySnapshot(snap: SafeBalancesSnapshot) {
    nativeRaw = snap.nativeRaw;
    nativeSymbol = snap.nativeSymbol;
    rows = snap.rows;
    tokenRaws = snap.tokenRaws;
    loadError = snap.loadError;
  }

  async function refreshAll(force = false) {
    const hydrateKey = `${parentId.trim()}|${safeAddress.trim()}|${network.trim()}`;
    const pid = parentId.trim();
    if (!pid || !safe) {
      rows = [];
      loading = false;
      refreshing = false;
      return;
    }

    const key = safeBalancesCacheKey(pid, String(chainKey), safe);
    const peeked = peekGovModuleRead<SafeBalancesSnapshot>(key);
    if (peeked) applySnapshot(peeked);

    const needFetch = force || !peeked || isGovModuleReadStale(key);
    if (!needFetch) {
      loading = false;
      refreshing = false;
      return;
    }

    if (!peeked) loading = true;
    else refreshing = true;
    try {
      const snap = await fetchGovModuleReadCached(
        key,
        pid,
        async () => {
          let nextNativeRaw = '';
          let nextNativeSymbol = '';
          let nextError = '';
          const native = await getEvmNativeBalance(chainKey, safe);
          if (native.ok) {
            nextNativeRaw = native.balance.balanceRaw;
            nextNativeSymbol = native.balance.symbol;
          } else {
            nextError = native.message;
          }

          const nextRows = await listSquadTrackedTokens(pid);
          const onChain = nextRows.filter(
            (r) => r.chain.trim().toLowerCase() === String(chainKey).toLowerCase(),
          );
          const nextRaws: Record<string, string | null> = {};
          await Promise.all(
            onChain.map((r) =>
              withReadPlaneLimit(async () => {
                const res = await getEvmErc20Balance(String(chainKey), r.tokenAddress, safe);
                nextRaws[r.id] = res.ok ? res.balance.balanceRaw : null;
              }),
            ),
          );
          return {
            nativeRaw: nextNativeRaw,
            nativeSymbol: nextNativeSymbol,
            rows: nextRows,
            tokenRaws: nextRaws,
            loadError: nextError,
          };
        },
        { force: force || !!peeked },
      );
      if (hydrateKey !== `${parentId.trim()}|${safeAddress.trim()}|${network.trim()}`) return;
      applySnapshot(snap);
    } catch (e) {
      if (hydrateKey !== `${parentId.trim()}|${safeAddress.trim()}|${network.trim()}`) return;
      const msg = getInvokeErrorMessage(e, tFn('governance.error.couldNotLoadSafeBalances'));
      if (!peeked) {
        loadError = msg;
        nativeRaw = '';
        nativeSymbol = '';
        rows = [];
        tokenRaws = {};
      }
    } finally {
      if (hydrateKey === `${parentId.trim()}|${safeAddress.trim()}|${network.trim()}`) {
        loading = false;
        refreshing = false;
      }
    }
  }

  const trackedTokensNonce = $derived($squadTrackedTokensNonceByParentId[parentId.trim()] ?? 0);

  $effect(() => {
    const key = `${parentId.trim()}|${safeAddress.trim()}|${network.trim()}|${trackedTokensNonce}`;
    if (key !== lastLoadKey && parentId.trim() && safeAddress.trim()) {
      lastLoadKey = key;
      void refreshAll(trackedTokensNonce > 0);
    }
  });

  async function addToken() {
    if (!manageGate.enabled || addBusy) return;
    if (!requireBackupVerified()) return;
    const addr = addAddress.trim();
    if (!isAddress(addr)) {
      showToast(tFn('governance.error.invalidERC20'));
      return;
    }
    addBusy = true;
    try {
      const probe = await getEvmErc20Balance(String(chainKey), addr, safe);
      if (!probe.ok) {
        showToast(probe.message);
        return;
      }
      const row = await upsertSquadTrackedToken({
        parentId: parentId.trim(),
        chain: String(chainKey),
        tokenAddress: addr,
        symbol: probe.balance.symbol,
        decimals: probe.balance.decimals,
      });
      if (announcementsGroupId.trim()) {
        try {
          await publishSquadTrackedTokenAnnounce(
            announcementsGroupId,
            buildTrackedTokenAnnouncePayload({ parentId: parentId.trim(), action: 'upsert', row }),
          );
        } catch (announceErr) {
          await removeSquadTrackedToken(parentId.trim(), row.id, row.chain);
          throw announceErr;
        }
      }
      addAddress = '';
      showToast(tFn('governance.toast.trackedCoinAdded', { values: { symbol: row.symbol } }));
      await refreshAll(true);
    } catch (e) {
      showToast(getInvokeErrorMessage(e, tFn('governance.error.couldNotAddTrackedCoin')));
    } finally {
      addBusy = false;
    }
  }

  async function removeToken(row: SquadTrackedTokenRow) {
    if (!manageGate.enabled) return;
    if (!requireBackupVerified()) return;
    try {
      await removeSquadTrackedToken(parentId.trim(), row.id, row.chain);
      if (announcementsGroupId.trim()) {
        try {
          await publishSquadTrackedTokenAnnounce(
            announcementsGroupId,
            buildTrackedTokenAnnouncePayload({ parentId: parentId.trim(), action: 'remove', row }),
          );
        } catch (announceErr) {
          await upsertSquadTrackedToken({
            parentId: parentId.trim(),
            chain: row.chain,
            tokenAddress: row.tokenAddress,
            symbol: row.symbol,
            decimals: row.decimals,
          });
          throw announceErr;
        }
      }
      showToast(tFn('governance.toast.trackedCoinRemoved', { values: { symbol: row.symbol } }));
      await refreshAll(true);
    } catch (e) {
      showToast(getInvokeErrorMessage(e, tFn('governance.error.couldNotRemoveTrackedCoin')));
    }
  }

</script>

<DashboardAssetCard
  class="gov-treasury-section"
  headingId="gov-treasury-heading"
  heading={$t('governance.treasury.govHeading')}
>
  {#snippet headerAction()}
    <RefreshIconButton
      spinning={refreshing}
      disabled={loading || refreshing}
      ariaLabel={refreshing ? $t('governance.aria.refreshingSafeBalances') : $t('governance.aria.refreshSafeBalances')}
      onclick={() => void refreshAll(true)}
    />
  {/snippet}

  {#if loading && !nativeRaw && rows.length === 0}
    <p class="muted" role="status">{$t('governance.status.loadingBalances')}</p>
  {:else if loadError && !nativeRaw}
    <p class="error" role="alert">{loadError}</p>
  {:else}
    <dl class="asset-dl">
      <TokenAmountRow raw={nativeRaw} symbol={nativeSymbol || 'ETH'} />
      {#each trackedOnChain as row (row.id)}
        <TokenAmountRow
          raw={tokenRaws[row.id]}
          symbol={row.symbol}
          decimals={row.decimals}
          pending={tokenRaws[row.id] === undefined}
          symbolTitle={row.tokenAddress}
        >
          {#snippet extra()}
            <code class="bal-addr">{shortEvmAddress(row.tokenAddress) || '—'}</code>
            {#if manageGate.enabled}
              <button type="button" class="btn-link" onclick={() => void removeToken(row)}>{tFn('governance.action.remove')}</button>
            {/if}
          {/snippet}
        </TokenAmountRow>
      {/each}
      <dt>{$t('governance.treasury.safe')}</dt>
      <dd class="asset-dd-inline">
        {#if explorerUrl}
          <button
            type="button"
            class="btn-link treasury-addr-link"
            title={safe}
            aria-label={$t('governance.hats.wearerExplorerTitle', { values: { address: safe } })}
            onclick={() => openExternalUrl(explorerUrl)}
          >
            {shortEvmAddress(safe)}
          </button>
        {:else}
          <code class="treasury-addr" title={safe}>{shortEvmAddress(safe)}</code>
        {/if}
        {#if safeAppUrl}
          <button type="button" class="btn-link" onclick={() => openExternalUrl(safeAppUrl)}>
            {$t('governance.treasury.openSafe')}
          </button>
        {/if}
      </dd>
    </dl>
  {/if}

  {#snippet footer()}
    <div class="add-block">
      <label class="add-label" for="safe-tracked-token">{$t('governance.field.addTrackedToken')}</label>
      <div class="add-row">
        <input
          id="safe-tracked-token"
          class="add-input"
          type="text"
          placeholder={$t('governance.field.trackedTokenPlaceholder')}
          bind:value={addAddress}
          disabled={!manageGate.enabled || addBusy}
        />
        <button
          type="button"
          class="btn-primary"
          disabled={!manageGate.enabled || addBusy || !addAddress.trim()}
          title={manageGate.enabled ? undefined : $t(manageGate.reason)}
          onclick={() => void addToken()}
        >
          {addBusy ? tFn('governance.trackedToken.adding') : tFn('governance.action.add')}
        </button>
      </div>
      {#if !manageGate.enabled}
        <p class="hint muted">{$t(manageGate.reason)}</p>
      {/if}
    </div>
  {/snippet}
</DashboardAssetCard>

<style>
  :global(.gov-treasury-section) {
    margin-top: 16px;
  }
  .muted {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .error {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--danger, #c44);
  }
  .bal-addr,
  .treasury-addr {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .treasury-addr-link {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    margin: 0;
    padding: 0;
  }
  .add-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .add-label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-secondary);
  }
  .add-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .add-input {
    flex: 1 1 12rem;
    min-width: 0;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: 0.8125rem;
  }
  .btn-primary {
    padding: 8px 14px;
    border-radius: 6px;
    border: none;
    background: var(--brand);
    color: var(--on-brand);
    font-size: 0.8125rem;
  }
  .btn-primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .btn-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--brand);
    font-size: 0.75rem;
    cursor: pointer;
    text-decoration: underline;
  }
  .hint {
    font-size: 0.75rem;
  }
</style>
