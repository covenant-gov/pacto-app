<script lang="ts">
  import { onMount } from 'svelte';
  import { isAddress } from 'viem';
  import chevronDownIcon from '../../../icons/chevron-down.svg';
  import { showToast } from '../../../stores/toast';
  import { squadAllowlistNonceByParentId } from '../../../stores/navigation';
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
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';

  export let parentId = '';
  export let announcementsGroupId = '';
  /** Interim v1: Pacto Gov deployed (captain-gated mutation ships with on-chain role check). */
  export let canManage = false;
  /** Slimmer chrome for Status (collapsed add form by default). */
  export let compact = false;

  const tFn = get(t);

  let rows: SquadContractAllowlistRow[] = [];
  let loading = true;
  let loadError = '';

  let addChain: SupportedChainId = DEFAULT_CHAIN_ID;
  let addAddress = '';
  let addLabel = '';
  let addAbiRef = '';
  let addBusy = false;
  let addSectionOpen = false;

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
      loadError = getInvokeErrorMessage(e, tFn('governance.error.couldNotLoadAllowlist'));
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

  $: allowlistNonce = $squadAllowlistNonceByParentId[parentId.trim()] ?? 0;
  $: parentId, allowlistNonce, void refreshRows();

  function shortAddr(a: string): string {
    const t = a.trim();
    if (t.length < 18) return t;
    return `${t.slice(0, 10)}…${t.slice(-8)}`;
  }

  async function onAddContract() {
    if (!canManage || addBusy) return;
    const addr = addAddress.trim();
    if (!isAddress(addr)) {
      showToast(tFn('governance.error.invalidContractAddress'));
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
        try {
          await publishSquadAllowlistAnnounce(
            announcementsGroupId,
            buildAllowlistAnnouncePayload({ parentId, action: 'upsert', row }),
          );
        } catch (announceErr) {
          await removeSquadContractAllowlist(parentId, row.id);
          throw announceErr;
        }
      }
      addAddress = '';
      addLabel = '';
      addAbiRef = '';
      await refreshRows();
      showToast(tFn('governance.toast.contractAdded'));
    } catch (e) {
      showToast(getInvokeErrorMessage(e, tFn('governance.error.couldNotAddContract')));
    } finally {
      addBusy = false;
    }
  }

  async function onRemove(row: SquadContractAllowlistRow) {
    if (!canManage) return;
    try {
      await removeSquadContractAllowlist(parentId, row.id);
      if (announcementsGroupId.trim()) {
        try {
          await publishSquadAllowlistAnnounce(
            announcementsGroupId,
            buildAllowlistAnnouncePayload({ parentId, action: 'remove', row }),
          );
        } catch (announceErr) {
          await upsertSquadContractAllowlist({
            parentId,
            chain: row.chain,
            contractAddress: row.contractAddress,
            label: row.label,
            abiRef: row.abiRef,
            notes: row.notes,
          });
          throw announceErr;
        }
      }
      await refreshRows();
      showToast(tFn('governance.toast.contractRemoved'));
    } catch (e) {
      showToast(getInvokeErrorMessage(e, tFn('governance.error.couldNotRemoveContract')));
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
        callSimMessage = tFn('governance.error.invalidTargetAddress');
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
      callSimMessage = result.ok ? tFn('governance.toast.simulationSucceeded') : result.message;
    } catch (e) {
      callSimOk = false;
      callSimMessage = e instanceof Error ? e.message : tFn('governance.error.simulationFailed');
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
      startedToast: tFn('governance.toast.squadTransactionSubmitted'),
      subject: tFn('governance.onchain.subject'),
      job: async () => {
        const outcome = await evmSendSquadAllowlistedContractCall(params);
        if (!outcome.ok) throw new Error(outcome.message);
        return outcome.result;
      },
      onSuccess: (result) => {
        toastOnChainSubmitted(callChain, result.txHash, tFn('governance.onchain.subject'));
        waitForOnChainConfirmationInBackground(callChain, result.txHash, {
          subject: tFn('governance.onchain.subject'),
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

<section
  class="smart-contract-security"
  class:smart-contract-security--compact={compact}
  aria-labelledby="smart-contract-security-heading"
>
  <h4 id="smart-contract-security-heading" class="roles-table-caption">{$t('governance.title.contracts')}</h4>

  {#if loading}
    <p class="smart-contract-security-note muted">{$t('governance.status.loading')}</p>
  {:else if loadError}
    <p class="smart-contract-security-note">{loadError}</p>
  {:else if rows.length === 0}
    <p class="smart-contract-security-note muted">{$t('governance.empty.noAllowlistedContracts')}</p>
  {:else}
    <ul class="allowlist-list">
      {#each rows as row (row.id)}
        <li class="allowlist-row">
          <div class="allowlist-main">
            <span class="allowlist-label">{row.label?.trim() || tFn('governance.allowlist.unlabeled')}</span>
            <span class="allowlist-meta">{getWalletNetworkDisplayName(row.chain as SupportedChainId)} · {shortAddr(row.contractAddress)}</span>
          </div>
          {#if canManage}
            <button type="button" class="allowlist-remove" on:click={() => onRemove(row)}>{tFn('governance.action.remove')}</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if canManage}
    <div class="allowlist-add">
      <h5 class="allowlist-subhead">
        <button
          type="button"
          class="allowlist-call-toggle"
          aria-expanded={addSectionOpen}
          aria-controls="squad-contract-add-panel"
          on:click={() => (addSectionOpen = !addSectionOpen)}
        >
          <img
            src={chevronDownIcon}
            alt=""
            class="allowlist-call-chevron"
            class:allowlist-call-chevron--open={addSectionOpen}
          />
          <span>{$t('governance.allowlist.addContract')}</span>
        </button>
      </h5>
      <div id="squad-contract-add-panel" class="allowlist-call-panel" hidden={!addSectionOpen}>
        <label class="allowlist-field-label" for="allowlist-chain">{$t('governance.field.chain')}</label>
        <select id="allowlist-chain" class="allowlist-input" bind:value={addChain}>
          {#each WALLET_ASSETS_CHAIN_IDS as chain (chain)}
            <option value={chain}>{getWalletNetworkDisplayName(chain)}</option>
          {/each}
        </select>
        <label class="allowlist-field-label" for="allowlist-addr">{$t('governance.field.contractAddress')}</label>
        <input id="allowlist-addr" class="allowlist-input" placeholder={$t('governance.field.contractAddressPlaceholder')} bind:value={addAddress} />
        <label class="allowlist-field-label" for="allowlist-label">{$t('governance.field.label')}</label>
        <input id="allowlist-label" class="allowlist-input" placeholder={$t('governance.field.labelPlaceholder')} bind:value={addLabel} />
        <label class="allowlist-field-label" for="allowlist-abi">{$t('governance.field.abiRef')}</label>
        <input id="allowlist-abi" class="allowlist-input" placeholder={$t('governance.field.abiRefPlaceholder')} bind:value={addAbiRef} />
        <button type="button" class="allowlist-btn" disabled={addBusy} on:click={onAddContract}>
          {addBusy ? tFn('governance.allowlist.addingToAllowlist') : tFn('governance.action.addToAllowlist')}
        </button>
      </div>
    </div>
  {:else if !compact}
    <p class="smart-contract-security-note muted">{$t('governance.info.onlyRoleApproved')}</p>
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
        <span>{$t('governance.allowlist.contractCall')}</span>
      </button>
    </h5>
    <div id="squad-contract-call-panel" class="allowlist-call-panel" hidden={!callSectionOpen}>
    {#if !squadSigner}
      <p class="smart-contract-security-note muted">{$t('governance.info.setDefaultSigner')}</p>
    {:else}
      <p class="smart-contract-security-note muted">{$t('governance.info.signingAs', { values: { address: shortAddr(squadSigner) } })}</p>
      <label class="allowlist-field-label" for="call-chain">{$t('governance.field.chain')}</label>
      <select id="call-chain" class="allowlist-input" bind:value={callChain}>
        {#each WALLET_ASSETS_CHAIN_IDS as chain (chain)}
          <option value={chain}>{getWalletNetworkDisplayName(chain)}</option>
        {/each}
      </select>
      <label class="allowlist-field-label" for="call-to">{$t('governance.field.targetAllowlisted')}</label>
      <input id="call-to" class="allowlist-input" placeholder={$t('governance.field.targetPlaceholder')} bind:value={callTo} list="allowlist-targets" />
      <datalist id="allowlist-targets">
        {#each rows.filter((r) => r.chain === callChain) as row (row.id)}
          <option value={row.contractAddress}>{row.label || row.contractAddress}</option>
        {/each}
      </datalist>
      {#if callTargetLabel}
        <p class="allowlist-target-label">{$t('governance.info.allowlistTarget', { values: { label: callTargetLabel } })}</p>
      {/if}
      <label class="allowlist-field-label" for="call-value">{$t('governance.field.valueEth')}</label>
      <input id="call-value" class="allowlist-input" bind:value={callValueEth} />
      <fieldset class="allowlist-mode">
        <legend class="allowlist-field-label">{$t('governance.field.calldata')}</legend>
        <label><input type="radio" bind:group={callMode} value="raw" /> {$t('governance.field.rawHex')}</label>
        <label><input type="radio" bind:group={callMode} value="abi" /> {$t('governance.field.shippedAbi')}</label>
      </fieldset>
      {#if callMode === 'raw'}
        <textarea class="allowlist-textarea" rows="2" bind:value={callDataHex} placeholder="0x"></textarea>
      {:else}
        <select class="allowlist-input" bind:value={callAbiRef}>
          {#each shippedAbis as item (item.ref)}
            <option value={item.ref}>{item.label}</option>
          {/each}
        </select>
        <input class="allowlist-input" placeholder={$t('governance.field.functionNamePlaceholder')} bind:value={callFunctionName} />
        <textarea class="allowlist-textarea" rows="2" bind:value={callArgsJson} placeholder={$t('governance.field.argsPlaceholder')}></textarea>
      {/if}
      {#if callSimMessage}
        <p class="allowlist-sim" class:ok={callSimOk === true} class:err={callSimOk === false}>{callSimMessage}</p>
      {/if}
      <div class="allowlist-call-actions">
        <button type="button" class="allowlist-btn allowlist-btn-secondary" disabled={callSimulating} on:click={onSimulateCall}>
          {callSimulating ? tFn('governance.allowlist.simulating') : tFn('governance.action.simulate')}
        </button>
        <button type="button" class="allowlist-btn" disabled={!canSendCall || callSending} on:click={onSendCall}>
          {callSending ? tFn('governance.allowlist.sending') : tFn('governance.action.sendSquadKey')}
        </button>
      </div>
    {/if}
    </div>
  </div>
</section>

<style>
  .smart-contract-security {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
  }

  .roles-table-caption {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .smart-contract-security-note {
    font-size: 0.8125rem;
    line-height: 1.4;
    margin: 0 0 6px 0;
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
    margin-top: 12px;
    padding-top: 10px;
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
    outline: 2px solid var(--brand);
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
    background: var(--brand);
    color: var(--on-brand);
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
    color: var(--success, #4ade80);
  }

  .allowlist-sim.err {
    color: #f87171;
  }

  .allowlist-target-label {
    font-size: 0.8125rem;
    margin: 4px 0 0;
  }
</style>
