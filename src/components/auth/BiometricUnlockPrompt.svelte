<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import { unlockWithBiometrics } from '../../stores/auth';
  import { biometricUnlockEnabled } from '../../stores/biometric-unlock';
  import { mapBiometricErrorToI18nKey } from '../../lib/api/biometry';

  let {
    npub,
    label,
    onUsePinInstead,
  }: {
    npub: string;
    label: 'touchId' | 'windowsHello' | 'generic';
    onUsePinInstead: () => void;
  } = $props();

  let isAuthenticating = $state(false);
  let errorKey: string | null = $state(null);
  let buttonEl: HTMLButtonElement | undefined = $state();
  // Set once the auth store proves the stored key no longer decrypts and revokes the
  // enrollment. A cancelled or unavailable OS prompt never sets this, so the button stays
  // up and the user can simply retry.
  let revoked = $state(false);

  $effect(() => {
    buttonEl?.focus();
  });

  let buttonLabelKey = $derived(
    label === 'touchId'
      ? 'auth.biometricUnlockTouchId'
      : label === 'windowsHello'
        ? 'auth.biometricUnlockWindowsHello'
        : 'auth.biometricUnlockGeneric'
  );

  async function handleUnlock(): Promise<void> {
    isAuthenticating = true;
    errorKey = null;
    try {
      await unlockWithBiometrics(npub);
    } catch (e) {
      errorKey = mapBiometricErrorToI18nKey(e);
      if (!get(biometricUnlockEnabled)) {
        revoked = true;
      }
    } finally {
      isAuthenticating = false;
    }
  }
</script>

<div class="biometric-prompt-container">
  <h3 class="pin-title">{$t('auth.biometricUnlockHeading')}</h3>

  {#if errorKey}
    <div class="pin-error" role="alert">{$t(errorKey)}</div>
  {/if}

  {#if !revoked}
    <button type="button" class="btn-biometric" onclick={handleUnlock} disabled={isAuthenticating} bind:this={buttonEl}>
      {$t(buttonLabelKey)}
    </button>
  {/if}

  {#if isAuthenticating}
    <div class="pin-processing" role="status">
      <div class="spinner" aria-hidden="true"></div>
      <p>{$t('auth.processing')}</p>
    </div>
  {/if}

  <button type="button" class="btn-back" onclick={onUsePinInstead}>
    {$t('auth.usePinInstead')}
  </button>
</div>

<style>
  .biometric-prompt-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    padding: 32px;
  }

  .pin-title {
    color: var(--text-primary, #f2f5f9);
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
    text-align: center;
  }

  .pin-error {
    color: var(--danger, #f472b6);
    font-size: 0.875rem;
    background: rgba(242, 63, 66, 0.1);
    padding: 8px 16px;
    border-radius: 8px;
  }

  .btn-biometric {
    padding: 12px 24px;
    background: var(--brand, #22d3ee);
    color: var(--bg-page, #1c1c1c);
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
    outline: none;
  }

  .btn-biometric:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .pin-processing {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: var(--text-muted, #8b96a8);
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border-subtle, #343c4c);
    border-top-color: var(--brand, #22d3ee);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .pin-processing p {
    margin: 0;
    font-size: 0.875rem;
  }

  .btn-back {
    padding: 12px 24px;
    background: transparent;
    color: var(--text-muted, #8b96a8);
    border: 2px solid var(--border, #455061);
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    outline: none;
  }

  .btn-back:hover {
    background: var(--border-subtle, #343c4c);
    border-color: var(--brand, #22d3ee);
    color: var(--text-primary, #f2f5f9);
  }
</style>
