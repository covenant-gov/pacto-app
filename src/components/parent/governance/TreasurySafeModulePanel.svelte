<script lang="ts">
  import { isAddress } from 'viem';
  import RefreshIconButton from '../../ui/RefreshIconButton.svelte';
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
  import { parseSupportedChainId } from '../../../lib/wallet/chains';
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
    nativeDecimal: string;
    nativeSymbol: string;
    rows: SquadTrackedTokenRow[];
    tokenBalances: Record<string, string>;
    loadError: string;
  };

  const tFn = get(t);

  let rows = $state<SquadTrackedTokenRow[]>([]);
  let nativeDecimal = $state('');
  let nativeSymbol = $state('');
  let tokenBalances = $state<Record<string, string>>({});
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

  function applySnapshot(snap: SafeBalancesSnapshot) {
    nativeDecimal = snap.nativeDecimal;
    nativeSymbol = snap.nativeSymbol;
    rows = snap.rows;
    tokenBalances = snap.tokenBalances;
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
          let nextNativeDecimal = '';
          let nextNativeSymbol = '';
          let nextError = '';
          const native = await getEvmNativeBalance(chainKey, safe);
          if (native.ok) {
            nextNativeDecimal = native.balance.balanceDecimal;
            nextNativeSymbol = native.balance.symbol;
          } else {
            nextError = native.message;
          }

          const nextRows = await listSquadTrackedTokens(pid);
          const onChain = nextRows.filter(
            (r) => r.chain.trim().toLowerCase() === String(chainKey).toLowerCase(),
          );
          const nextBalances: Record<string, string> = {};
          await Promise.all(
            onChain.map((r) =>
              withReadPlaneLimit(async () => {
                const res = await getEvmErc20Balance(String(chainKey), r.tokenAddress, safe);
                nextBalances[r.id] = res.ok ? res.balance.balanceDecimal : '—';
              }),
            ),
          );
          return {
            nativeDecimal: nextNativeDecimal,
            nativeSymbol: nextNativeSymbol,
            rows: nextRows,
            tokenBalances: nextBalances,
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
        nativeDecimal = '';
        nativeSymbol = '';
        rows = [];
        tokenBalances = {};
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

<div class="safe-balances">
  <div class="balances-head">
    <RefreshIconButton
      spinning={refreshing}
      disabled={loading || refreshing}
      ariaLabel={refreshing ? $t('governance.aria.refreshingSafeBalances') : $t('governance.aria.refreshSafeBalances')}
      onclick={() => void refreshAll(true)}
    />
  </div>

  {#if loading && !nativeDecimal && rows.length === 0}
    <p class="muted" role="status">{$t('governance.status.loadingBalances')}</p>
  {:else if loadError && !nativeDecimal}
    <p class="error" role="alert">{loadError}</p>
  {:else}
    <ul class="bal-list">
      <li class="bal-row">
        <span class="bal-sym">{nativeSymbol || tFn('governance.fallback.native')}</span>
        <span class="bal-amt">{nativeDecimal || '—'}</span>
      </li>
      {#each rows.filter((r) => r.chain.trim().toLowerCase() === String(chainKey).toLowerCase()) as row (row.id)}
        <li class="bal-row">
          <span class="bal-sym" title={row.tokenAddress}>{row.symbol}</span>
          <span class="bal-amt">{tokenBalances[row.id] ?? '…'}</span>
          <code class="bal-addr">{shortEvmAddress(row.tokenAddress) || '—'}</code>
          {#if manageGate.enabled}
            <button type="button" class="btn-link" onclick={() => void removeToken(row)}>{tFn('governance.action.remove')}</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

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
</div>

<style>
  .safe-balances {
    display: flex;
    flex-direction: column;
    gap: 12px;
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
  .balances-head {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }
  .bal-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .bal-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px 12px;
    font-size: 0.875rem;
  }
  .bal-sym {
    font-weight: 600;
    min-width: 4rem;
    color: var(--text-primary);
  }
  .bal-amt {
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary);
  }
  .bal-addr {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .add-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 4px;
    border-top: 1px solid var(--border-subtle);
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
