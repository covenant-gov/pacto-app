<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { RpcReadErrorKind } from '../../../lib/squad/rpc-read-error';
  import { focusSquadStatusRpcEditor } from '../../../stores/navigation';

  let { kind }: { kind: RpcReadErrorKind } = $props();

  const titleKey = $derived(
    kind === 'rate_limited'
      ? 'governance.rpcError.rateLimited.title'
      : 'governance.rpcError.unreachable.title',
  );
  const bodyKey = $derived(
    kind === 'rate_limited'
      ? 'governance.rpcError.rateLimited.body'
      : 'governance.rpcError.unreachable.body',
  );
</script>

<div class="rpc-read-error-card" role="alert">
  <p class="rpc-read-error-title">{$t(titleKey)}</p>
  <p class="rpc-read-error-body">{$t(bodyKey)}</p>
  <button type="button" class="btn-primary" onclick={focusSquadStatusRpcEditor}>
    {$t('squad.rpc.addCustom')}
  </button>
</div>

<style>
  .rpc-read-error-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 14px 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--danger);
    border-radius: 8px;
    max-width: 520px;
  }

  .rpc-read-error-title {
    margin: 0;
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--danger);
  }

  .rpc-read-error-body {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }
</style>
