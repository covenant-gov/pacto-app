<script lang="ts">
  import { onMount } from 'svelte';
  import WelcomeScreen from './WelcomeScreen.svelte';
  import KeyImport from './KeyImport.svelte';
  import PinInput from './PinInput.svelte';
  import { checkAuthStatus, createAccount, importAccount, unlockWithPin, authLoading, authError, clearAuthError } from '../../stores/auth';
  import { validateRecoveryPhraseForImport } from '../../lib/api/encryption';

  type AuthStep = 'checking' | 'welcome' | 'import' | 'pin-create' | 'pin-confirm' | 'pin-unlock';

  let currentStep: AuthStep = 'checking';
  let privateKey: string = '';
  let firstPin: string = '';
  let error: string | null = null;
  let unlockInFlight = false;

  // Check if user has stored encrypted key on mount
  onMount(async () => {
    try {
      const status = await checkAuthStatus();
      currentStep = status === 'needs-pin' ? 'pin-unlock' : 'welcome';
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
      error = 'Enter a valid 12- or 24-word recovery phrase';
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
      error = "PINs don't match";
      currentStep = 'pin-create';
      firstPin = '';
      return;
    }

    try {
      if (privateKey) {
        // Import existing key
        await importAccount(privateKey, pin);
      } else {
        // Create new account
        await createAccount(pin);
      }
      // On success, auth store will handle state and user will see app
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create account';
      currentStep = 'pin-create';
      firstPin = '';
    }
  }

  async function handlePinUnlock(pin: string) {
    if (unlockInFlight || $authLoading) return;
    unlockInFlight = true;
    try {
      await unlockWithPin(pin);
      // On success, auth store will handle state and user will see app
    } catch (e) {
      error = e instanceof Error ? e.message : 'Incorrect PIN';
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

<div class="login-container">
  {#if currentStep === 'checking'}
    <div class="checking-screen" role="status" aria-live="polite">
      <div class="checking-spinner"></div>
      <p class="checking-text">Checking your account…</p>
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
    <div class="pin-screen">
      <PinInput
        title="Create your PIN"
        onComplete={handlePinCreate}
        onErrorClear={() => { error = null; clearAuthError(); }}
        onBack={handlePinCreateBack}
        isProcessing={$authLoading}
        {error}
      />
    </div>
  {:else if currentStep === 'pin-confirm'}
    <div class="pin-screen">
      <PinInput
        title="Confirm your PIN"
        onComplete={handlePinConfirm}
        onErrorClear={() => { error = null; clearAuthError(); }}
        onBack={handlePinConfirmBack}
        isProcessing={$authLoading}
        {error}
      />
    </div>
  {:else if currentStep === 'pin-unlock'}
    <div class="pin-screen">
      <PinInput
        title="Enter your PIN"
        onComplete={handlePinUnlock}
        onErrorClear={() => { error = null; clearAuthError(); }}
        isProcessing={$authLoading}
        {error}
      />
    </div>
  {/if}
</div>

<style>
  .login-container {
    width: 100%;
    height: 100vh;
    background: var(--bg-page, #1c1c1c);
  }

  .checking-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100vh;
    gap: 16px;
    background: var(--bg-page, #1c1c1c);
  }

  .checking-spinner {
    width: 48px;
    height: 48px;
    border: 4px solid var(--border-subtle, #313338);
    border-top-color: var(--accent, #5865f2);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .checking-text {
    color: var(--text-secondary, #dbdee1);
    font-size: 0.9375rem;
    margin: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .pin-screen {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100vh;
    background: var(--bg-page);
  }
</style>

