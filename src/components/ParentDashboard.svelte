<script lang="ts">
  import type { Squad, Network } from '../stores/app';

  export let parent: Squad | Network;
  export let parentType: 'squad' | 'network' = 'squad';

  /** Safe address for this squad/network (from backend or state). Null = not linked yet. */
  export let safeAddress: string | null = null;

  let showSetSafeModal = false;
  let setSafeInput = '';
  let setSafeError = '';

  function openSetSafe() {
    showSetSafeModal = true;
    setSafeInput = safeAddress ?? '';
    setSafeError = '';
  }

  function closeSetSafeModal() {
    showSetSafeModal = false;
    setSafeInput = '';
    setSafeError = '';
  }

  function confirmSetSafe() {
    const addr = setSafeInput.trim();
    if (!addr) {
      setSafeError = 'Enter a Safe address';
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      setSafeError = 'Invalid address (expected 0x + 40 hex chars)';
      return;
    }
    // TODO (3.10): call backend set_squad_safe(parent.id, addr) and post announce-card to # announcements
    closeSetSafeModal();
  }
</script>

<div class="parent-dashboard">
  <div class="dashboard-header">
    <h2 class="dashboard-title">{parent.name}</h2>
    {#if parentType === 'network' && (parent as Network).memberSquads?.length}
      <p class="dashboard-subtitle">
        {(parent as Network).memberSquads.map((s) => s.name).join(', ')}
      </p>
    {/if}
  </div>

  <section class="dashboard-section" aria-labelledby="safe-heading">
    <h3 id="safe-heading" class="section-heading">Multisig (Safe)</h3>
    {#if safeAddress}
      <div class="safe-address-row">
        <span class="safe-address-value">{safeAddress}</span>
        <button type="button" class="btn-secondary" on:click={openSetSafe}>Change</button>
      </div>
    {:else}
      <p class="no-safe">No Safe linked</p>
      <button type="button" class="btn-primary" on:click={openSetSafe}>Set Safe address</button>
    {/if}
  </section>
</div>

{#if showSetSafeModal}
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="set-safe-title">
    <div class="modal-content">
      <h3 id="set-safe-title">Set Safe address</h3>
      <p class="modal-desc">Enter the Safe contract address for this {parentType}. All members will see it on their dashboard.</p>
      <input
        type="text"
        class="input-address"
        placeholder="0x..."
        bind:value={setSafeInput}
        aria-invalid={setSafeError ? 'true' : undefined}
        aria-describedby={setSafeError ? 'set-safe-error' : undefined}
      />
      {#if setSafeError}
        <p id="set-safe-error" class="input-error" role="alert">{setSafeError}</p>
      {/if}
      <div class="modal-actions">
        <button type="button" class="btn-secondary" on:click={closeSetSafeModal}>Cancel</button>
        <button type="button" class="btn-primary" on:click={confirmSetSafe}>Save</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .parent-dashboard {
    padding: 24px;
    max-width: 560px;
  }
  .dashboard-header {
    margin-bottom: 24px;
  }
  .dashboard-title {
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0 0 4px 0;
    color: var(--text-primary);
  }
  .dashboard-subtitle {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0;
  }
  .dashboard-section {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
  }
  .section-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0 0 12px 0;
  }
  .safe-address-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .safe-address-value {
    font-family: monospace;
    font-size: 0.875rem;
    word-break: break-all;
    color: var(--text-primary);
  }
  .no-safe {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0 0 12px 0;
  }
  .btn-primary,
  .btn-secondary {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 0.875rem;
    cursor: pointer;
  }
  .btn-primary {
    background: var(--accent);
    color: var(--accent-contrast, #fff);
    border: none;
  }
  .btn-secondary {
    background: var(--bg-secondary);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal-content {
    background: var(--bg-panel);
    border-radius: 12px;
    padding: 24px;
    min-width: 320px;
    max-width: 90vw;
  }
  .modal-content h3 {
    margin: 0 0 8px 0;
    font-size: 1.25rem;
  }
  .modal-desc {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0 0 16px 0;
  }
  .input-address {
    width: 100%;
    padding: 10px 12px;
    font-family: monospace;
    font-size: 0.875rem;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    margin-bottom: 8px;
    box-sizing: border-box;
  }
  .input-error {
    font-size: 0.8rem;
    color: var(--danger, #e53e3e);
    margin: 0 0 12px 0;
  }
  .modal-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    margin-top: 16px;
  }
</style>
