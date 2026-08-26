<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { page } from '$app/state';
  import '../app.css';
  import Login from '../components/auth/Login.svelte';
  import UpdateGate from '../components/updater/UpdateGate.svelte';
  import { TooltipProvider } from '$lib/components/ui/tooltip/index.js';
  import { isAuthenticated, currentUser, checkSession } from '../stores/auth';
  import { resolveGateAtLaunch } from '../lib/updater/update-gate';
  import { DEFAULT_THEME, getStoredTheme, setTheme } from '../stores/theme';
  import { scheduleCommonsStartupPrefetch } from '../lib/commons/commons-prefetch';
  import { locale } from '../stores/locale';
  import { loadAppConfig } from '../stores/app-config';
  import { runDevAutologin } from '../lib/dev/autologin';
  import { createOnce, isDesignPath } from '$lib/ui/design-route';

  let { children }: { children: Snippet } = $props();

  const initialIsDesignRoute = isDesignPath(page.url.pathname);
  const isDesignRoute = $derived(isDesignPath(page.url.pathname));

  if (!initialIsDesignRoute) {
    // Before first paint, backend session state remains authoritative.
    isAuthenticated.set(false);
    currentUser.set(null);
  }

  $effect(() => {
    if ($locale) {
      document.documentElement.lang = $locale;
      document.documentElement.dir = 'ltr';
    }
  });

  const startProductionSession = createOnce(() => {
    // The storage-format probe must precede any account enumeration -
    // checkAuthStatus() (which drives check_any_account_exists ->
    // list_accounts) runs from Login.svelte's own mount, and UpdateGate's
    // wrapper is what keeps Login unmounted until the gate settles; this
    // call is what actually starts that settling.
    void resolveGateAtLaunch();
    // Confirm the backend session on every layout mount; drop auth state if locked.
    void checkSession();
    // Debug-only headless login for agent sandboxes; no-op without a configured
    // identity. Runs after the gate/session calls above so the storage-format
    // gate still settles first.
    void runDevAutologin();
    void loadAppConfig();
    scheduleCommonsStartupPrefetch();
  });

  onMount(() => {
    if (!initialIsDesignRoute) {
      setTheme(getStoredTheme() ?? DEFAULT_THEME);
      startProductionSession();
    }
  });

  // Start the session if the user leaves /design for a production route.
  $effect(() => {
    if (!isDesignPath(page.url.pathname)) {
      startProductionSession();
    }
  });
</script>

<TooltipProvider>
  {#if isDesignRoute}
    <div class="layout-root">
      {@render children()}
    </div>
  {:else}
    <UpdateGate>
      {#if $isAuthenticated && $currentUser}
        <div class="layout-root">
          {@render children()}
        </div>
      {:else}
        <Login />
      {/if}
    </UpdateGate>
  {/if}
</TooltipProvider>

<style>
  .layout-root {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
</style>
