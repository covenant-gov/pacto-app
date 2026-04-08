<script lang="ts">
  import { onMount } from 'svelte';
  import { getEvmAddress } from '../../lib/api/auth';
  import { currentUser } from '../../stores/auth';
  import {
    loadWalletEnabledChains,
    saveWalletEnabledChains,
    walletUiEnabledChainsTick,
    defaultWalletEnabledChains,
  } from '../../lib/wallet/wallet-ui-prefs';
  import type { SupportedChainId } from '../../lib/wallet/chains';
  import { WALLET_ASSETS_CHAIN_IDS, getWalletNetworkDisplayName } from '../../lib/wallet/assets';
  import {
    loadWatchedErc20Rows,
    saveWatchedErc20Rows,
    type WatchedErc20Row,
  } from '../../lib/wallet/watched-tokens';
  import WalletImportTokensModal from './WalletImportTokensModal.svelte';
  import WalletHomeSendModal from './WalletHomeSendModal.svelte';
  import WalletReceiveModal from './WalletReceiveModal.svelte';
  import { openExternalUrl } from '../../lib/utils/open-external';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { showToast } from '../../stores/toast';
  import {
    listEvmAccounts,
    addEvmAccountRow,
    updateEvmAccountRow,
    importEvmAccountRow,
    setActiveEvmAccount,
    evmAccountSchemeLabel,
    type EvmAccountRow,
  } from '../../lib/wallet/evm-accounts';
  import { copyTextToClipboard } from '../../lib/wallet/clipboard-copy';

  let importModalOpen = false;
  let homeSendOpen = false;
  let receiveOpen = false;
  let watchedRows: WatchedErc20Row[] = [];
  let enabledSet = new Set<SupportedChainId>(defaultWalletEnabledChains());

  $: accountNpub = $currentUser?.npub ?? null;

  let evmAddress: string | null = null;

  let evmAccountList: EvmAccountRow[] = [];
  let accountsLoading = false;
  let importKeyModalOpen = false;
  let importKeyInput = '';
  let importKeyBusy = false;
  let importSetActive = true;

  /** Unified add / edit account modal (same fields as add). */
  let accountFormMode: 'add' | 'edit' | null = null;
  let accountFormEditId: string | null = null;
  let accountFormLabel = '';
  let accountFormSetSigning = false;
  let accountFormSetReceiving = false;
  let accountFormBusy = false;

  async function loadEvmAccountsList() {
    if (!accountNpub) {
      evmAccountList = [];
      accountsLoading = false;
      return;
    }
    accountsLoading = true;
    try {
      const rows = await listEvmAccounts();
      evmAccountList = rows ?? [];
    } catch (e) {
      evmAccountList = [];
      console.error('list_evm_accounts failed:', e);
    } finally {
      accountsLoading = false;
    }
  }

  async function refreshEvmAddress() {
    if (!accountNpub) {
      evmAddress = null;
      return;
    }
    try {
      const a = await getEvmAddress();
      evmAddress = a?.trim() || null;
    } catch {
      evmAddress = null;
    }
    await loadEvmAccountsList();
  }

  $: accountNpub, void refreshEvmAddress();

  function syncFromDisk() {
    if (!accountNpub) return;
    watchedRows = loadWatchedErc20Rows(accountNpub);
    enabledSet = new Set(loadWalletEnabledChains(accountNpub));
  }

  $: accountNpub, $walletUiEnabledChainsTick, syncFromDisk();

  onMount(syncFromDisk);

  function toggleChain(chain: SupportedChainId) {
    if (!accountNpub) return;
    const next = new Set(enabledSet);
    if (next.has(chain)) {
      if (next.size <= 1) return;
      next.delete(chain);
    } else {
      next.add(chain);
    }
    enabledSet = next;
    saveWalletEnabledChains(accountNpub, [...next]);
  }

  function removeWatchedRow(row: WatchedErc20Row) {
    if (!accountNpub) return;
    const next = watchedRows.filter((r) => r.id !== row.id);
    watchedRows = next;
    saveWatchedErc20Rows(accountNpub, next);
  }

  const RPC_DOCS_URL = import.meta.env.VITE_WALLET_RPC_DOCS_URL as string | undefined;

  function openRpcDocs() {
    const u = typeof RPC_DOCS_URL === 'string' ? RPC_DOCS_URL.trim() : '';
    if (u.startsWith('http://') || u.startsWith('https://')) {
      openExternalUrl(u);
    }
  }

  function onBuyCryptoClick() {
    showToast('Buying crypto in the app is not available yet.');
  }

  function shortAddr(a: string): string {
    const t = a.trim();
    if (t.length < 18) return t;
    return `${t.slice(0, 10)}…${t.slice(-8)}`;
  }

  async function copyAccountAddress(address: string) {
    const t = address.trim();
    if (!t) return;
    const ok = await copyTextToClipboard(t);
    showToast(ok ? 'Address copied' : 'Could not copy address');
  }

  function resetAccountFormFields() {
    accountFormLabel = '';
    accountFormSetSigning = false;
    accountFormSetReceiving = false;
    accountFormEditId = null;
  }

  function closeAccountFormModal() {
    if (accountFormBusy) return;
    accountFormMode = null;
    resetAccountFormFields();
  }

  function openAddAccountModal() {
    resetAccountFormFields();
    accountFormMode = 'add';
  }

  function openEditAccountModal(acc: EvmAccountRow) {
    accountFormMode = 'edit';
    accountFormEditId = acc.id;
    accountFormLabel = acc.label ?? '';
    accountFormSetSigning = acc.isActive;
    accountFormSetReceiving = acc.isDefaultShared;
  }

  async function submitAccountForm() {
    if (!accountNpub || accountFormBusy || !accountFormMode) return;
    const setReceiving = accountFormSetReceiving;
    const mode = accountFormMode;
    const editId = accountFormEditId;
    if (mode === 'edit' && !editId) return;
    accountFormBusy = true;
    try {
      if (mode === 'add') {
        await addEvmAccountRow({
          label: accountFormLabel,
          setActiveSigner: accountFormSetSigning,
          setDefaultShared: accountFormSetReceiving,
        });
        if (setReceiving) {
          showToast('Receiving address saved. Publishing profile metadata…');
        } else {
          showToast('Account added.');
        }
      } else if (editId) {
        await updateEvmAccountRow({
          accountId: editId,
          label: accountFormLabel,
          setActiveSigner: accountFormSetSigning,
          setDefaultShared: accountFormSetReceiving,
        });
        if (setReceiving) {
          showToast('Receiving address saved. Publishing profile metadata…');
        } else {
          showToast('Account updated.');
        }
      }
      accountFormMode = null;
      resetAccountFormFields();
      await refreshEvmAddress();
    } catch (e) {
      showToast(
        getInvokeErrorMessage(e, mode === 'add' ? 'Could not add account.' : 'Could not update account.')
      );
    } finally {
      accountFormBusy = false;
    }
  }

  async function onSetActiveAccount(id: string) {
    try {
      await setActiveEvmAccount(id);
      await refreshEvmAddress();
    } catch (e) {
      showToast(getInvokeErrorMessage(e, 'Could not switch account.'));
    }
  }

  async function submitImportKey() {
    if (!importKeyInput.trim()) {
      showToast('Paste a private key (0x + 64 hex).');
      return;
    }
    importKeyBusy = true;
    try {
      await importEvmAccountRow(importKeyInput.trim(), importSetActive);
      importKeyModalOpen = false;
      importKeyInput = '';
      await refreshEvmAddress();
      showToast('Imported account saved.');
    } catch (e) {
      showToast(getInvokeErrorMessage(e, 'Import failed.'));
    } finally {
      importKeyBusy = false;
    }
  }

  /** Enabled chains in catalog order (Send network list + settings). */
  $: enabledChainsOrdered = WALLET_ASSETS_CHAIN_IDS.filter((id) => enabledSet.has(id));

  /** Kind 0 / profile default; when unset, receiving matches the signing address. */
  $: profileDefaultEvmAddress = evmAccountList.find((a) => a.isDefaultShared)?.address?.trim() || null;
  $: displayReceivingAddress = profileDefaultEvmAddress ?? evmAddress;
</script>

<div class="wallet-view" aria-labelledby="wallet-view-title">
  <div class="wallet-view-inner">
    <header class="wallet-view-header">
      <h1 id="wallet-view-title" class="wallet-view-title">EVM Wallet</h1>
      <p class="wallet-view-lead">
        Your embedded EVM wallet: send to any address, receive by sharing your address, and manage networks and tokens. Payment requests with
        contacts stay in <strong>DMs</strong> (in-chat wallet panel). Nostr profile, backup, and logout: <strong>Settings → Profile</strong>.
      </p>
    </header>

    {#if accountNpub}
      <section class="wallet-view-section wallet-view-actions-section" aria-labelledby="wallet-actions-heading">
        <h2 id="wallet-actions-heading" class="visually-hidden">Wallet actions</h2>
        <div class="wallet-view-action-row">
          <button
            type="button"
            class="wallet-view-btn wallet-view-btn-action"
            on:click={() => (homeSendOpen = true)}
            disabled={!evmAddress}
          >
            Send
          </button>
          <button
            type="button"
            class="wallet-view-btn wallet-view-btn-action wallet-view-btn-action-secondary"
            on:click={() => (receiveOpen = true)}
            disabled={!evmAddress}
          >
            Receive
          </button>
          <button type="button" class="wallet-view-btn wallet-view-btn-action-outline" on:click={onBuyCryptoClick}>
            Buy crypto
          </button>
        </div>
        {#if !evmAddress}
          <p class="wallet-view-hint wallet-view-hint-tight">Unlock or wait for your wallet address to load to use Send and Receive.</p>
        {/if}
      </section>
    {/if}

    {#if accountNpub}
      <section class="wallet-view-section" aria-labelledby="wallet-accounts-heading">
        <div class="wallet-view-section-head">
          <h2 id="wallet-accounts-heading" class="wallet-view-h2">EVM Accounts</h2>
          <div class="wallet-view-account-actions">
            <button
              type="button"
              class="wallet-view-btn wallet-view-btn-secondary"
              disabled={!evmAddress}
              on:click={openAddAccountModal}
            >
              Add new EVM account
            </button>
            <button
              type="button"
              class="wallet-view-btn"
              disabled={!evmAddress}
              on:click={() => {
                importKeyModalOpen = true;
              }}
            >
              Import private key
            </button>
          </div>
        </div>
        <p class="wallet-view-hint">
          Extra addresses are derived from your recovery phrase using standard Ethereum paths. Imported keys are not covered by that phrase.
          Treasury and Safe deploy require a derived account (from your phrase) as the active signer, not an imported key.
        </p>
        {#if accountsLoading && evmAccountList.length === 0}
          <p class="wallet-view-empty">Loading accounts…</p>
        {:else if evmAccountList.length === 0}
          <p class="wallet-view-empty">No accounts yet. Unlock your wallet or wait for sync.</p>
        {:else}
          <ul class="wallet-view-account-list">
            {#each evmAccountList as acc (acc.id)}
              <li class="wallet-view-account-row" class:wallet-view-account-active={acc.isActive}>
                <label class="wallet-view-account-select">
                  <input
                    type="radio"
                    name="active_evm_account"
                    checked={acc.isActive}
                    disabled={accountsLoading}
                    on:change={() => onSetActiveAccount(acc.id)}
                  />
                  <span class="wallet-view-account-meta">
                    <span class="wallet-view-account-scheme">{evmAccountSchemeLabel(acc.scheme)}</span>
                    {#if acc.hdIndex != null}
                      <span class="wallet-view-account-idx">#{acc.hdIndex}</span>
                    {/if}
                    {#if acc.label?.trim()}
                      <span class="wallet-view-account-name">· {acc.label.trim()}</span>
                    {/if}
                  </span>
                </label>
                <code class="wallet-view-account-addr" title={acc.address}>{shortAddr(acc.address)}</code>
                <div class="wallet-view-account-tools">
                  {#if acc.isActive}
                    <span class="wallet-view-account-badge">Signer</span>
                  {/if}
                  {#if acc.isDefaultShared}
                    <span class="wallet-view-account-badge">Receiver</span>
                  {/if}
                  <button
                    type="button"
                    class="wallet-view-account-more"
                    disabled={accountsLoading}
                    aria-label="Edit account name and roles"
                    title="Edit name, signing address, receiving address"
                    on:click={() => openEditAccountModal(acc)}
                  >
                    …
                  </button>
                  <button
                    type="button"
                    class="wallet-view-account-copy-icon-btn"
                    disabled={accountsLoading || !acc.address?.trim()}
                    aria-label="Copy address to clipboard"
                    title="Copy address"
                    on:click|stopPropagation={() => copyAccountAddress(acc.address)}
                  >
                    <svg
                      class="wallet-view-account-copy-svg"
                      width="18"
                      height="18"
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
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    <section class="wallet-view-section" aria-labelledby="wallet-networks-heading">
      <h2 id="wallet-networks-heading" class="wallet-view-h2">Networks</h2>
      <p class="wallet-view-hint">
        Enable chains you use. At least one must stay on. Affects Send, this view, and the DM wallet sidebar.
      </p>
      <ul class="wallet-view-toggle-list">
        {#each WALLET_ASSETS_CHAIN_IDS as chain (chain)}
          <li>
            <label class="wallet-view-toggle">
              <input
                type="checkbox"
                checked={enabledSet.has(chain)}
                disabled={enabledSet.has(chain) && enabledSet.size <= 1}
                on:change={() => toggleChain(chain)}
              />
              <span>{getWalletNetworkDisplayName(chain)}</span>
              <span class="wallet-view-chain-id">{chain}</span>
            </label>
          </li>
        {/each}
      </ul>
    </section>

    <section class="wallet-view-section" aria-labelledby="wallet-tokens-heading">
      <div class="wallet-view-section-head">
        <h2 id="wallet-tokens-heading" class="wallet-view-h2">Tokens to Track</h2>
        <button type="button" class="wallet-view-btn" on:click={() => (importModalOpen = true)}>Import tokens</button>
      </div>
      <p class="wallet-view-hint">Tracked assets appear in Send and in the DM wallet sidebar (per network).</p>
      {#if watchedRows.length === 0}
        <p class="wallet-view-empty">No extra tokens yet. Native ETH balances still show when RPCs are available.</p>
      {:else}
        <ul class="wallet-view-token-list">
          {#each watchedRows as row (row.id)}
            <li class="wallet-view-token-row">
              <div class="wallet-view-token-meta">
                <span class="wallet-view-token-sym">{row.symbol}</span>
                <span class="wallet-view-token-net">{getWalletNetworkDisplayName(row.network)}</span>
                <code class="wallet-view-token-addr">{row.address.slice(0, 10)}…{row.address.slice(-6)}</code>
                <span class="wallet-view-token-src">{row.source}</span>
              </div>
              <button type="button" class="wallet-view-btn-text" on:click={() => removeWatchedRow(row)}>Remove</button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="wallet-view-section" aria-labelledby="wallet-rpc-heading">
      <h2 id="wallet-rpc-heading" class="wallet-view-h2">RPC endpoints</h2>
      <p class="wallet-view-hint">
        Advanced: custom RPC URLs are documented in the repo at
        <code class="wallet-view-code">docs/wallet/RPC_AND_VIEM_ARCHITECTURE.md</code>
        (environment variables per chain).
      </p>
      {#if RPC_DOCS_URL && (RPC_DOCS_URL.startsWith('http://') || RPC_DOCS_URL.startsWith('https://'))}
        <button type="button" class="wallet-view-btn wallet-view-btn-secondary" on:click={openRpcDocs}>
          Open RPC documentation
        </button>
      {/if}
    </section>

    <aside class="wallet-view-alpha" role="note">
      <strong>Alpha software.</strong>
      Wallet and key handling have not been reviewed by an independent security audit. Use only funds you can afford to lose. See
      <code class="wallet-view-code">docs/audits/README.md</code> in the repository.
    </aside>
  </div>
</div>

{#if accountNpub}
  <WalletImportTokensModal
    open={importModalOpen}
    networkScope="all"
    {accountNpub}
    onClose={() => (importModalOpen = false)}
    onSaved={() => {
      syncFromDisk();
      importModalOpen = false;
    }}
  />
  <WalletHomeSendModal
    open={homeSendOpen}
    onClose={() => {
      homeSendOpen = false;
    }}
    watchedAssetRows={watchedRows}
    enabledChainIds={enabledChainsOrdered}
  />
{/if}

<WalletReceiveModal
  open={receiveOpen && !!displayReceivingAddress}
  address={displayReceivingAddress ?? ''}
  onClose={() => (receiveOpen = false)}
/>

{#if accountFormMode}
  <div
    class="wallet-view-modal-backdrop"
    role="presentation"
    on:click={closeAccountFormModal}
  ></div>
  <div class="wallet-view-modal" role="dialog" aria-labelledby="account-form-title" aria-modal="true">
    <h2 id="account-form-title" class="wallet-view-h2">
      {accountFormMode === 'add' ? 'Add EVM account' : 'Edit EVM account'}
    </h2>
    {#if accountFormMode === 'add'}
      <p class="wallet-view-hint">
        Creates a new address from your recovery phrase. Name is optional and only stored on this device.
      </p>
    {:else}
      <p class="wallet-view-hint">
        Update the display name and whether this account is the signer or published receiving address. Name is only stored on this device.
      </p>
    {/if}
    <label class="wallet-view-edit-label" for="account-form-name">Name</label>
    <input
      id="account-form-name"
      type="text"
      class="wallet-view-add-account-input"
      maxlength="64"
      placeholder="e.g. Savings"
      bind:value={accountFormLabel}
      disabled={accountFormBusy}
    />
    <label class="wallet-view-import-check">
      <input type="checkbox" bind:checked={accountFormSetSigning} disabled={accountFormBusy} />
      Use as signing address (Send, balances, DM wallet)
    </label>
    <label class="wallet-view-import-check">
      <input type="checkbox" bind:checked={accountFormSetReceiving} disabled={accountFormBusy} />
      Use as receiving address (profile / Kind 0; republishes your profile)
    </label>
    <div class="wallet-view-modal-actions">
      <button
        type="button"
        class="wallet-view-btn wallet-view-btn-secondary"
        disabled={accountFormBusy}
        on:click={closeAccountFormModal}
      >
        Cancel
      </button>
      <button type="button" class="wallet-view-btn" disabled={accountFormBusy} on:click={submitAccountForm}>
        {#if accountFormBusy}
          {accountFormMode === 'add' ? 'Adding…' : 'Saving…'}
        {:else if accountFormMode === 'add'}
          Add account
        {:else}
          Save
        {/if}
      </button>
    </div>
  </div>
{/if}

{#if importKeyModalOpen}
  <div
    class="wallet-view-modal-backdrop"
    role="presentation"
    on:click={() => {
      if (!importKeyBusy) importKeyModalOpen = false;
    }}
  ></div>
  <div class="wallet-view-modal" role="dialog" aria-labelledby="import-pk-title" aria-modal="true">
    <h2 id="import-pk-title" class="wallet-view-h2">Import EVM private key</h2>
    <p class="wallet-view-hint">
      Paste a standalone Ethereum private key (32-byte secret). It is encrypted like your other keys. Not recoverable from your recovery phrase.
    </p>
    <textarea
      class="wallet-view-import-textarea"
      rows="3"
      placeholder="0x…"
      bind:value={importKeyInput}
      disabled={importKeyBusy}
    ></textarea>
    <label class="wallet-view-import-check">
      <input type="checkbox" bind:checked={importSetActive} disabled={importKeyBusy} />
      Use this account as the active signer after import
    </label>
    <div class="wallet-view-modal-actions">
      <button
        type="button"
        class="wallet-view-btn wallet-view-btn-secondary"
        disabled={importKeyBusy}
        on:click={() => {
          importKeyModalOpen = false;
          importKeyInput = '';
        }}
      >
        Cancel
      </button>
      <button type="button" class="wallet-view-btn" disabled={importKeyBusy} on:click={submitImportKey}>
        {importKeyBusy ? 'Importing…' : 'Import'}
      </button>
    </div>
  </div>
{/if}

<style>
  .wallet-view {
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: auto;
    background: var(--bg-page);
  }

  .wallet-view-inner {
    max-width: 720px;
    margin: 0 auto;
    padding: 28px 32px 48px;
  }

  .wallet-view-header {
    margin-bottom: 28px;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .wallet-view-actions-section {
    padding-bottom: 24px;
  }

  .wallet-view-action-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }

  .wallet-view-btn-action {
    min-width: 108px;
  }

  .wallet-view-btn-action-secondary {
    background: var(--bg-elevated);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .wallet-view-btn-action-secondary:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .wallet-view-btn-action-outline {
    background: transparent;
    color: var(--accent);
    border: 1px dashed var(--border);
  }

  .wallet-view-btn-action-outline:hover {
    border-color: var(--accent);
    background: rgba(80, 200, 180, 0.06);
  }

  .wallet-view-btn-action:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .wallet-view-hint-tight {
    margin-top: 10px;
    margin-bottom: 0;
  }

  .wallet-view-title {
    margin: 0 0 10px;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .wallet-view-lead {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.55;
    color: var(--text-secondary);
  }

  .wallet-view-section {
    margin-bottom: 32px;
    padding-bottom: 28px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .wallet-view-section:last-of-type {
    border-bottom: none;
  }

  .wallet-view-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }

  .wallet-view-h2 {
    margin: 0 0 8px;
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .wallet-view-section-head .wallet-view-h2 {
    margin-bottom: 0;
  }

  .wallet-view-hint {
    margin: 0 0 14px;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .wallet-view-toggle-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .wallet-view-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 0.9375rem;
    color: var(--text-primary);
  }

  .wallet-view-toggle input {
    accent-color: var(--accent);
  }

  .wallet-view-chain-id {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-family: var(--font-mono, ui-monospace, monospace);
  }

  .wallet-view-btn {
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    font-size: 0.875rem;
    cursor: pointer;
  }

  .wallet-view-btn:hover {
    background: var(--accent-hover);
  }

  .wallet-view-btn-secondary {
    background: var(--bg-elevated);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .wallet-view-btn-secondary:hover {
    background: var(--bg-hover);
  }

  .wallet-view-token-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .wallet-view-token-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
  }

  .wallet-view-token-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    min-width: 0;
  }

  .wallet-view-token-sym {
    font-weight: 600;
    color: var(--text-primary);
  }

  .wallet-view-token-net {
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .wallet-view-token-addr {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .wallet-view-token-src {
    font-size: 0.7rem;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .wallet-view-btn-text {
    background: none;
    border: none;
    color: var(--danger);
    font-size: 0.8125rem;
    cursor: pointer;
    flex-shrink: 0;
  }

  .wallet-view-btn-text:hover {
    text-decoration: underline;
  }

  .wallet-view-empty {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .wallet-view-code {
    font-size: 0.8em;
    padding: 2px 6px;
    background: var(--bg-elevated);
    border-radius: 4px;
    word-break: break-all;
  }

  .wallet-view-account-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .wallet-view-account-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .wallet-view-account-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 10px 14px;
    padding: 12px 14px;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
  }

  .wallet-view-account-active {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px rgba(80, 200, 180, 0.25);
  }

  .wallet-view-account-select {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    margin: 0;
    min-width: 0;
  }

  .wallet-view-account-select input {
    accent-color: var(--accent);
  }

  .wallet-view-account-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .wallet-view-account-scheme {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .wallet-view-account-idx {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-family: ui-monospace, monospace;
  }

  .wallet-view-account-name {
    font-size: 0.75rem;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .wallet-view-account-addr {
    font-size: 0.78rem;
    color: var(--text-primary);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .wallet-view-account-tools {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .wallet-view-account-more {
    min-width: 2.25rem;
    height: 2rem;
    padding: 0 0.35rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-hover);
    color: var(--text-primary);
    font-size: 1rem;
    line-height: 1;
    letter-spacing: 0.02em;
    cursor: pointer;
    flex-shrink: 0;
  }

  .wallet-view-account-more:hover:not(:disabled) {
    border-color: var(--text-muted);
    background: var(--bg-elevated);
  }

  .wallet-view-account-more:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .wallet-view-account-copy-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-hover);
    color: var(--text-primary);
    cursor: pointer;
    flex-shrink: 0;
  }

  .wallet-view-account-copy-icon-btn:hover:not(:disabled) {
    border-color: var(--text-muted);
    background: var(--bg-elevated);
    color: var(--accent);
  }

  .wallet-view-account-copy-icon-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .wallet-view-account-copy-svg {
    display: block;
  }

  .wallet-view-account-badge {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
  }

  .wallet-view-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 1200;
  }

  .wallet-view-modal {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 1201;
    width: min(420px, calc(100vw - 32px));
    max-height: min(480px, calc(100vh - 48px));
    overflow: auto;
    padding: 22px 22px 18px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
  }

  .wallet-view-modal .wallet-view-h2 {
    margin-top: 0;
  }

  .wallet-view-edit-label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 4px 0 6px;
  }

  .wallet-view-add-account-input {
    width: 100%;
    box-sizing: border-box;
    margin: 0 0 14px;
    padding: 10px 12px;
    font-size: 0.9375rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-page);
    color: var(--text-primary);
  }

  .wallet-view-add-account-input:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .wallet-view-import-textarea {
    width: 100%;
    box-sizing: border-box;
    margin: 0 0 12px;
    padding: 10px 12px;
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-page);
    color: var(--text-primary);
    resize: vertical;
  }

  .wallet-view-import-check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    margin-bottom: 16px;
    cursor: pointer;
  }

  .wallet-view-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    flex-wrap: wrap;
  }

  .wallet-view-alpha {
    margin-top: 8px;
    padding: 14px 16px;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--text-secondary);
    background: rgba(251, 191, 36, 0.08);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
</style>
