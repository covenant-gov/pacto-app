<script lang="ts">
  export let onCreateAccount: () => void;
  export let onImportKeys: () => void;
</script>

<div class="welcome-container">
  <div class="welcome-content">
    <div class="welcome-header">
      <div class="logo-placeholder">
        <span class="logo-text">P</span>
      </div>
      <h1 class="app-title">Pacto</h1>
      <p class="app-subtitle">Private | Censorship-Resistant | Governable</p>
    </div>

    <div class="welcome-actions">
      <button class="btn-primary" on:click={onCreateAccount}>
        Create Account
      </button>
      <button class="btn-secondary" on:click={onImportKeys}>
        Import Existing Keys
      </button>
    </div>

    <p class="welcome-footer">
      Built on Nostr, EVM, & Aztec • End-to-End Encrypted
    </p>
  </div>
</div>

<style>
  .welcome-container {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100vh;
    background: var(--bg-page);
  }

  .welcome-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 48px;
    max-width: 400px;
    padding: 32px;
  }

  .welcome-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .logo-placeholder {
    width: 96px;
    height: 96px;
    background: var(--accent);
    border-radius: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 8px 24px rgba(88, 101, 242, 0.3);
  }

  .logo-text {
    color: #ffffff;
    font-size: 3rem;
    font-weight: 700;
  }

  .app-title {
    color: var(--text-primary);
    font-size: 2.5rem;
    font-weight: 700;
    margin: 0;
  }

  .app-subtitle {
    color: var(--text-muted);
    font-size: 1rem;
    margin: 0;
    text-align: center;
  }

  .welcome-actions {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
  }

  .btn-primary, .btn-secondary {
    width: 100%;
    height: 48px;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    outline: none;
  }

  .btn-primary {
    background: var(--accent);
    color: #ffffff;
  }

  .btn-primary:hover {
    background: var(--accent-hover);
    box-shadow: 0 4px 12px rgba(88, 101, 242, 0.4);
  }

  .btn-primary:active {
    transform: translateY(1px);
  }

  .btn-secondary {
    background: transparent;
    color: var(--text-muted);
    border: 2px solid var(--border);
  }

  .btn-secondary:hover {
    background: var(--border-subtle);
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .btn-secondary:active {
    transform: translateY(1px);
  }

  .welcome-footer {
    color: var(--text-muted);
    font-size: 0.75rem;
    margin: 0;
    text-align: center;
  }
</style>

