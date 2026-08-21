<script lang="ts">
  import { logout } from '../../stores/auth';
  import { showToast } from '../../stores/toast';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { portal } from '../../lib/utils/portal';
  import { t } from 'svelte-i18n';
  import SettingsCollapsibleSection from './SettingsCollapsibleSection.svelte';

  let isLoggingOut = $state(false);
  let showLogoutConfirm = $state(false);

  function openLogoutConfirm() {
    showLogoutConfirm = true;
  }

  function closeLogoutConfirm() {
    if (!isLoggingOut) showLogoutConfirm = false;
  }

  async function handleLogout() {
    isLoggingOut = true;
    try {
      await logout();
      showLogoutConfirm = false;
    } catch (e) {
      console.error('Logout failed:', e);
      showToast(getInvokeErrorMessage(e, $t('settings.toast.couldNotLogoutFallback')));
    } finally {
      isLoggingOut = false;
    }
  }
</script>

<SettingsCollapsibleSection
  sectionId="settings-dangerzone"
  title={$t('settings.dangerZoneTitle')}
  sectionClass="settings-section--dangerzone"
>
  <p class="dangerzone-lead">
    {$t('settings.dangerZoneLead')}
  </p>
  <button
    type="button"
    class="btn-logout"
    onclick={openLogoutConfirm}
    disabled={isLoggingOut}
  >
    {isLoggingOut ? $t('settings.loggingOut') : $t('settings.logout')}
  </button>
</SettingsCollapsibleSection>

{#if showLogoutConfirm}
  <div use:portal>
    <div
      class="modal-overlay"
      onclick={closeLogoutConfirm}
      onkeydown={(e) => e.key === 'Escape' && closeLogoutConfirm()}
      role="presentation"
    >
      <div
        class="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-modal-title"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.key === 'Escape' && closeLogoutConfirm()}
      >
        <h2 id="logout-modal-title">{$t('settings.logoutModalTitle')}</h2>
        <p class="modal-subtitle">
          {$t('settings.logoutModalSubtitle')}
        </p>
        <div class="modal-actions">
          <button type="button" class="btn-cancel" onclick={closeLogoutConfirm} disabled={isLoggingOut}>
            {$t('settings.cancel')}
          </button>
          <button type="button" class="btn-confirm btn-logout-confirm" onclick={handleLogout} disabled={isLoggingOut}>
            {isLoggingOut ? $t('settings.loggingOut') : $t('settings.logout')}
          </button>
        </div>
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
    font-family: inherit;
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
    z-index: 10000;
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
    outline: none;
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
    font-family: inherit;
    cursor: pointer;
    outline: none;
  }

  .btn-cancel {
    background: var(--bg-elevated);
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
