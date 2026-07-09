<script lang="ts">
  import { onMount } from 'svelte';
  import type { Address } from 'viem';
  import { currentUser } from '../../stores/auth';
  import { showToast } from '../../stores/toast';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import {
    advancedEvmAccounts,
    getActiveAdvancedEvmSignerAddress,
    listEvmAccounts,
    type EvmAccountRow,
  } from '../../lib/wallet/evm-accounts';
  import {
    WALLET_ASSETS_CHAIN_IDS,
    getWalletNetworkDisplayName,
    getExplorerTxUrl,
  } from '../../lib/wallet/assets';
  import { DEFAULT_CHAIN_ID, type SupportedChainId } from '../../lib/wallet/chains';
  import { openExternalUrl } from '../../lib/utils/open-external';
  import { listShippedAbiRefs, loadShippedAbi } from '../../lib/evm/abi-loader';
  import {
    buildCalldataFromAbiForm,
    ethAmountToWeiString,
    isSquadInfraTargetAddress,
    normalizeCalldataHex,
    normalizeToAddress,
    simulateAdvancedTransaction,
  } from '../../lib/evm/calldata-builder';
  import { evmSendAdvancedContractCall, listSquadInfraCanonicalRefs } from '../../lib/evm/advanced-write';
  import {
    toastOnChainSubmitted,
    waitForOnChainConfirmationInBackground,
  } from '../../lib/evm/on-chain-background';

  export let enabledChainIds: SupportedChainId[] = [...WALLET_ASSETS_CHAIN_IDS];
  /** When true, show Settings cross-links (external wallet disclaimer). */
  export let embeddedInSettings = false;

  let advancedAccounts: EvmAccountRow[] = [];
  let activeAdvancedAddress: string | null = null;
  let squadInfraRefs: string[] = [];

  let network: SupportedChainId = DEFAULT_CHAIN_ID;
  let toAddress = '';
  let valueEth = '0';
  let calldataMode: 'raw' | 'abi' = 'raw';
  let dataHex = '0x';
  let abiRef = 'erc20-minimal';
  let abiJson = '';
  let functionName = 'balanceOf';
  let argsJson = '[]';
  let builtCalldata = '0x';

  let simulating = false;
  let simulateOk: boolean | null = null;
  let simulateMessage = '';
  let sending = false;
  let confirmOpen = false;
  let infraWarningAck = false;

  const shippedAbis = listShippedAbiRefs();

  $: accountNpub = $currentUser?.npub ?? null;
  $: hasAdvancedSigner = !!activeAdvancedAddress && advancedAccounts.length > 0;
  $: infraTarget = isSquadInfraTargetAddress(toAddress, squadInfraRefs);
  $: canSend =
    hasAdvancedSigner &&
    toAddress.trim().length > 0 &&
    (!infraTarget || infraWarningAck) &&
    enabledChainIds.includes(network);

  async function refreshAdvancedState() {
    if (!accountNpub) {
      advancedAccounts = [];
      activeAdvancedAddress = null;
      return;
    }
    try {
      const rows = await listEvmAccounts();
      advancedAccounts = advancedEvmAccounts(rows);
      activeAdvancedAddress = (await getActiveAdvancedEvmSignerAddress())?.trim() || null;
    } catch {
      advancedAccounts = [];
      activeAdvancedAddress = null;
    }
  }

  onMount(() => {
    void refreshAdvancedState();
    void listSquadInfraCanonicalRefs().then((refs) => {
      squadInfraRefs = refs;
    });
  });

  $: accountNpub, void refreshAdvancedState();

  function shortAddr(a: string): string {
    const t = a.trim();
    if (t.length < 18) return t;
    return `${t.slice(0, 10)}…${t.slice(-8)}`;
  }

  function rebuildCalldataPreview() {
    simulateOk = null;
    simulateMessage = '';
    try {
      if (calldataMode === 'raw') {
        builtCalldata = normalizeCalldataHex(dataHex);
      } else {
        const shipped = loadShippedAbi(abiRef);
        const abiSource = shipped
          ? JSON.stringify(shipped)
          : abiJson.trim()
            ? abiJson
            : '';
        if (!abiSource) {
          builtCalldata = '0x';
          return;
        }
        builtCalldata = buildCalldataFromAbiForm({
          abiJson: abiSource,
          functionName,
          argsJson,
        });
      }
    } catch (_e) {
      builtCalldata = '0x';
    }
  }

  $: calldataMode, dataHex, abiRef, abiJson, functionName, argsJson, rebuildCalldataPreview();

  async function onSimulate() {
    if (!activeAdvancedAddress) return;
    simulating = true;
    simulateOk = null;
    simulateMessage = '';
    try {
      const to = normalizeToAddress(toAddress);
      const valueWei = ethAmountToWeiString(valueEth);
      const data = calldataMode === 'raw' ? normalizeCalldataHex(dataHex) : builtCalldata;
      const result = await simulateAdvancedTransaction({
        chainId: network,
        from: activeAdvancedAddress as Address,
        to,
        valueWei,
        dataHex: data,
      });
      simulateOk = result.ok;
      simulateMessage = result.ok ? 'Simulation succeeded (eth_call).' : result.message;
    } catch (e) {
      simulateOk = false;
      simulateMessage = e instanceof Error ? e.message : 'Simulation failed.';
    } finally {
      simulating = false;
    }
  }

  function openConfirm() {
    try {
      normalizeToAddress(toAddress);
      if (calldataMode === 'raw') normalizeCalldataHex(dataHex);
      else if (builtCalldata === '0x' && functionName.trim()) {
        showToast('Build calldata from ABI first.');
        return;
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Check address and calldata.');
      return;
    }
    confirmOpen = true;
  }

  async function onSendConfirmed() {
    sending = true;
    try {
      const valueWei = ethAmountToWeiString(valueEth);
      const data = calldataMode === 'raw' ? normalizeCalldataHex(dataHex) : builtCalldata;
      const outcome = await evmSendAdvancedContractCall({
        network,
        to: toAddress.trim(),
        valueWei,
        dataHex: data,
        waitForConfirmation: false,
      });
      if (!outcome.ok) {
        showToast(outcome.message);
        return;
      }
      confirmOpen = false;
      toastOnChainSubmitted(network, outcome.result.txHash, 'Advanced transaction');
      waitForOnChainConfirmationInBackground(network, outcome.result.txHash, {
        subject: 'Advanced transaction',
        onConfirmed: () => {
          const url = getExplorerTxUrl(network, outcome.result.txHash);
          if (url) openExternalUrl(url);
        },
        confirmedToast: true,
      });
    } catch (e) {
      showToast(getInvokeErrorMessage(e, 'Advanced send failed.'));
    } finally {
      sending = false;
    }
  }
</script>

<section class="wallet-advanced" aria-labelledby="wallet-advanced-heading">
  <div class="wallet-advanced-banner" role="note">
    <strong>Advanced — not linked to any squad.</strong>
    Opaque contract calls use your advanced-purpose key only. No roster shares, governance announces, or dashboard entries.
    {#if embeddedInSettings}
      For importing keys into MetaMask or similar, see <strong>Using this address in an external wallet</strong> above.
    {/if}
  </div>

  <h2 id="wallet-advanced-heading" class="wallet-advanced-h2">Advanced contract call</h2>

  {#if !hasAdvancedSigner}
    <p class="wallet-advanced-hint">
      Create or select an advanced account above before sending. Squad signers cannot use this panel.
    </p>
  {:else}
    <p class="wallet-advanced-hint">
      Signing as <code>{shortAddr(activeAdvancedAddress ?? '')}</code>. Simulate with <code>eth_call</code>, then confirm the full calldata before broadcast.
    </p>

    <label class="wallet-advanced-label" for="adv-network">Network</label>
    <select id="adv-network" class="wallet-advanced-input" bind:value={network}>
      {#each enabledChainIds as chain (chain)}
        <option value={chain}>{getWalletNetworkDisplayName(chain)}</option>
      {/each}
    </select>

    <label class="wallet-advanced-label" for="adv-to">Contract address (to)</label>
    <input
      id="adv-to"
      type="text"
      class="wallet-advanced-input"
      placeholder="0x…"
      bind:value={toAddress}
      spellcheck="false"
      autocapitalize="off"
    />

    {#if infraTarget}
      <p class="wallet-advanced-warn">
        This address matches local squad infrastructure. Advanced calls to squad deploy targets are discouraged.
      </p>
      <label class="wallet-advanced-check">
        <input type="checkbox" bind:checked={infraWarningAck} />
        I understand — proceed anyway
      </label>
    {/if}

    <label class="wallet-advanced-label" for="adv-value">Value (ETH)</label>
    <input
      id="adv-value"
      type="text"
      class="wallet-advanced-input"
      inputmode="decimal"
      placeholder="0"
      bind:value={valueEth}
    />

    <fieldset class="wallet-advanced-fieldset">
      <legend class="wallet-advanced-label">Calldata</legend>
      <label class="wallet-advanced-radio">
        <input type="radio" bind:group={calldataMode} value="raw" />
        Raw hex
      </label>
      <label class="wallet-advanced-radio">
        <input type="radio" bind:group={calldataMode} value="abi" />
        ABI + function
      </label>
    </fieldset>

    {#if calldataMode === 'raw'}
      <label class="wallet-advanced-label" for="adv-data">Data hex</label>
      <textarea
        id="adv-data"
        class="wallet-advanced-textarea"
        rows="3"
        placeholder="0x"
        bind:value={dataHex}
        spellcheck="false"
      ></textarea>
    {:else}
      <label class="wallet-advanced-label" for="adv-abi-ref">Shipped ABI</label>
      <select id="adv-abi-ref" class="wallet-advanced-input" bind:value={abiRef}>
        {#each shippedAbis as item (item.ref)}
          <option value={item.ref}>{item.label}</option>
        {/each}
        <option value="">Custom JSON…</option>
      </select>
      {#if !abiRef}
        <label class="wallet-advanced-label" for="adv-abi-json">ABI JSON</label>
        <textarea
          id="adv-abi-json"
          class="wallet-advanced-textarea"
          rows="4"
          placeholder="Paste JSON ABI array"
          bind:value={abiJson}
          spellcheck="false"
        ></textarea>
      {/if}
      <label class="wallet-advanced-label" for="adv-fn">Function name</label>
      <input id="adv-fn" type="text" class="wallet-advanced-input" bind:value={functionName} />
      <label class="wallet-advanced-label" for="adv-args">Args (JSON array)</label>
      <textarea
        id="adv-args"
        class="wallet-advanced-textarea"
        rows="2"
        placeholder='["0x…"]'
        bind:value={argsJson}
        spellcheck="false"
      ></textarea>
      <p class="wallet-advanced-hint">Built calldata: <code class="wallet-advanced-code">{builtCalldata.slice(0, 66)}{builtCalldata.length > 66 ? '…' : ''}</code></p>
    {/if}

    {#if simulateOk != null || simulateMessage}
      <p class="wallet-advanced-sim" class:wallet-advanced-sim-ok={simulateOk === true} class:wallet-advanced-sim-err={simulateOk === false}>
        {simulateMessage}
      </p>
    {/if}

    <div class="wallet-advanced-actions">
      <button type="button" class="wallet-advanced-btn wallet-advanced-btn-secondary" disabled={simulating || !canSend} on:click={onSimulate}>
        {simulating ? 'Simulating…' : 'Simulate (eth_call)'}
      </button>
      <button type="button" class="wallet-advanced-btn" disabled={!canSend || sending} on:click={openConfirm}>
        Review &amp; send
      </button>
    </div>
  {/if}
</section>

{#if confirmOpen}
  <div class="wallet-advanced-modal-backdrop" role="presentation" on:click={() => !sending && (confirmOpen = false)}></div>
  <div class="wallet-advanced-modal" role="dialog" aria-labelledby="adv-confirm-title" aria-modal="true">
    <h3 id="adv-confirm-title" class="wallet-advanced-h2">Confirm advanced call</h3>
    <p class="wallet-advanced-hint">This transaction is not squad-linked. Verify every field.</p>
    <dl class="wallet-advanced-summary">
      <dt>Network</dt>
      <dd>{getWalletNetworkDisplayName(network)}</dd>
      <dt>From</dt>
      <dd><code>{activeAdvancedAddress}</code></dd>
      <dt>To</dt>
      <dd><code>{toAddress.trim()}</code></dd>
      <dt>Value</dt>
      <dd>{valueEth.trim() || '0'} ETH ({ethAmountToWeiString(valueEth)} wei)</dd>
      <dt>Calldata</dt>
      <dd><code class="wallet-advanced-code-break">{calldataMode === 'raw' ? normalizeCalldataHex(dataHex) : builtCalldata}</code></dd>
    </dl>
    <div class="wallet-advanced-actions">
      <button type="button" class="wallet-advanced-btn wallet-advanced-btn-secondary" disabled={sending} on:click={() => (confirmOpen = false)}>
        Cancel
      </button>
      <button type="button" class="wallet-advanced-btn" disabled={sending} on:click={onSendConfirmed}>
        {sending ? 'Sending…' : 'Send transaction'}
      </button>
    </div>
  </div>
{/if}

<style>
  .wallet-advanced {
    margin-top: 8px;
  }

  .wallet-advanced-banner {
    margin: 0 0 16px;
    padding: 12px 14px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
    background: var(--bg-elevated, rgba(255, 255, 255, 0.04));
    font-size: 0.8125rem;
    line-height: 1.5;
  }

  .wallet-advanced-h2 {
    margin: 0 0 12px;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .wallet-advanced-hint {
    margin: 0 0 12px;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .wallet-advanced-warn {
    margin: 0 0 10px;
    font-size: 0.8125rem;
    color: var(--text-primary);
  }

  .wallet-advanced-label {
    display: block;
    margin: 12px 0 6px;
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .wallet-advanced-input,
  .wallet-advanced-textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
    background: var(--bg-input, transparent);
    color: var(--text-primary);
    font: inherit;
  }

  .wallet-advanced-textarea {
    resize: vertical;
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
  }

  .wallet-advanced-fieldset {
    margin: 12px 0 0;
    padding: 0;
    border: 0;
  }

  .wallet-advanced-radio {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-right: 16px;
    font-size: 0.875rem;
    cursor: pointer;
  }

  .wallet-advanced-check {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .wallet-advanced-code {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    word-break: break-all;
  }

  .wallet-advanced-code-break {
    font-family: ui-monospace, monospace;
    font-size: 0.6875rem;
    word-break: break-all;
  }

  .wallet-advanced-sim {
    margin: 12px 0 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .wallet-advanced-sim-ok {
    color: var(--accent, #4ade80);
  }

  .wallet-advanced-sim-err {
    color: #f87171;
  }

  .wallet-advanced-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 16px;
  }

  .wallet-advanced-btn {
    padding: 8px 14px;
    border-radius: 6px;
    border: 0;
    background: var(--accent);
    color: var(--accent-fg, #000);
    font: inherit;
    font-size: 0.875rem;
    cursor: pointer;
  }

  .wallet-advanced-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .wallet-advanced-btn-secondary {
    background: transparent;
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
    color: var(--text-primary);
  }

  .wallet-advanced-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 1200;
  }

  .wallet-advanced-modal {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 1201;
    width: min(520px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    overflow: auto;
    padding: 20px;
    border-radius: 10px;
    background: var(--bg-page);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
  }

  .wallet-advanced-summary {
    margin: 0;
    font-size: 0.8125rem;
  }

  .wallet-advanced-summary dt {
    margin-top: 10px;
    font-weight: 600;
    color: var(--text-muted);
  }

  .wallet-advanced-summary dd {
    margin: 4px 0 0;
    word-break: break-all;
  }
</style>
