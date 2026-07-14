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
    gateRequiresCaptainOrCrew,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import { getEvmNativeBalance } from '../../../lib/wallet/backend-wallet';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { showToast } from '../../../stores/toast';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { parseSupportedChainId } from '../../../lib/wallet/chains';

  export let network: string;
  export let parentId: string;
  export let safeAddress: string;
  export let announcementsGroupId = '';
  export let privilege: GovernancePrivilege;

  let rows: SquadTrackedTokenRow[] = [];
  let nativeDecimal = '';
  let nativeSymbol = '';
  let tokenBalances: Record<string, string> = {};
  let loading = true;
  let refreshing = false;
  let loadError = '';
  let addAddress = '';
  let addBusy = false;
  let lastLoadKey = '';

  $: manageGate = gateRequiresCaptainOrCrew(privilege);
  $: chainKey = (parseSupportedChainId(network) ?? network.trim().toLowerCase()) as SupportedChainId;
  $: safe = safeAddress.trim();

  async function refreshAll() {
    const pid = parentId.trim();
    if (!pid || !safe) {
      rows = [];
      loading = false;
      return;
    }
    refreshing = true;
    loadError = '';
    try {
      const native = await getEvmNativeBalance(chainKey, safe);
      if (native.ok) {
        nativeDecimal = native.balance.balanceDecimal;
        nativeSymbol = native.balance.symbol;
      } else {
        nativeDecimal = '';
        nativeSymbol = '';
        loadError = native.message;
      }

      rows = await listSquadTrackedTokens(pid);
      const onChain = rows.filter((r) => r.chain.trim().toLowerCase() === String(chainKey).toLowerCase());
      const next: Record<string, string> = {};
      await Promise.all(
        onChain.map(async (r) => {
          const res = await getEvmErc20Balance(String(chainKey), r.tokenAddress, safe);
          next[r.id] = res.ok ? res.balance.balanceDecimal : '—';
        }),
      );
      tokenBalances = next;
    } catch (e) {
      loadError = getInvokeErrorMessage(e, 'Could not load Safe balances.');
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  $: {
    const key = `${parentId.trim()}|${safeAddress.trim()}|${network.trim()}`;
    if (key !== lastLoadKey && parentId.trim() && safeAddress.trim()) {
      lastLoadKey = key;
      void refreshAll();
    }
  }

  async function addToken() {
    if (!manageGate.enabled || addBusy) return;
    const addr = addAddress.trim();
    if (!isAddress(addr)) {
      showToast('Paste a valid ERC-20 contract address.');
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
        await publishSquadTrackedTokenAnnounce(
          announcementsGroupId,
          buildTrackedTokenAnnouncePayload({ parentId: parentId.trim(), action: 'upsert', row }),
        );
      }
      addAddress = '';
      showToast(`${row.symbol} added as squad tracked coin.`);
      await refreshAll();
    } catch (e) {
      showToast(getInvokeErrorMessage(e, 'Could not add tracked coin.'));
    } finally {
      addBusy = false;
    }
  }

  async function removeToken(row: SquadTrackedTokenRow) {
    if (!manageGate.enabled) return;
    try {
      await removeSquadTrackedToken(parentId.trim(), row.id);
      if (announcementsGroupId.trim()) {
        await publishSquadTrackedTokenAnnounce(
          announcementsGroupId,
          buildTrackedTokenAnnouncePayload({ parentId: parentId.trim(), action: 'remove', row }),
        );
      }
      showToast(`${row.symbol} removed from squad tracked coins.`);
      await refreshAll();
    } catch (e) {
      showToast(getInvokeErrorMessage(e, 'Could not remove tracked coin.'));
    }
  }

  function shortAddr(addr: string): string {
    const a = addr.trim();
    if (a.length < 14) return a || '—';
    return `${a.slice(0, 8)}…${a.slice(-6)}`;
  }
</script>

<div class="safe-balances">
  <p class="muted">
    Shared vault used as Zodiac avatar for Treasury Authority. Balances are reads only; tracked ERC-20s sync to
    squad members via announcements.
  </p>

  <div class="balances-head">
    <h5 class="balances-title">Balances</h5>
    <RefreshIconButton
      spinning={refreshing}
      disabled={loading || refreshing}
      ariaLabel={refreshing ? 'Refreshing Safe balances' : 'Refresh Safe balances'}
      on:click={() => void refreshAll()}
    />
  </div>

  {#if loading}
    <p class="muted" role="status">Loading balances…</p>
  {:else if loadError && !nativeDecimal}
    <p class="error" role="alert">{loadError}</p>
  {:else}
    <ul class="bal-list">
      <li class="bal-row">
        <span class="bal-sym">{nativeSymbol || 'Native'}</span>
        <span class="bal-amt">{nativeDecimal || '—'}</span>
      </li>
      {#each rows.filter((r) => r.chain.trim().toLowerCase() === String(chainKey).toLowerCase()) as row (row.id)}
        <li class="bal-row">
          <span class="bal-sym" title={row.tokenAddress}>{row.symbol}</span>
          <span class="bal-amt">{tokenBalances[row.id] ?? '…'}</span>
          <code class="bal-addr">{shortAddr(row.tokenAddress)}</code>
          {#if manageGate.enabled}
            <button type="button" class="btn-link" on:click={() => void removeToken(row)}>Remove</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <div class="add-block">
    <label class="add-label" for="safe-tracked-token">Add squad tracked ERC-20</label>
    <div class="add-row">
      <input
        id="safe-tracked-token"
        class="add-input"
        type="text"
        placeholder="0x… contract address"
        bind:value={addAddress}
        disabled={!manageGate.enabled || addBusy}
      />
      <button
        type="button"
        class="btn-primary"
        disabled={!manageGate.enabled || addBusy || !addAddress.trim()}
        title={manageGate.enabled ? undefined : manageGate.reason}
        on:click={() => void addToken()}
      >
        {addBusy ? 'Adding…' : 'Add'}
      </button>
    </div>
    {#if !manageGate.enabled}
      <p class="hint muted">{manageGate.reason}</p>
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
    justify-content: space-between;
    gap: 8px;
  }
  .balances-title {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-secondary);
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
    background: var(--accent);
    color: var(--accent-contrast, #fff);
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .btn-primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .btn-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    font-size: 0.75rem;
    cursor: pointer;
    text-decoration: underline;
  }
  .hint {
    font-size: 0.75rem;
  }
</style>
