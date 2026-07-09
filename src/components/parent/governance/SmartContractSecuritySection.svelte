<script lang="ts">
  import { onMount } from 'svelte';
  import { isAddress } from 'viem';
  import chevronDownIcon from '../../../icons/chevron-down.svg';
  import { showToast } from '../../../stores/toast';
  import { profiles } from '../../../stores/profiles';
  import { getProfileDisplayName } from '../../../lib/utils/profile';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { WALLET_ASSETS_CHAIN_IDS, getWalletNetworkDisplayName, getExplorerTxUrl } from '../../../lib/wallet/assets';
  import {
    runOnChainInBackground,
    toastOnChainSubmitted,
    waitForOnChainConfirmationInBackground,
  } from '../../../lib/evm/on-chain-background';
  import { openExternalUrl } from '../../../lib/utils/open-external';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { DEFAULT_CHAIN_ID } from '../../../lib/wallet/chains';
  import {
    buildAllowlistAnnouncePayload,
    evmSendSquadAllowlistedContractCall,
    findAllowlistLabel,
    listSquadContractAllowlist,
    publishSquadAllowlistAnnounce,
    removeSquadContractAllowlist,
    upsertSquadContractAllowlist,
    type SquadContractAllowlistRow,
  } from '../../../lib/governance/squad-allowlist';
  import {
    buildCalldataFromAbiForm,
    ethAmountToWeiString,
    normalizeCalldataHex,
    simulateAdvancedTransaction,
  } from '../../../lib/evm/calldata-builder';
  import { loadShippedAbi, listShippedAbiRefs } from '../../../lib/evm/abi-loader';
  import { getActiveSquadEvmSignerAddress } from '../../../lib/wallet/evm-accounts';

  export let parentId = '';
  export let announcementsGroupId = '';
  /** Interim v1: Pacto Gov deployed (captain-gated mutation ships with on-chain role check). */
  export let canManage = false;

  let rows: SquadContractAllowlistRow[] = [];
  let loading = true;
  let loadError = '';

  let addChain: SupportedChainId = DEFAULT_CHAIN_ID;
  let addAddress = '';
  let addLabel = '';
  let addAbiRef = '';
  let addBusy = false;

  let callChain: SupportedChainId = DEFAULT_CHAIN_ID;
  let callTo = '';
  let callValueEth = '0';
  let callDataHex = '0x';
  let callAbiRef = 'erc20-minimal';
  let callFunctionName = '';
  let callArgsJson = '[]';
  let callMode: 'raw' | 'abi' = 'raw';
  let callSimOk: boolean | null = null;
  let callSimMessage = '';
  let callSimulating = false;
  let callSending = false;
  let squadSigner: string | null = null;
  let callSectionOpen = false;

  const shippedAbis = listShippedAbiRefs();

  async function refreshRows() {
    const pid = parentId.trim();
    if (!pid) {
      rows = [];
      loading = false;
      return;
    }
    loading = true;
    loadError = '';
    try {
      rows = await listSquadContractAllowlist(pid);
    } catch (e) {
      rows = [];
      loadError = getInvokeErrorMessage(e, 'Could not load allowlist.');
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void refreshRows();
    void getActiveSquadEvmSignerAddress().then((a) => {
      squadSigner = a?.trim() || null;
    });
  });

  $: parentId, void refreshRows();

  function shortAddr(a: string): string {
    const t = a.trim();
    if (t.length < 18) return t;
    return `${t.slice(0, 10)}…${t.slice(-8)}`;
  }

  function npubLabel(npub: string): string {
    return getProfileDisplayName($profiles[npub]) || (npub.length > 16 ? npub.slice(0, 12) + '…' : npub);
  }

  async function onAddContract() {
    if (!canManage || addBusy) return;
    const addr = addAddress.trim();
    if (!isAddress(addr)) {
      showToast('Enter a valid 0x contract address.');
      return;
    }
    addBusy = true;
    try {
      const row = await upsertSquadContractAllowlist({
        parentId,
        chain: addChain,
        contractAddress: addr,
        label: addLabel,
        abiRef: addAbiRef.trim() || null,
      });
      if (announcementsGroupId.trim()) {
        await publishSquadAllowlistAnnounce(
          announcementsGroupId,
          buildAllowlistAnnouncePayload({ parentId, action: 'upsert', row }),
        );
      }
      addAddress = '';
      addLabel = '';
      addAbiRef = '';
      await refreshRows();
      showToast('Contract added to squad allowlist.');
    } catch (e) {
      showToast(getInvokeErrorMessage(e, 'Could not add contract.'));
    } finally {
      addBusy = false;
    }
  }

  async function onRemove(row: SquadContractAllowlistRow) {
    if (!canManage) return;
    try {
      await removeSquadContractAllowlist(parentId, row.id);
      if (announcementsGroupId.trim()) {
        await publishSquadAllowlistAnnounce(
          announcementsGroupId,
          buildAllowlistAnnouncePayload({ parentId, action: 'remove', row }),
        );
      }
      await refreshRows();
      showToast('Contract removed from allowlist.');
    } catch (e) {
      showToast(getInvokeErrorMessage(e, 'Could not remove contract.'));
    }
  }

  function builtCallCalldata(): string {
    if (callMode === 'raw') return normalizeCalldataHex(callDataHex);
    const shipped = loadShippedAbi(callAbiRef);
    if (!shipped || !callFunctionName.trim()) return '0x';
    return buildCalldataFromAbiForm({
      abiJson: JSON.stringify(shipped),
      functionName: callFunctionName,
      argsJson: callArgsJson,
    });
  }

  async function onSimulateCall() {
    if (!squadSigner || !callTo.trim()) return;
    callSimulating = true;
    callSimOk = null;
    callSimMessage = '';
    try {
      if (!isAddress(callTo.trim())) {
        callSimOk = false;
        callSimMessage = 'Enter a valid 0x target address.';
        return;
      }
      const data = builtCallCalldata();
      const result = await simulateAdvancedTransaction({
        chainId: callChain,
        from: squadSigner as `0x${string}`,
        to: callTo.trim() as `0x${string}`,
        valueWei: ethAmountToWeiString(callValueEth),
        dataHex: data,
      });
      callSimOk = result.ok;
      callSimMessage = result.ok ? 'Simulation succeeded.' : result.message;
    } catch (e) {
      callSimOk = false;
      callSimMessage = e instanceof Error ? e.message : 'Simulation failed.';
    } finally {
      callSimulating = false;
    }
  }

  function onSendCall() {
    if (callSimOk !== true || callSending) return;
    const params = {
      parentId,
      network: callChain,
      to: callTo.trim(),
      valueWei: ethAmountToWeiString(callValueEth),
      dataHex: builtCallCalldata(),
      waitForConfirmation: false as const,
    };
    runOnChainInBackground({
      startedToast: 'Squad transaction submitted. Confirmation continues in the background.',
      subject: 'Squad transaction',
      job: async () => {
        const outcome = await evmSendSquadAllowlistedContractCall(params);
        if (!outcome.ok) throw new Error(outcome.message);
        return outcome.result;
      },
      onSuccess: (result) => {
        toastOnChainSubmitted(callChain, result.txHash, 'Squad transaction');
        waitForOnChainConfirmationInBackground(callChain, result.txHash, {
          subject: 'Squad transaction',
          confirmedToast: true,
          onConfirmed: () => {
            const url = getExplorerTxUrl(callChain, result.txHash);
            if (url) openExternalUrl(url);
          },
        });
      },
    });
  }

  $: callTargetLabel = findAllowlistLabel(rows, callChain, callTo);
  $: canSendCall = callSimOk === true && !!squadSigner && isAddress(callTo.trim());
</script>

<section class="smart-contract-security" aria-labelledby="smart-contract-security-heading">
  <h4 id="smart-contract-security-heading" class="roles-table-caption">Smart contract security</h4>
  <p class="smart-contract-security-lead muted">
    Only curated Pacto contracts until your squad adds allowlisted addresses. Members sign unofficial protocol calls with
    <strong>squad EVM keys</strong> to explicit allowlist targets only (plus implicit deploy infra). Arbitrary calls use
    Settings → Advanced.
  </p>

  {#if loading}
    <p class="smart-contract-security-note muted">Loading allowlist…</p>
  {:else if loadError}
    <p class="smart-contract-security-note">{loadError}</p>
  {:else if rows.length === 0}
    <p class="smart-contract-security-note muted">No allowlisted contracts yet.</p>
  {:else}
    <ul class="allowlist-list">
      {#each rows as row (row.id)}
        <li class="allowlist-row">
          <div class="allowlist-main">
            <span class="allowlist-label">{row.label?.trim() || 'Unlabeled'}</span>
            <span class="allowlist-meta">{getWalletNetworkDisplayName(row.chain as SupportedChainId)} · {shortAddr(row.contractAddress)}</span>
            <span class="allowlist-meta muted">Added by {npubLabel(row.addedByNpub)}</span>
          </div>
          {#if canManage}
            <button type="button" class="allowlist-remove" on:click={() => onRemove(row)}>Remove</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if canManage}
    <div class="allowlist-add">
      <h5 class="allowlist-subhead">Add contract</h5>
      <label class="allowlist-field-label" for="allowlist-chain">Chain</label>
      <select id="allowlist-chain" class="allowlist-input" bind:value={addChain}>
        {#each WALLET_ASSETS_CHAIN_IDS as chain (chain)}
          <option value={chain}>{getWalletNetworkDisplayName(chain)}</option>
        {/each}
      </select>
      <label class="allowlist-field-label" for="allowlist-addr">Contract address</label>
      <input id="allowlist-addr" class="allowlist-input" placeholder="0x…" bind:value={addAddress} />
      <label class="allowlist-field-label" for="allowlist-label">Label</label>
      <input id="allowlist-label" class="allowlist-input" placeholder="e.g. Uniswap router" bind:value={addLabel} />
      <label class="allowlist-field-label" for="allowlist-abi">ABI ref (optional)</label>
      <input id="allowlist-abi" class="allowlist-input" placeholder="erc20-minimal or URL" bind:value={addAbiRef} />
      <button type="button" class="allowlist-btn" disabled={addBusy} on:click={onAddContract}>
        {addBusy ? 'Adding…' : 'Add to allowlist'}
      </button>
    </div>
  {:else}
    <p class="smart-contract-security-note muted">Only Role-approved members can add contracts once enabled.</p>
  {/if}

  <div class="allowlist-call">
    <h5 class="allowlist-subhead">
      <button
        type="button"
        class="allowlist-call-toggle"
        aria-expanded={callSectionOpen}
        aria-controls="squad-contract-call-panel"
        on:click={() => (callSectionOpen = !callSectionOpen)}
      >
        <img
          src={chevronDownIcon}
          alt=""
          class="allowlist-call-chevron"
          class:allowlist-call-chevron--open={callSectionOpen}
        />
        <span>Squad contract call</span>
      </button>
    </h5>
    <div id="squad-contract-call-panel" class="allowlist-call-panel" hidden={!callSectionOpen}>
    {#if !squadSigner}
      <p class="smart-contract-security-note muted">Set a signer under Settings → Default wallet config.</p>
    {:else}
      <p class="smart-contract-security-note muted">Signing as {shortAddr(squadSigner)}. Simulate before send.</p>
      <label class="allowlist-field-label" for="call-chain">Chain</label>
      <select id="call-chain" class="allowlist-input" bind:value={callChain}>
        {#each WALLET_ASSETS_CHAIN_IDS as chain (chain)}
          <option value={chain}>{getWalletNetworkDisplayName(chain)}</option>
        {/each}
      </select>
      <label class="allowlist-field-label" for="call-to">Target (allowlisted or implicit infra)</label>
      <input id="call-to" class="allowlist-input" placeholder="0x…" bind:value={callTo} list="allowlist-targets" />
      <datalist id="allowlist-targets">
        {#each rows.filter((r) => r.chain === callChain) as row (row.id)}
          <option value={row.contractAddress}>{row.label || row.contractAddress}</option>
        {/each}
      </datalist>
      {#if callTargetLabel}
        <p class="allowlist-target-label">Allowlist: {callTargetLabel}</p>
      {/if}
      <label class="allowlist-field-label" for="call-value">Value (ETH)</label>
      <input id="call-value" class="allowlist-input" bind:value={callValueEth} />
      <fieldset class="allowlist-mode">
        <legend class="allowlist-field-label">Calldata</legend>
        <label><input type="radio" bind:group={callMode} value="raw" /> Raw hex</label>
        <label><input type="radio" bind:group={callMode} value="abi" /> Shipped ABI</label>
      </fieldset>
      {#if callMode === 'raw'}
        <textarea class="allowlist-textarea" rows="2" bind:value={callDataHex} placeholder="0x"></textarea>
      {:else}
        <select class="allowlist-input" bind:value={callAbiRef}>
          {#each shippedAbis as item (item.ref)}
            <option value={item.ref}>{item.label}</option>
          {/each}
        </select>
        <input class="allowlist-input" placeholder="functionName" bind:value={callFunctionName} />
        <textarea class="allowlist-textarea" rows="2" bind:value={callArgsJson} placeholder='["0x…"]'></textarea>
      {/if}
      {#if callSimMessage}
        <p class="allowlist-sim" class:ok={callSimOk === true} class:err={callSimOk === false}>{callSimMessage}</p>
      {/if}
      <div class="allowlist-call-actions">
        <button type="button" class="allowlist-btn allowlist-btn-secondary" disabled={callSimulating} on:click={onSimulateCall}>
          {callSimulating ? 'Simulating…' : 'Simulate'}
        </button>
        <button type="button" class="allowlist-btn" disabled={!canSendCall || callSending} on:click={onSendCall}>
          {callSending ? 'Sending…' : 'Send (squad key)'}
        </button>
      </div>
    {/if}
    </div>
  </div>
</section>

<style>
  .smart-contract-security {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid var(--border-subtle);
  }

  .smart-contract-security-lead,
  .smart-contract-security-note {
    font-size: 0.875rem;
    line-height: 1.5;
    margin: 0 0 8px 0;
  }

  .muted {
    color: var(--text-muted);
  }

  .allowlist-list {
    list-style: none;
    margin: 12px 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .allowlist-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
  }

  .allowlist-label {
    display: block;
    font-weight: 600;
    font-size: 0.875rem;
  }

  .allowlist-meta {
    display: block;
    font-size: 0.8125rem;
    margin-top: 2px;
  }

  .allowlist-remove {
    background: transparent;
    border: 0;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.8125rem;
  }

  .allowlist-add,
  .allowlist-call {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid var(--border-subtle);
  }

  .allowlist-subhead {
    margin: 0 0 10px;
    font-size: 0.9375rem;
    font-weight: 600;
  }

  .allowlist-call-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 0;
    margin: 0;
    border: none;
    background: transparent;
    font: inherit;
    font-size: inherit;
    font-weight: inherit;
    color: inherit;
    cursor: pointer;
    text-align: left;
    border-radius: 6px;
    outline: none;
  }

  .allowlist-call-toggle:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .allowlist-call-chevron {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    display: block;
    transform: rotate(-90deg);
    transition: transform 0.15s ease;
    filter: var(--icon-dropdown-filter);
  }

  .allowlist-call-chevron--open {
    transform: rotate(0deg);
  }

  .allowlist-call-panel[hidden] {
    display: none;
  }

  .allowlist-field-label {
    display: block;
    margin: 10px 0 4px;
    font-size: 0.8125rem;
  }

  .allowlist-input,
  .allowlist-textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-input, transparent);
    color: var(--text-primary);
    font: inherit;
  }

  .allowlist-textarea {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
  }

  .allowlist-mode {
    margin: 10px 0;
    padding: 0;
    border: 0;
    display: flex;
    gap: 16px;
    font-size: 0.875rem;
  }

  .allowlist-btn {
    margin-top: 10px;
    padding: 8px 14px;
    border-radius: 6px;
    border: 0;
    background: var(--accent);
    color: var(--accent-fg, #000);
    font: inherit;
    cursor: pointer;
  }

  .allowlist-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .allowlist-btn-secondary {
    background: transparent;
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
  }

  .allowlist-call-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .allowlist-sim {
    font-size: 0.8125rem;
    margin: 8px 0 0;
  }

  .allowlist-sim.ok {
    color: var(--accent, #4ade80);
  }

  .allowlist-sim.err {
    color: #f87171;
  }

  .allowlist-target-label {
    font-size: 0.8125rem;
    margin: 4px 0 0;
  }
</style>
