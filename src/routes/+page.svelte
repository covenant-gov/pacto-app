<script lang="ts">
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { t } from 'svelte-i18n';
  import { loadAuthenticatedApp } from '../lib/app/authenticated-app';

  let shellLoadAttempt = 0;

  function retryShellLoad(): void {
    shellLoadAttempt += 1;
  }
</script>

{#key shellLoadAttempt}
  {#await loadAuthenticatedApp()}
    <div class="auth-shell-loading" role="status" aria-live="polite">
      <LoaderCircle
        class="size-12 animate-spin text-primary motion-reduce:animate-none"
        aria-hidden="true"
      />
      <p class="m-0 text-[0.9375rem] text-muted-foreground">{$t('auth.checkingAccount')}</p>
    </div>
  {:then App}
    <App />
  {:catch}
    <div class="auth-shell-loading" role="alert">
      <p class="m-0 text-[0.9375rem] text-foreground">{$t('auth.shellLoadError')}</p>
      <button type="button" class="shell-load-retry" on:click={retryShellLoad}>
        {$t('auth.shellLoadRetry')}
      </button>
    </div>
  {/await}
{/key}

<style>
  .auth-shell-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    width: 100%;
    height: 100%;
    min-height: 100vh;
    background: var(--bg-page);
  }

  .shell-load-retry {
    min-height: 2.75rem;
    padding: 0 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elevated);
    color: var(--foreground);
    font: inherit;
    cursor: pointer;
  }

  .shell-load-retry:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
</style>
