<script lang="ts">
  import { bindDefaultSquadSigner, bindNewSquadKey } from '../../lib/squad/squad-roster-binding';
  import {
    clearDeferredSquadRosterKeyChoice,
    deferSquadRosterKeyChoice,
  } from '../../lib/squad/squad-roster-key-choice';
  import { setPersonalAlertNeeded } from '../../stores/squad-hub-alerts';
  import { showToast } from '../../stores/toast';

  export let parentId: string;
  export let announcementsGroupId: string;
  export let onComplete: () => void = () => {};

  let busy: 'default' | 'new' | null = null;

  async function useDefault(): Promise<void> {
    if (busy) return;
    busy = 'default';
    try {
      const ok = await bindDefaultSquadSigner(announcementsGroupId);
      if (!ok) {
        showToast('Could not bind default squad signer. Check Settings → Default wallet config.');
        return;
      }
      clearDeferredSquadRosterKeyChoice(parentId);
      setPersonalAlertNeeded(parentId, false);
      showToast('Squad roster signer set (default account).');
      onComplete();
    } finally {
      busy = null;
    }
  }

  async function useNewKey(): Promise<void> {
    if (busy) return;
    busy = 'new';
    try {
      const ok = await bindNewSquadKey(announcementsGroupId);
      if (!ok) {
        showToast('Could not create a squad key for this group.');
        return;
      }
      clearDeferredSquadRosterKeyChoice(parentId);
      setPersonalAlertNeeded(parentId, false);
      showToast('New squad key created for this group. Your DM wallet signer is unchanged.');
      onComplete();
    } finally {
      busy = null;
    }
  }

  function defer(): void {
    deferSquadRosterKeyChoice(parentId);
    setPersonalAlertNeeded(parentId, false);
    onComplete();
  }
</script>

<div class="roster-key-card" role="region" aria-label="Squad roster signer setup">
  <p class="roster-key-title">Set your squad roster signer</p>
  <p class="roster-key-desc">
    Choose which squad-purpose EVM address members see for this group. This does not change your DM
    wallet signer unless you pick the default account.
  </p>
  <div class="roster-key-actions">
    <button type="button" class="btn-primary" disabled={!!busy} on:click={() => void useDefault()}>
      {busy === 'default' ? 'Setting…' : 'Use default squad signer'}
    </button>
    <button type="button" class="btn-secondary" disabled={!!busy} on:click={() => void useNewKey()}>
      {busy === 'new' ? 'Creating…' : 'Generate new key for this squad'}
    </button>
    <button type="button" class="btn-link" disabled={!!busy} on:click={defer}>Defer</button>
  </div>
</div>

<style>
  .roster-key-card {
    margin: 8px 16px;
    padding: 14px 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 8px;
    max-width: 520px;
  }

  .roster-key-title {
    margin: 0 0 6px 0;
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--text-primary);
  }

  .roster-key-desc {
    margin: 0 0 12px 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }

  .roster-key-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .btn-primary,
  .btn-secondary {
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--accent-contrast, #fff);
    border: none;
  }

  .btn-primary:disabled,
  .btn-secondary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: var(--bg-secondary);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }

  .btn-link {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    cursor: pointer;
    text-decoration: underline;
    padding: 4px 8px;
  }

  .btn-link:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
