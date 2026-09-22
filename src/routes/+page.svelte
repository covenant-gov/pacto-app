<script lang="ts">
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { t } from 'svelte-i18n';
  import { loadAuthenticatedApp } from '../lib/app/authenticated-app';
</script>

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
{/await}

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
</style>
