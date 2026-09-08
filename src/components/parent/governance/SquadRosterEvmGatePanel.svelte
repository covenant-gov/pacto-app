<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import { bindDefaultSquadSigner, bindNewSquadKey } from '../../../lib/squad/squad-roster-binding';
  import { showToast } from '../../../stores/toast';

  let {
    rosterLookupId,
    onBound = () => {},
  }: {
    rosterLookupId: string;
    onBound?: () => void;
  } = $props();

  let busy: 'default' | 'new' | null = $state(null);

  async function useDefault(): Promise<void> {
    if (busy) return;
    busy = 'default';
    const tFn = get(t);
    try {
      const ok = await bindDefaultSquadSigner(rosterLookupId);
      if (!ok) {
        showToast(tFn('governance.deployGate.defaultError'), undefined, undefined, { error: true });
        return;
      }
      showToast(tFn('governance.deployGate.defaultSuccess'));
      onBound();
    } finally {
      busy = null;
    }
  }

  async function useNewKey(): Promise<void> {
    if (busy) return;
    busy = 'new';
    const tFn = get(t);
    try {
      const ok = await bindNewSquadKey(rosterLookupId);
      if (!ok) {
        showToast(tFn('governance.deployGate.newError'), undefined, undefined, { error: true });
        return;
      }
      showToast(tFn('governance.deployGate.newSuccess'));
      onBound();
    } finally {
      busy = null;
    }
  }
</script>

<div class="deploy-gate" role="alert">
  <p class="deploy-gate-title">{$t('governance.deployGate.title')}</p>
  <p class="deploy-gate-desc">{$t('governance.deployGate.description')}</p>
  <div class="deploy-gate-actions">
    <button type="button" class="btn-primary" disabled={!!busy} onclick={() => void useDefault()}>
      {busy === 'default'
        ? $t('governance.deployGate.useDefaultBusy')
        : $t('governance.deployGate.useDefault')}
    </button>
    <button type="button" class="btn-secondary" disabled={!!busy} onclick={() => void useNewKey()}>
      {busy === 'new' ? $t('governance.deployGate.useNewBusy') : $t('governance.deployGate.useNew')}
    </button>
  </div>
</div>

<style>
  .deploy-gate {
    margin: 0 0 16px;
    padding: 14px 16px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--brand);
    background: var(--bg-elevated, var(--bg-panel));
  }

  .deploy-gate-title {
    margin: 0 0 6px;
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--text-primary);
  }

  .deploy-gate-desc {
    margin: 0 0 12px;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }

  .deploy-gate-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
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
    background: var(--bg-elevated, var(--bg-panel));
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }
</style>
