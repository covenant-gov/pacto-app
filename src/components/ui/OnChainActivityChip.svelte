<script lang="ts">
  import { pendingOnChainJobs } from '../../stores/pending-on-chain';
  import { t } from 'svelte-i18n';

  let jobs = $derived($pendingOnChainJobs);
  let pendingCount = $derived(jobs.filter((j) => j.status === 'pending').length);
  let collapsed = $derived(jobs.length > 3);

  function statusLabel(status: 'pending' | 'confirmed' | 'failed', label: string): string {
    if (status === 'confirmed') return $t('wallet.onChain.confirmed', { values: { label } });
    if (status === 'failed') return $t('wallet.onChain.failed', { values: { label } });
    return $t('wallet.onChain.pending', { values: { label } });
  }

  function statusAria(status: 'pending' | 'confirmed' | 'failed', label: string): string {
    if (status === 'confirmed') return $t('wallet.onChain.confirmedAria', { values: { label } });
    if (status === 'failed') return $t('wallet.onChain.failedAria', { values: { label } });
    return $t('wallet.onChain.pendingAria', { values: { label } });
  }
</script>

{#if jobs.length > 0}
  <div class="onchain-chip-stack" role="status" aria-live="polite" aria-label={$t('wallet.onChain.regionAria')}>
    {#if collapsed && pendingCount > 1}
      <div class="onchain-chip pending" aria-label={$t('wallet.onChain.multiplePendingAria', { values: { count: pendingCount } })}>
        <span class="onchain-chip-spinner" aria-hidden="true"></span>
        <span class="onchain-chip-text">{$t('wallet.onChain.multiplePending', { values: { count: pendingCount } })}</span>
      </div>
    {:else}
      {#each jobs as job (job.id)}
        <div
          class="onchain-chip"
          class:pending={job.status === 'pending'}
          class:confirmed={job.status === 'confirmed'}
          class:failed={job.status === 'failed'}
          aria-label={statusAria(job.status, job.label)}
        >
          {#if job.status === 'pending'}
            <span class="onchain-chip-spinner" aria-hidden="true"></span>
          {:else if job.status === 'confirmed'}
            <span class="onchain-chip-mark" aria-hidden="true">✓</span>
          {:else}
            <span class="onchain-chip-mark failed" aria-hidden="true">!</span>
          {/if}
          <span class="onchain-chip-text">{statusLabel(job.status, job.label)}</span>
        </div>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .onchain-chip-stack {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 99999;
    display: flex;
    flex-direction: column-reverse;
    gap: 8px;
    pointer-events: auto;
    max-width: min(22rem, calc(100vw - 32px));
  }

  .onchain-chip {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    color: var(--text-primary);
    font-size: 0.8125rem;
    font-weight: 500;
    animation: onchain-chip-in 0.2s ease-out;
  }

  .onchain-chip.confirmed {
    border-color: color-mix(in srgb, var(--success) 45%, var(--border));
  }

  .onchain-chip.failed {
    border-color: color-mix(in srgb, var(--danger, #e53e3e) 55%, var(--border));
  }

  .onchain-chip-text {
    line-height: 1.35;
    min-width: 0;
  }

  .onchain-chip-spinner {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    border: 2px solid var(--border-subtle);
    border-top-color: var(--brand);
    border-radius: 50%;
    animation: onchain-chip-spin 0.7s linear infinite;
  }

  .onchain-chip-mark {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--success);
    font-size: 0.75rem;
    font-weight: 700;
  }

  .onchain-chip-mark.failed {
    color: var(--danger, #e53e3e);
  }

  @keyframes onchain-chip-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes onchain-chip-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
