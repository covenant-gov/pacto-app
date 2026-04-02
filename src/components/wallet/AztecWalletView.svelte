<script lang="ts">
  import { showToast } from '../../stores/toast';
  import {
    startAztecSidecar,
    getAztecAccount,
    getAztecDebugInfo,
    createAztecAccountFromEvm,
    formatAztecAddress,
    AZTEC_CHAIN,
    type AztecAccountInfo,
  } from '../../lib/wallet';

  export let onAztecReady: ((account: AztecAccountInfo) => void) | undefined = undefined;

  let aztecAccount: AztecAccountInfo | null = null;
  let aztecLoading = false;
  let aztecError: string | null = null;
  let debugInfo: any = null;

  async function initAztec() {
    if (aztecLoading) return;
    aztecLoading = true;
    aztecError = null;
    debugInfo = null;

    // Always fetch debug info first
    try {
      debugInfo = await getAztecDebugInfo();
    } catch (e) {
      debugInfo = { error: String(e) };
    }

    try {
      // Check if a sidecar is already running on port 4892
      const existingRunning = debugInfo?.port_scan?.find(
        (p: any) => p.port === 4892 && p.found
      );

      if (!existingRunning) {
        // No existing sidecar, try to start one
        try {
          await startAztecSidecar(4892);
        } catch (e) {
          // If start fails, that's okay - we might be able to use an existing one
          console.log('startAztecSidecar failed:', e);
        }
      }

      // Re-fetch debug info after starting
      try {
        debugInfo = await getAztecDebugInfo();
      } catch {
        // ignore
      }

      // Find the first working port
      const workingPort = debugInfo?.port_scan?.find(
        (p: any) => p.found
      );

      if (!workingPort) {
        aztecError = 'No Aztec sidecar found on ports 4892-4896';
        aztecLoading = false;
        return;
      }

      // Check if we have an existing account
      const existing = await getAztecAccount();
      if (existing) {
        aztecAccount = existing;
        onAztecReady?.(existing);
      } else {
        // Create new account from EVM key
        const result = await createAztecAccountFromEvm();
        if (result.ok) {
          aztecAccount = result.account;
          onAztecReady?.(result.account);
        } else {
          aztecError = result.message;
        }
      }
    } catch (e) {
      aztecError = String(e);
      // Try to get debug info
      try {
        debugInfo = await getAztecDebugInfo();
      } catch {
        // ignore
      }
    } finally {
      aztecLoading = false;
    }
  }

  function copyAztecAddress() {
    if (aztecAccount) {
      navigator.clipboard.writeText(aztecAccount.aztecAddress);
      showToast('Aztec address copied to clipboard');
    }
  }

  function openExplorer() {
    if (aztecAccount) {
      window.open(`${AZTEC_CHAIN.explorerUrl}/address/${aztecAccount.aztecAddress}`, '_blank');
    }
  }

  // Auto-initialize on mount
  initAztec();
</script>

<div class="aztec-wallet">
  <p class="aztec-wallet-lead">
    Private ZK transactions on Aztec. Your Aztec account is derived from your EVM signing key — no separate recovery phrase needed.
  </p>

  {#if debugInfo}
    <details class="debug-info">
      <summary>Debug Info (click to expand)</summary>
      <pre>{JSON.stringify(debugInfo, null, 2)}</pre>
    </details>
  {/if}

  {#if aztecLoading}
    <div class="aztec-wallet-loading">
      <div class="spinner"></div>
      <p>Loading Aztec account...</p>
    </div>
  {:else if aztecError}
    <div class="aztec-wallet-error">
      <p class="error-message">{aztecError}</p>
      <button type="button" class="aztec-wallet-btn aztec-wallet-btn-secondary" on:click={initAztec}>
        Retry
      </button>
    </div>
  {:else if aztecAccount}
    <div class="aztec-wallet-info">
      <div class="aztec-wallet-row">
        <span class="aztec-wallet-label">Address</span>
        <code class="aztec-wallet-address">{formatAztecAddress(aztecAccount.aztecAddress)}</code>
        <div class="aztec-wallet-actions">
          <button type="button" class="aztec-wallet-btn-icon" on:click={copyAztecAddress} title="Copy address">
            Copy
          </button>
          <button type="button" class="aztec-wallet-btn-icon" on:click={openExplorer} title="View on explorer">
            Explorer
          </button>
        </div>
      </div>

      <div class="aztec-wallet-row">
        <span class="aztec-wallet-label">Status</span>
        <span class="aztec-wallet-badge" class:aztec-wallet-badge-deployed={aztecAccount.isDeployed}>
          {aztecAccount.isDeployed ? 'Deployed' : 'Not Deployed'}
        </span>
      </div>

      <div class="aztec-wallet-row">
        <span class="aztec-wallet-label">Network</span>
        <span>{AZTEC_CHAIN.name}</span>
      </div>

      {#if !aztecAccount.isDeployed}
        <div class="aztec-wallet-hint">
          <p>
            Deploy your account to send private transactions. You need Fee Juice for deployment.
          </p>
          <a href={AZTEC_CHAIN.explorerUrl} target="_blank" rel="noopener noreferrer" class="aztec-wallet-link">
            Get Fee Juice on Aztec Explorer →
          </a>
        </div>
      {/if}
    </div>

    <div class="aztec-wallet-balance">
      <h3 class="aztec-wallet-h3">Balance</h3>
      <ul class="aztec-wallet-token-list">
        <li class="aztec-wallet-token-row">
          <div class="aztec-wallet-token-meta">
            <span class="aztec-wallet-token-sym">ETH</span>
            <span class="aztec-wallet-token-net">{AZTEC_CHAIN.name}</span>
          </div>
          <span class="aztec-wallet-token-bal">0.0</span>
        </li>
      </ul>
    </div>
  {:else}
    <div class="aztec-wallet-empty">
      <p class="aztec-wallet-hint">No Aztec account available.</p>
      <button type="button" class="aztec-wallet-btn" on:click={initAztec}>
        Create Aztec Account
      </button>
    </div>
  {/if}
</div>

<style>
  .aztec-wallet {
    padding: 0;
  }

  .aztec-wallet-lead {
    margin: 0 0 20px;
    font-size: 0.9375rem;
    line-height: 1.55;
    color: var(--text-secondary);
  }

  .aztec-wallet-loading {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 20px;
    color: var(--text-muted);
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .aztec-wallet-error {
    padding: 16px;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid var(--danger);
    border-radius: 8px;
  }

  .error-message {
    margin: 0 0 12px;
    color: var(--danger);
    font-size: 0.875rem;
  }

  .aztec-wallet-info {
    padding: 16px;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    margin-bottom: 20px;
  }

  .aztec-wallet-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
    flex-wrap: wrap;
    font-size: 0.875rem;
  }

  .aztec-wallet-row:last-child {
    margin-bottom: 0;
  }

  .aztec-wallet-label {
    font-weight: 600;
    color: var(--text-secondary);
    min-width: 70px;
  }

  .aztec-wallet-address {
    font-size: 0.8125rem;
    color: var(--text-primary);
    background: var(--bg-elevated);
    padding: 4px 8px;
    border-radius: 4px;
  }

  .aztec-wallet-actions {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }

  .aztec-wallet-badge {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 3px 12px;
    border-radius: 12px;
    background: var(--warning);
    color: var(--bg-primary);
  }

  .aztec-wallet-badge-deployed {
    background: var(--success);
  }

  .aztec-wallet-hint {
    margin: 16px 0 0;
    padding: 12px;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--text-muted);
    background: var(--bg-elevated);
    border-radius: 6px;
  }

  .aztec-wallet-hint p {
    margin: 0 0 8px;
  }

  .aztec-wallet-link {
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
  }

  .aztec-wallet-link:hover {
    text-decoration: underline;
  }

  .aztec-wallet-balance {
    margin-top: 20px;
  }

  .aztec-wallet-h3 {
    margin: 0 0 12px;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .aztec-wallet-token-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .aztec-wallet-token-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
  }

  .aztec-wallet-token-meta {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .aztec-wallet-token-sym {
    font-weight: 600;
    color: var(--text-primary);
  }

  .aztec-wallet-token-net {
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .aztec-wallet-token-bal {
    font-weight: 600;
    color: var(--text-primary);
  }

  .aztec-wallet-empty {
    text-align: center;
    padding: 24px;
  }

  .aztec-wallet-btn {
    padding: 10px 20px;
    font-size: 0.875rem;
    font-weight: 600;
    border: none;
    border-radius: 8px;
    background: var(--accent);
    color: #fff;
    cursor: pointer;
    transition: background 0.15s;
  }

  .aztec-wallet-btn:hover {
    background: var(--accent-hover);
  }

  .aztec-wallet-btn-secondary {
    background: var(--bg-elevated);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .aztec-wallet-btn-secondary:hover {
    background: var(--bg-hover);
  }

  .aztec-wallet-btn-icon {
    padding: 4px 10px;
    font-size: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-elevated);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .aztec-wallet-btn-icon:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .debug-info {
    margin: 12px 0;
    font-size: 0.75rem;
  }

  .debug-info summary {
    cursor: pointer;
    color: var(--text-muted);
  }

  .debug-info pre {
    margin: 8px 0 0;
    padding: 8px;
    background: var(--bg-elevated);
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.7rem;
  }
</style>
