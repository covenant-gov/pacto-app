<script lang="ts">
  import { logout } from '../../stores/auth';
  import SettingsCollapsibleSection from './SettingsCollapsibleSection.svelte';

  let isLoggingOut = false;
  let showLogoutConfirm = false;

  function openLogoutConfirm() {
    showLogoutConfirm = true;
  }

  function closeLogoutConfirm() {
    if (!isLoggingOut) showLogoutConfirm = false;
  }

  async function handleLogout() {
    showLogoutConfirm = false;
    isLoggingOut = true;
    try {
      await logout();
    } catch (e) {
      console.error('Logout failed:', e);
    }
  }
</script>

<SettingsCollapsibleSection sectionId="settings-dangerzone" title="Dangerzone" sectionClass="settings-section--dangerzone">
  <p class="dangerzone-lead">
    Log out removes this account's data from this device (chats, keys, and MLS data). The app will restart.
  </p>
  <button
    type="button"
    class="btn-logout"
    on:click={openLogoutConfirm}
    disabled={isLoggingOut}
  >
    {isLoggingOut ? 'Logging out…' : 'Logout'}
  </button>
</SettingsCollapsibleSection>

{#if showLogoutConfirm}
  <div
    class="modal-overlay"
    on:click={closeLogoutConfirm}
    on:keydown={(e) => e.key === 'Escape' && closeLogoutConfirm()}
    role="button"
    tabindex="-1"
  >
    <div
      class="modal-content"
      on:click|stopPropagation
      on:keydown={(e) => e.key === 'Escape' && closeLogoutConfirm()}
      role="dialog"
      aria-modal="true"
      tabindex="0"
    >
      <h2>Logout</h2>
      <p class="modal-subtitle">
        Logout will remove this account's data from this device (chats, keys, and MLS data). The app will restart.
        You can create a new account or log in with a different key after that.
      </p>
      <div class="modal-actions">
        <button class="btn-cancel" on:click={closeLogoutConfirm} disabled={isLoggingOut}>Cancel</button>
        <button class="btn-confirm btn-logout-confirm" on:click={handleLogout} disabled={isLoggingOut}>
          {isLoggingOut ? 'Logging out…' : 'Logout'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dangerzone-lead {
    margin: 0 0 16px;
    color: var(--text-secondary);
    font-size: 0.9375rem;
    line-height: 1.45;
  }

  .btn-logout {
    width: 100%;
    max-width: 280px;
    height: 48px;
    background: transparent;
    color: var(--danger);
    border: 2px solid var(--danger);
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
    outline: none;
  }

  .btn-logout:hover:not(:disabled) {
    background: rgba(242, 63, 66, 0.1);
  }

  .btn-logout:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .modal-content {
    background: var(--bg-elevated);
    border-radius: 12px;
    padding: 32px;
    max-width: 560px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .modal-content h2 {
    color: var(--text-primary);
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0 0 8px;
  }

  .modal-subtitle {
    color: var(--text-muted);
    font-size: 0.9375rem;
    margin: 0 0 24px;
    line-height: 1.45;
  }

  .modal-actions {
    display: flex;
    gap: 12px;
    margin-top: 24px;
  }

  .btn-cancel,
  .btn-confirm {
    flex: 1;
    height: 48px;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    outline: none;
  }

  .btn-cancel {
    background: var(--bg-secondary);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }

  .btn-cancel:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .btn-logout-confirm {
    background: var(--danger);
    color: #fff;
  }

  .btn-logout-confirm:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .btn-cancel:disabled,
  .btn-logout-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
