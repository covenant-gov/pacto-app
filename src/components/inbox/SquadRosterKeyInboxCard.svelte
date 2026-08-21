<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import { bindDefaultSquadSigner, bindNewSquadKey } from '../../lib/squad/squad-roster-binding';
  import {
    clearDeferredSquadRosterKeyChoice,
    deferSquadRosterKeyChoice,
  } from '../../lib/squad/squad-roster-key-choice';
  import { setPersonalAlertNeeded } from '../../stores/squad-hub-alerts';
  import { showToast } from '../../stores/toast';

  let {
    parentId,
    announcementsGroupId,
    onComplete = () => {},
  }: {
    parentId: string;
    announcementsGroupId: string;
    onComplete?: () => void;
  } = $props();

  let busy: 'default' | 'new' | null = $state(null);

  async function useDefault(): Promise<void> {
    if (busy) return;
    busy = 'default';
    const tFn = get(t);
    try {
      const ok = await bindDefaultSquadSigner(announcementsGroupId);
      if (!ok) {
        showToast(tFn('messaging.squadRosterKey.defaultError'));
        return;
      }
      clearDeferredSquadRosterKeyChoice(parentId);
      setPersonalAlertNeeded(parentId, false);
      showToast(tFn('messaging.squadRosterKey.defaultSuccess'));
      onComplete();
    } finally {
      busy = null;
    }
  }

  async function useNewKey(): Promise<void> {
    if (busy) return;
    busy = 'new';
    const tFn = get(t);
    try {
      const ok = await bindNewSquadKey(announcementsGroupId);
      if (!ok) {
        showToast(tFn('messaging.squadRosterKey.newError'));
        return;
      }
      clearDeferredSquadRosterKeyChoice(parentId);
      setPersonalAlertNeeded(parentId, false);
      showToast(tFn('messaging.squadRosterKey.newSuccess'));
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

<div class="roster-key-card" role="region" aria-label={$t('messaging.squadRosterKey.ariaLabel')}>
  <p class="roster-key-title">{$t('messaging.squadRosterKey.title')}</p>
  <p class="roster-key-desc">
    {$t('messaging.squadRosterKey.description')}
  </p>
  <div class="roster-key-actions">
    <button type="button" class="btn-primary" disabled={!!busy} onclick={() => void useDefault()}>
      {busy === 'default' ? $t('messaging.squadRosterKey.useDefaultBusy') : $t('messaging.squadRosterKey.useDefault')}
    </button>
    <button type="button" class="btn-secondary" disabled={!!busy} onclick={() => void useNewKey()}>
      {busy === 'new' ? $t('messaging.squadRosterKey.useNewBusy') : $t('messaging.squadRosterKey.useNew')}
    </button>
    <button type="button" class="btn-link" disabled={!!busy} onclick={defer}>{$t('messaging.squadRosterKey.defer')}</button>
  </div>
</div>

<style>
  .roster-key-card {
    margin: 8px 16px;
    padding: 14px 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-left: 3px solid var(--brand);
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
    background: var(--brand);
    color: var(--on-brand);
    border: none;
  }

  .btn-primary:disabled,
  .btn-secondary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: var(--bg-elevated);
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
