<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.css';
  import Login from '../components/auth/Login.svelte';
  import { isAuthenticated, checkAuthStatus } from '../stores/auth';
  import { DEFAULT_THEME, getStoredTheme, setTheme } from '../stores/theme';

  let loading = true;

  onMount(async () => {
    // Sync theme from localStorage so store matches (inline script already set data-theme to avoid flash)
    const stored = getStoredTheme();
    setTheme(stored ?? DEFAULT_THEME);

    await checkAuthStatus();
    loading = false;
  });
</script>

{#if loading}
  <div class="loading-screen">
    <div class="spinner"></div>
  </div>
{:else if $isAuthenticated}
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