<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.css';
  import Login from '../components/auth/Login.svelte';
  import { isAuthenticated, currentUser, clearStaleAuthSession } from '../stores/auth';
  import { DEFAULT_THEME, getStoredTheme, setTheme } from '../stores/theme';
  import { scheduleCommonsStartupPrefetch } from '../lib/commons/commons-prefetch';

  // Before first paint: drop auth state left over from a partial unlock or HMR.
  clearStaleAuthSession();

  onMount(() => {
    scheduleCommonsStartupPrefetch();
    const stored = getStoredTheme();
    setTheme(stored ?? DEFAULT_THEME);
  });
</script>

{#if $isAuthenticated && $currentUser}
  <div class="layout-root">
    <slot />
  </div>
{:else}
  <Login />
{/if}

<style>
  .layout-root {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
</style>
