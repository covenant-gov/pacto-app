<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import WelcomeScreen from './WelcomeScreen.svelte';
  import KeyImport from './KeyImport.svelte';
  import PinInput from './PinInput.svelte';
  import PinSuccess from './PinSuccess.svelte';
  import BiometricUnlockPrompt from './BiometricUnlockPrompt.svelte';
  import AuthAtmosphere from './AuthAtmosphere.svelte';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { authLoading, authError, isAuthenticated, currentUser, type CurrentUser } from '../../stores/auth-session';
  import { checkAuthStatus, createAccount, importAccount, unlockWithPin, clearAuthError, checkSession, revealAuthenticatedSession } from '../../stores/auth';
  import { prefetchAuthenticatedApp } from '../../lib/app/authenticated-app';
  import { appConfig } from '../../stores/app-config';
  import { validateRecoveryPhraseForImport } from '../../lib/api/encryption';
  import { getCurrentAccount } from '../../lib/api/auth';
  import { canOfferBiometricUnlock } from '../../stores/biometric-unlock';
  import { backupVerificationModalOpen } from '../../stores/backup-verification';
  import { prefersReducedMotion } from 'svelte/motion';

  type AuthStep = 'checking' | 'welcome' | 'import' | 'pin-create' | 'pin-confirm' | 'pin-success' | 'pin-unlock';

  const SUCCESS_BEAT_MS = 1100;

  let currentStep: AuthStep = $state('checking');
  let privateKey: string = $state('');
  let firstPin: string = $state('');
  let error: string | null = $state(null);
  let unlockInFlight = $state(false);
  let biometricNpub: string | null = $state(null);
  let biometricLabel: 'touchId' | 'windowsHello' | 'generic' = $state('generic');
  let showBiometricPrompt = $state(false);
  let successKind: 'create' | 'import' = $state('create');

  let pinDigitCount = $derived($appConfig.pinDigitCount);

  function holdSuccessBeat(ms = SUCCESS_BEAT_MS): Promise<void> {
    const wait = prefersReducedMotion.current ? 0 : ms;
    if (wait <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      setTimeout(resolve, wait);
    });
  }

  async function finishWithSuccessBeat(
    session: CurrentUser,
    kind: 'create' | 'import'
  ): Promise<void> {
    successKind = kind;
    currentStep = 'pin-success';
    prefetchAuthenticatedApp();
    await holdSuccessBeat();
    revealAuthenticatedSession(session);
    if (kind === 'create') {
      backupVerificationModalOpen.set(true);
    }
  }

  // Check if user has stored encrypted key on mount, and confirm backend session state.
  onMount(async () => {
    try {
      const status = await checkAuthStatus();
      const session = await checkSession();
      if (status === 'needs-pin' && session.unlocked && get(currentUser)) {
        // Backend session is alive and we already have user state (e.g. HMR). Stay authenticated.
        isAuthenticated.set(true);
      }
      currentStep = status === 'needs-pin' ? 'pin-unlock' : 'welcome';

      if (status === 'needs-pin') {
        // Never block the PIN path on this probe; default to PIN on any failure.
        try {
          const npub = await getCurrentAccount();
          const availability = await canOfferBiometricUnlock(npub);
          biometricNpub = npub;
          biometricLabel = availability.label;
          showBiometricPrompt = availability.available;
        } catch {
          showBiometricPrompt = false;
        }
      }
    } catch {
      currentStep = 'welcome';
    }
  });

  // Subscribe to auth store errors
  authError.subscribe(err => {
    if (err) error = err;
  });

  // --- Welcome Screen Actions ---
  function handleCreateAccount() {
    currentStep = 'pin-create';
    privateKey = ''; // Will be generated in final step
    error = null;
    clearAuthError();
  }

  function handleImportKeys() {
    currentStep = 'import';
    error = null;
    clearAuthError();
  }

  // --- Key Import Actions ---
  function handleKeyImported(key: string) {
    if (!validateRecoveryPhraseForImport(key)) {
      error = get(t)('auth.errorInvalidRecoveryPhrase');
      return;
    }

    privateKey = key;
    currentStep = 'pin-create';
    error = null;
  }

  function handleImportBack() {
    currentStep = 'welcome';
    error = null;
    privateKey = '';
    clearAuthError();
  }

  // --- PIN Flow Actions ---
  function handlePinCreate(pin: string) {
    firstPin = pin;
    currentStep = 'pin-confirm';
    error = null;
  }

  async function handlePinConfirm(pin: string) {
    if (pin !== firstPin) {
      // Stay on retype — clear only this attempt; first PIN still stands.
      error = get(t)('auth.errorPinsDontMatch');
      return;
    }

    try {
      if (privateKey) {
        const session = await importAccount(privateKey, pin, { deferReveal: true });
        if (!session) return;
        await finishWithSuccessBeat(session, 'import');
      } else {
        const session = await createAccount(pin, { deferReveal: true });
        if (!session) return;
        await finishWithSuccessBeat(session, 'create');
      }
    } catch (e) {
      error = e instanceof Error ? e.message : get(t)('auth.errorCreateAccountFailed');
      currentStep = 'pin-create';
      firstPin = '';
    }
  }

  async function handlePinUnlock(pin: string) {
    if (unlockInFlight || $authLoading) return;
    unlockInFlight = true;
    try {
      prefetchAuthenticatedApp();
      await unlockWithPin(pin);
      // On success, auth store will handle state and user will see app
    } catch (e) {
      error = e instanceof Error ? e.message : get(t)('auth.errorIncorrectPin');
      // Stay on unlock screen for retry
    } finally {
      unlockInFlight = false;
    }
  }

  // Back handlers for PIN screens
  function handlePinCreateBack() {
    if (privateKey) {
      // If importing, go back to import screen
      currentStep = 'import';
      privateKey = '';
    } else {
      // If creating new account, go back to welcome
      currentStep = 'welcome';
    }
    firstPin = '';
    error = null;
    clearAuthError();
  }

  function handlePinConfirmBack() {
    currentStep = 'pin-create';
    firstPin = '';
    error = null;
    clearAuthError();
  }

</script>

<AuthAtmosphere>
<div class="login-container">
  {#if currentStep === 'checking'}
    <div class="auth-stage gap-4" role="status" aria-live="polite">
      <LoaderCircle class="size-12 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
      <p class="m-0 text-[0.9375rem] text-muted-foreground">{$t('auth.checkingAccount')}</p>
    </div>
  {:else if currentStep === 'welcome'}
    <WelcomeScreen
      onCreateAccount={handleCreateAccount}
      onImportKeys={handleImportKeys}
    />
  {:else if currentStep === 'import'}
    <KeyImport
      onImport={handleKeyImported}
      onBack={handleImportBack}
      isValidating={$authLoading}
      {error}
    />
  {:else if currentStep === 'pin-create'}
    <div class="auth-stage">
      <PinInput
        title={$t('auth.pinCreateTitle')}
        onComplete={handlePinCreate}
        onErrorClear={() => { error = null; clearAuthError(); }}
        onBack={handlePinCreateBack}
        isProcessing={$authLoading}
        {pinDigitCount}
        {error}
      />
    </div>
  {:else if currentStep === 'pin-confirm'}
    <div class="auth-stage">
      <PinInput
        title={$t('auth.pinConfirmTitle')}
        onComplete={handlePinConfirm}
        onErrorClear={() => { error = null; clearAuthError(); }}
        onBack={handlePinConfirmBack}
        isProcessing={$authLoading}
        {pinDigitCount}
        {error}
      />
    </div>
  {:else if currentStep === 'pin-success'}
    <div class="auth-stage">
      <PinSuccess
        title={$t('auth.pinSuccessTitle')}
        subtitle={$t(
          successKind === 'import' ? 'auth.pinSuccessImportSubtitle' : 'auth.pinSuccessSubtitle'
        )}
      />
    </div>
  {:else if currentStep === 'pin-unlock'}
    <div class="auth-stage">
      {#if showBiometricPrompt && biometricNpub}
        <BiometricUnlockPrompt
          npub={biometricNpub}
          label={biometricLabel}
          onUsePinInstead={() => { showBiometricPrompt = false; error = null; clearAuthError(); }}
        />
      {:else}
        <PinInput
          title={$t('auth.pinEnterTitle')}
          onComplete={handlePinUnlock}
          onErrorClear={() => { error = null; clearAuthError(); }}
          isProcessing={$authLoading}
          {pinDigitCount}
          {error}
        />
      {/if}
    </div>
  {/if}
</div>
</AuthAtmosphere>

<style>
  .login-container {
    width: 100%;
    height: 100%;
  }

  .auth-stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }
</style>

