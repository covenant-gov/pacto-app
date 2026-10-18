<script lang="ts">
  import { t } from 'svelte-i18n';
  import { openExternalUrl } from '../../lib/utils/open-external';
  import './auth-step.css';

  const GITHUB_REPO_URL = 'https://github.com/covenant-gov/pacto-app';

  let { onCreateAccount, onImportKeys }: { onCreateAccount: () => void; onImportKeys: () => void } = $props();

  function openGithub(): void {
    void openExternalUrl(GITHUB_REPO_URL);
  }
</script>

<div class="welcome-container">
  <div class="welcome-content auth-step-column">
    <div class="welcome-header">
      <div class="logo-lockup">
        <span class="logo" aria-hidden="true"></span>
        <h1 class="logo-text">
          <!-- eslint-disable-next-line @intlify/svelte/no-raw-text -- brand name for screen readers -->
          <span class="sr-only">Pacto</span>
        </h1>
      </div>
      <p class="app-subtitle">{$t('auth.welcomeSubtitle')}</p>
    </div>

    <div class="welcome-cta">
      <div class="welcome-actions w-full max-w-80">
        <button type="button" class="btn-primary" onclick={onCreateAccount}>
          {$t('auth.createAccount')}
        </button>
        <button type="button" class="btn-secondary" onclick={onImportKeys}>
          {$t('auth.importWithRecoveryPhrase')}
        </button>
      </div>

      <a
        class="open-source-badge"
        href={GITHUB_REPO_URL}
        onclick={(e) => {
          e.preventDefault();
          openGithub();
        }}
      >
        <svg class="open-source-badge-mark" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"
          />
        </svg>
        {$t('auth.openSourceBadge')}
      </a>

      <p class="welcome-footer">
        {$t('auth.welcomeFooter')}
      </p>
    </div>
  </div>
</div>

<style>
  .welcome-container {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }

  .welcome-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 40px;
    transform: translateY(-4vh);
  }

  .welcome-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .logo-lockup {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
  }

  .logo {
    display: block;
    width: 148px;
    height: 148px;
    background-color: var(--text-primary);
    -webkit-mask: url('/symbol-pacto.svg') center / contain no-repeat;
    mask: url('/symbol-pacto.svg') center / contain no-repeat;
  }

  .logo-text {
    display: block;
    width: min(168px, 85%);
    aspect-ratio: 419 / 100;
    margin: -22px 0 0;
    background-color: var(--text-primary);
    -webkit-mask: url('/logo-text.svg') center / contain no-repeat;
    mask: url('/logo-text.svg') center / contain no-repeat;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .app-subtitle {
    color: var(--text-secondary);
    font-size: 1rem;
    margin: 0;
    text-align: center;
    white-space: pre-line;
    max-width: none;
  }

  .welcome-cta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    width: 100%;
  }

  .open-source-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid var(--border-subtle);
    background: transparent;
    color: var(--text-muted);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-decoration: none;
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      color 150ms ease;
  }

  .open-source-badge:hover {
    border-color: color-mix(in srgb, var(--text-primary) 18%, var(--border-subtle));
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .open-source-badge:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  .open-source-badge-mark {
    flex-shrink: 0;
  }

  .welcome-actions {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .btn-primary,
  .btn-secondary {
    width: 100%;
    height: auto;
    min-height: 2.5rem; /* h-10 — between mobile 48px and shadcn h-9 */
    border-radius: 8px;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      color 150ms ease,
      transform 150ms ease;
    outline: none;
  }

  .btn-primary:focus-visible,
  .btn-secondary:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  .btn-primary {
    border: none;
    background: var(--brand);
    color: var(--on-brand);
  }

  .btn-primary:hover {
    background: var(--brand-hover);
    box-shadow: 0 4px 12px color-mix(in srgb, var(--brand) 40%, transparent);
  }

  .btn-primary:active {
    transform: scale(0.96);
  }

  /* Returning user — quieter than Create (Family: Create new vs Add existing) */
  .btn-secondary {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    font-weight: 500;
    box-shadow: none;
  }

  .btn-secondary:hover {
    background: var(--bg-hover);
    border-color: color-mix(in srgb, var(--text-primary) 16%, var(--border-subtle));
    color: var(--text-primary);
  }

  .btn-secondary:active {
    transform: scale(0.96);
  }

  .welcome-footer {
    color: var(--text-muted);
    font-size: 0.75rem;
    margin: 0;
    text-align: center;
  }
</style>

