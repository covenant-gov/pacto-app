<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.css';
  import Login from '../components/auth/Login.svelte';
  import { isAuthenticated, checkAuthStatus } from '../stores/auth';
  import { getStoredTheme, setTheme } from '../stores/theme';

  let loading = true;

  onMount(async () => {
    // Sync theme from localStorage so store matches (inline script already set data-theme to avoid flash)
    const stored = getStoredTheme();
    if (stored) setTheme(stored);

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

  .loading-screen {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100vh;
    background: var(--bg-page);
  }

  .spinner {
    width: 48px;
    height: 48px;
    border: 4px solid var(--border-subtle);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>