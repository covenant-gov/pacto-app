<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.css';
  import Login from '../components/auth/Login.svelte';
  import UpdateGate from '../components/updater/UpdateGate.svelte';
  import { isAuthenticated, currentUser, checkSession } from '../stores/auth';
  import { DEFAULT_THEME, getStoredTheme, setTheme } from '../stores/theme';
  import { scheduleCommonsStartupPrefetch } from '../lib/commons/commons-prefetch';
  import { locale } from '../stores/locale';
  import { loadAppConfig } from '../stores/app-config';

  // Before first paint: clear any leftover auth state. The backend session check on mount
  // is the authoritative source of truth, so never assume the session is still valid.
  isAuthenticated.set(false);
  currentUser.set(null);

  $: if ($locale) {
    document.documentElement.lang = $locale;
    document.documentElement.dir = 'ltr';
  }

  onMount(() => {
    // Confirm the backend session on every layout mount; drop auth state if locked.
    void checkSession();
    void loadAppConfig();
    scheduleCommonsStartupPrefetch();
    const stored = getStoredTheme();
    setTheme(stored ?? DEFAULT_THEME);
  });
</script>

<UpdateGate>
  {#if $isAuthenticated && $currentUser}
    <div class="layout-root">
      <slot />
    </div>
  {:else}
    <Login />
  {/if}
</UpdateGate>

<style>
  .layout-root {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
</style>
