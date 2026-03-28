<script lang="ts">
  import { onMount } from 'svelte';
  import { loadProfile, profiles, profileLoadingStates } from '../../stores/profiles';
  import { logout, currentUser } from '../../stores/auth';
  import { exportKeys, type EvmAccountExportRow } from '../../lib/api/auth';
  import { loadAndDecryptKey } from '../../lib/api/encryption';
  import { updateProfile, uploadAvatar } from '../../lib/api/nostr';
  import { getProfileAvatarSrc, getProfileBannerSrc } from '../../lib/utils/profile';
  import { openExternalUrl } from '../../lib/utils/open-external';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
  import { showToast } from '../../stores/toast';
  import { theme, setTheme, THEME_OPTIONS } from '../../stores/theme';
  import { activeView, activeSettingsAreaTab } from '../../stores/app';
  import WalletView from '../wallet/WalletView.svelte';
  import backIcon from '../../icons/chevron-double-left.svg';

  function goBack() {
    $activeView = 'hub';
  }

  // Get the logged-in user's npub from auth store
  $: userNpub = $currentUser?.npub || '';
  $: profile = userNpub ? $profiles[userNpub] : null;
  $: loading = userNpub ? ($profileLoadingStates[userNpub] || false) : false;
  
  // Compute avatar and banner sources with caching priority
  $: avatarSrc = getProfileAvatarSrc(profile);
  $: bannerSrc = getProfileBannerSrc(profile);
  
  let error: string | null = null;
  let isLoggingOut = false;

  // Edit profile state
  let isEditing = false;
  let editName = '';
  let editAbout = '';
  let editAvatarUrl = '';
  let editBannerUrl = '';
  let saveError: string | null = null;
  let savingProfile = false;
  let uploadingAvatar = false;
  let uploadingBanner = false;
  
  // Export keys modal state
  let showExportModal = false;
  let showPinModal = false;
  let showLogoutConfirm = false;
  let exportedKeys: {
    nsec: string;
    seed_phrase?: string;
    evm_private_key?: string | null;
    evm_accounts?: EvmAccountExportRow[];
  } | null = null;
  let pinDigits = ['', '', '', '', '', ''];
  let pinError = '';
  let isExporting = false;
  /** Tracks which control last copied: `nsec`, `seed`, or an EVM account `id`. */
  let copiedKey: string | null = null;
  let revealedNsec = false;
  let revealedSeed = false;
  /** EVM account row id → plaintext visible */
  let revealedEvm: Record<string, boolean> = {};
  let pinInputs: HTMLInputElement[] = [];

  let copiedNpub = false;

  // Watch for changes to userNpub and load profile
  $: if (userNpub) {
    loadUserProfile(userNpub);
  }

  async function loadUserProfile(npub: string) {
    if (!npub) return;

    try {
      error = null;
      await loadProfile(npub);
    } catch (e: any) {
      error = e.message || 'Failed to load profile';
      console.error('Profile load error:', e);
    }
  }

  onMount(() => {
    // Initial load will be triggered by reactive statement above
    if (!userNpub) {
      error = 'No user logged in';
    }
  });

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
    // Backend restarts on success; otherwise redirect to login via +layout.svelte
  }

  function startEditing() {
    if (!profile) return;
    isEditing = true;
    saveError = null;
    editName = profile.name || profile.display_name || '';
    editAbout = profile.about || '';
    editAvatarUrl = profile.avatar || '';
    editBannerUrl = profile.banner || '';
  }

  function cancelEditing() {
    isEditing = false;
    saveError = null;
  }

  async function handleChangeAvatar() {
    if (!profile || uploadingAvatar) return;
    try {
      const selected = await openFileDialog({
        title: 'Choose avatar image',
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
        multiple: false,
      });
      if (selected == null) return;
      uploadingAvatar = true;
      saveError = null;
      const url = await uploadAvatar(selected, 'avatar');
      editAvatarUrl = url;
    } catch (e: any) {
      console.error('Upload avatar failed:', e);
      saveError = e?.message || 'Failed to upload avatar';
    } finally {
      uploadingAvatar = false;
    }
  }

  async function handleChangeBanner() {
    if (!profile || uploadingBanner) return;
    try {
      const selected = await openFileDialog({
        title: 'Choose banner image',
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
        multiple: false,
      });
      if (selected == null) return;
      uploadingBanner = true;
      saveError = null;
      const url = await uploadAvatar(selected, 'banner');
      editBannerUrl = url;
    } catch (e: any) {
      console.error('Upload banner failed:', e);
      saveError = e?.message || 'Failed to upload banner';
    } finally {
      uploadingBanner = false;
    }
  }

  async function handleSaveProfile() {
    if (!profile || savingProfile) return;
    saveError = null;
    savingProfile = true;
    try {
      await updateProfile({
        name: editName.trim(),
        avatar: editAvatarUrl,
        banner: editBannerUrl,
        about: editAbout.trim(),
      });
      isEditing = false;
      showToast('Profile published to the network.');
    } catch (e: unknown) {
      console.error('Save profile failed:', e);
      const msg = getInvokeErrorMessage(e, 'Could not publish profile.');
      saveError = msg;
      showToast(msg);
    } finally {
      savingProfile = false;
    }
  }

  function handleExportAccount() {
    showPinModal = true;
    pinDigits = ['', '', '', '', '', ''];
    pinError = '';
    // Focus first input after modal opens
    setTimeout(() => {
      if (pinInputs[0]) pinInputs[0].focus();
    }, 100);
  }

  async function handlePinSubmit() {
    const pinValue = pinDigits.join('');
    if (pinValue.length !== 6) {
      pinError = 'PIN must be 6 digits';
      return;
    }

    isExporting = true;
    pinError = '';

    try {
      // Verify PIN by trying to decrypt the stored key
      await loadAndDecryptKey(pinValue);
      
      // If successful, export the keys
      exportedKeys = await exportKeys();
      showPinModal = false;
      showExportModal = true;
    } catch (e: any) {
      pinError = 'Incorrect PIN';
      console.error('Export failed:', e);
      // Clear PIN boxes on error
      pinDigits = ['', '', '', '', '', ''];
      // Focus first input
      setTimeout(() => {
        if (pinInputs[0]) pinInputs[0].focus();
      }, 100);
    } finally {
      isExporting = false;
    }
  }

  function handlePinInput(index: number, event: Event) {
    const input = event.target as HTMLInputElement;
    const value = input.value;

    // Only allow digits
    if (value && !/^\d$/.test(value)) {
      input.value = pinDigits[index];
      return;
    }

    pinDigits[index] = value;
    pinError = '';

    // Move to next input if value entered
    if (value && index < 5) {
      pinInputs[index + 1]?.focus();
    }

    // Auto-submit when all digits entered
    if (pinDigits.every(d => d !== '')) {
      handlePinSubmit();
    }
  }

  function handlePinKeydown(index: number, event: KeyboardEvent) {
    // Handle backspace
    if (event.key === 'Backspace') {
      if (!pinDigits[index] && index > 0) {
        // If current is empty, go back and clear previous
        pinDigits[index - 1] = '';
        pinInputs[index - 1]?.focus();
      } else {
        // Clear current
        pinDigits[index] = '';
      }
      event.preventDefault();
    }
    // Handle left arrow
    else if (event.key === 'ArrowLeft' && index > 0) {
      pinInputs[index - 1]?.focus();
    }
    // Handle right arrow
    else if (event.key === 'ArrowRight' && index < 5) {
      pinInputs[index + 1]?.focus();
    }
    // Handle Enter
    else if (event.key === 'Enter') {
      handlePinSubmit();
    }
  }

  function handlePinPaste(event: ClipboardEvent) {
    event.preventDefault();
    const pastedData = event.clipboardData?.getData('text') || '';
    const digits = pastedData.replace(/\D/g, '').split('').slice(0, 6);
    
    digits.forEach((digit, i) => {
      if (i < 6) {
        pinDigits[i] = digit;
      }
    });

    // Focus last filled input or first empty
    const lastIndex = Math.min(digits.length - 1, 5);
    pinInputs[lastIndex]?.focus();

    // Auto-submit if all 6 digits pasted
    if (digits.length === 6) {
      handlePinSubmit();
    }
  }

  function closeExportModal() {
    showExportModal = false;
    exportedKeys = null;
    copiedKey = null;
    revealedNsec = false;
    revealedSeed = false;
    revealedEvm = {};
  }

  function toggleEvmReveal(id: string) {
    revealedEvm = { ...revealedEvm, [id]: !revealedEvm[id] };
  }

  function shortEthAddr(addr: string): string {
    const a = addr.trim();
    if (a.length <= 14) return a;
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
  }

  async function copySecret(text: string, copyId: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedKey = copyId;
      setTimeout(() => {
        if (copiedKey === copyId) copiedKey = null;
      }, 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  }

  function closePinModal() {
    showPinModal = false;
    pinDigits = ['', '', '', '', '', ''];
    pinError = '';
  }

</script>

<div class="profile-view">
  <div class="profile-container">
    <div class="profile-top-row">
      <button type="button" class="profile-back" on:click={goBack} aria-label="Back to DMs or Squads">
        <img src={backIcon} alt="" class="profile-back-icon" />
        <span>Back</span>
      </button>
      {#if userNpub}
      <div class="settings-mode-bar" role="tablist" aria-label="Account and preferences">
        <button
          type="button"
          role="tab"
          class="settings-mode-tab"
          class:active={$activeSettingsAreaTab === 'profile'}
          aria-selected={$activeSettingsAreaTab === 'profile'}
          on:click={() => activeSettingsAreaTab.set('profile')}
        >
          Profile
        </button>
        <button
          type="button"
          role="tab"
          class="settings-mode-tab"
          class:active={$activeSettingsAreaTab === 'wallet'}
          aria-selected={$activeSettingsAreaTab === 'wallet'}
          on:click={() => activeSettingsAreaTab.set('wallet')}
        >
          Wallet
        </button>
        <button
          type="button"
          role="tab"
          class="settings-mode-tab"
          class:active={$activeSettingsAreaTab === 'settings'}
          aria-selected={$activeSettingsAreaTab === 'settings'}
          on:click={() => activeSettingsAreaTab.set('settings')}
        >
          Settings
        </button>
      </div>
      {/if}
    </div>

    {#if $activeSettingsAreaTab === 'wallet'}
      <div class="settings-panel settings-panel--wallet">
        <WalletView />
      </div>
    {:else if $activeSettingsAreaTab === 'settings'}
      <div class="settings-panel settings-panel--app">
        <section class="theme-section" aria-labelledby="theme-heading">
          <h2 id="theme-heading" class="theme-section-title">Appearance</h2>
          <span class="theme-label">Theme</span>
          <div class="theme-options" role="radiogroup" aria-label="App theme">
            {#each THEME_OPTIONS as opt (opt.value)}
              <label class="theme-option">
                <input
                  type="radio"
                  name="theme"
                  value={opt.value}
                  checked={$theme === opt.value}
                  on:change={() => setTheme(opt.value)}
                />
                <span class="theme-option-label">{opt.label}</span>
              </label>
            {/each}
          </div>
        </section>
      </div>
    {:else if loading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading profile...</p>
      </div>
    {:else if error}
      <div class="error-state">
        <p>❌ {error}</p>
        <p class="error-detail">Make sure you're logged in and the npub is correct.</p>
      </div>
    {:else if profile}
      <div class="profile-content">
        <!-- Banner -->
        {#if bannerSrc}
          <div class="profile-banner">
            <img
              src={bannerSrc}
              alt=""
              class="banner-img"
              on:error={(e) => {
                const img = e.currentTarget as HTMLImageElement;
                img.style.display = 'none';
                const placeholder = img.nextElementSibling as HTMLElement;
                if (placeholder?.classList.contains('banner-placeholder')) {
                  placeholder.style.display = 'block';
                }
              }}
            />
            <div class="banner-placeholder" style="display: none;" aria-hidden="true"></div>
          </div>
        {/if}

        <!-- Avatar -->
        <div class="avatar-section">
          {#if avatarSrc}
            <img 
              src={avatarSrc} 
              alt={profile.display_name || profile.name} 
              class="avatar"
              on:error={(e) => {
                // On error, hide img and show placeholder
                const img = e.currentTarget as HTMLImageElement;
                img.style.display = 'none';
                const placeholder = img.nextElementSibling as HTMLElement;
                if (placeholder?.classList.contains('avatar-placeholder')) {
                  placeholder.style.display = 'flex';
                }
              }}
            />
            <div class="avatar-placeholder" style="display: none;">
              {(profile.display_name || profile.name || 'U').charAt(0).toUpperCase()}
            </div>
          {:else}
            <div class="avatar-placeholder">
              {(profile.display_name || profile.name || 'U').charAt(0).toUpperCase()}
            </div>
          {/if}
        </div>

        <!-- Profile Info or Edit Form -->
        <div class="info-section">
          {#if isEditing}
            <h2>Edit Profile</h2>
            {#if saveError}
              <p class="edit-error" role="alert">{saveError}</p>
            {/if}
            <label class="edit-label" for="edit-name">Name</label>
            <input
              id="edit-name"
              type="text"
              class="edit-input"
              bind:value={editName}
              placeholder="Display name"
              disabled={savingProfile}
            />
            <label class="edit-label" for="edit-about">About</label>
            <textarea
              id="edit-about"
              class="edit-textarea"
              bind:value={editAbout}
              placeholder="Bio"
              rows="3"
              disabled={savingProfile}
            ></textarea>
            <div class="edit-image-buttons">
              <button type="button" class="btn-edit-image" on:click={handleChangeAvatar} disabled={uploadingAvatar || savingProfile}>
                {uploadingAvatar ? 'Uploading…' : 'Change avatar'}
              </button>
              <button type="button" class="btn-edit-image" on:click={handleChangeBanner} disabled={uploadingBanner || savingProfile}>
                {uploadingBanner ? 'Uploading…' : 'Change banner'}
              </button>
            </div>
            <div class="edit-actions">
              <button type="button" class="btn-cancel-edit" on:click={cancelEditing} disabled={savingProfile}>Cancel</button>
              <button type="button" class="btn-save-edit" on:click={handleSaveProfile} disabled={savingProfile}>
                {savingProfile ? 'Publishing…' : 'Save'}
              </button>
            </div>
          {:else}
            <h2>{profile.display_name || profile.name || 'Anonymous'}</h2>
            {#if profile.nickname}
              <p class="nickname">aka "{profile.nickname}"</p>
            {/if}
            
            {#if profile.nip05}
              <p class="nip05">✓ {profile.nip05}</p>
            {/if}

            {#if profile.about}
              <p class="about">{profile.about}</p>
            {/if}

            {#if profile.website}
              <a
                href={profile.website}
                target="_blank"
                rel="noopener noreferrer"
                class="website"
                on:click|preventDefault={() => openExternalUrl(profile.website!)}
              >
                🌐 {profile.website}
              </a>
            {/if}

            <!-- Lightning Address -->
            {#if profile.lud16 || profile.lud06}
              <p class="lightning">⚡ {profile.lud16 || profile.lud06}</p>
            {/if}

            <!-- Debug Info -->
            <div class="debug-info">
              <p class="meta evm-address-line">
                <span>ID:</span>
                <span class="evm-address-value">{profile.id}</span>
                <button type="button" class="btn-copy-inline" on:click={async () => {
                  try {
                    await navigator.clipboard.writeText(profile?.id ?? '');
                    copiedNpub = true;
                    setTimeout(() => copiedNpub = false, 2000);
                  } catch (_) {}
                }}>
                  {copiedNpub ? '✓ Copied' : 'Copy'}
                </button>
              </p>
              <p class="meta">Muted: {profile.muted ? 'Yes' : 'No'} | Bot: {profile.bot ? 'Yes' : 'No'}</p>
            </div>

            <!-- Actions -->
            <div class="profile-actions">
              <button 
                class="btn-edit-profile" 
                on:click={startEditing}
              >
                Edit profile
              </button>
              <button 
                class="btn-export" 
                on:click={handleExportAccount}
              >
                Export Account
              </button>
              <button 
                class="btn-logout" 
                on:click={openLogoutConfirm}
                disabled={isLoggingOut}
              >
                {isLoggingOut ? 'Logging out...' : 'Logout'}
              </button>
            </div>
          {/if}
        </div>
      </div>
    {:else}
      <div class="empty-state">
        <p>No profile loaded</p>
      </div>
    {/if}
  </div>
</div>

<!-- Logout confirmation modal -->
{#if showLogoutConfirm}
  <div class="modal-overlay" on:click={closeLogoutConfirm} on:keydown={(e) => e.key === 'Escape' && closeLogoutConfirm()} role="button" tabindex="-1">
    <div class="modal-content" on:click|stopPropagation on:keydown={(e) => e.key === 'Escape' && closeLogoutConfirm()} role="dialog" aria-modal="true" tabindex="0">
      <h2>Logout</h2>
      <p class="modal-subtitle">
        Logout will remove this account's data from this device (chats, keys, and MLS data). The app will restart. You can create a new account or log in with a different key after that.
      </p>
      <div class="modal-actions">
        <button class="btn-cancel" on:click={closeLogoutConfirm} disabled={isLoggingOut}>
          Cancel
        </button>
        <button class="btn-confirm btn-logout-confirm" on:click={handleLogout} disabled={isLoggingOut}>
          {isLoggingOut ? 'Logging out...' : 'Logout'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- PIN Modal -->
{#if showPinModal}
  <div class="modal-overlay" on:click={closePinModal} on:keydown={(e) => e.key === 'Escape' && closePinModal()} role="button" tabindex="-1">
    <div class="modal-content" on:click|stopPropagation on:keydown={(e) => e.key === 'Escape' && closePinModal()} role="dialog" aria-modal="true" tabindex="0">
      <h2>Enter PIN</h2>
      <p class="modal-subtitle">Enter your PIN to export your account keys</p>
      
      {#if pinError}
        <div class="modal-error">{pinError}</div>
      {/if}
      
      <div class="pin-boxes">
        {#each pinDigits as digit, i}
          <input
            bind:this={pinInputs[i]}
            type="password"
            inputmode="numeric"
            maxlength="1"
            value={digit}
            on:input={(e) => handlePinInput(i, e)}
            on:keydown={(e) => handlePinKeydown(i, e)}
            on:paste={handlePinPaste}
            class="pin-box"
            disabled={isExporting}
          />
        {/each}
      </div>
      
      <div class="modal-actions">
        <button class="btn-cancel" on:click={closePinModal} disabled={isExporting}>
          Cancel
        </button>
        <button class="btn-confirm" on:click={handlePinSubmit} disabled={isExporting || pinDigits.some(d => d === '')}>
          {isExporting ? 'Verifying...' : 'Continue'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Export Keys Modal -->
{#if showExportModal && exportedKeys}
  <div class="modal-overlay" on:click={closeExportModal} on:keydown={(e) => e.key === 'Escape' && closeExportModal()} role="button" tabindex="-1">
    <div class="modal-content export-modal" on:click|stopPropagation on:keydown={(e) => e.key === 'Escape' && closeExportModal()} role="dialog" aria-modal="true" tabindex="0">
      <h2>⚠️ Export Account Keys</h2>
      <p class="modal-warning">
        Keep these keys safe and never share them with anyone. Anyone with access to these keys can control your account.
      </p>
      
      <!-- Private Key (nsec) -->
      <div class="key-section">
        <div class="key-header">
          <h3>Private Key (nsec)</h3>
        </div>
        <div class="key-value secret-value-shell">
          <div class="secret-value-main">
            {#if revealedNsec}
              <span class="secret-plain">{exportedKeys.nsec}</span>
            {:else}
              <span class="secret-mask" aria-hidden="true">•••••••••••••••••••••••••••••••••</span>
            {/if}
          </div>
          <div class="secret-toolbar">
            <button
              type="button"
              class="btn-reveal-secret"
              aria-pressed={revealedNsec}
              aria-label={revealedNsec ? 'Hide nsec' : 'Reveal nsec'}
              title={revealedNsec ? 'Hide' : 'Reveal'}
              on:click={() => (revealedNsec = !revealedNsec)}
            >
              {#if revealedNsec}
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="reveal-icon" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="reveal-icon" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              {/if}
            </button>
            <button type="button" class="btn-copy" on:click={() => copySecret(exportedKeys!.nsec, 'nsec')}>
              {copiedKey === 'nsec' ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </div>

      <!-- Seed Phrase (if available) -->
      {#if exportedKeys.seed_phrase}
        <div class="key-section">
          <div class="key-header">
            <h3>Recovery Phrase (12 words)</h3>
          </div>
          <div class="key-value secret-value-shell">
            <div class="secret-value-main">
              {#if revealedSeed}
                <span class="secret-plain seed-phrase">{exportedKeys.seed_phrase}</span>
              {:else}
                <span class="secret-mask" aria-hidden="true">•••• •••• •••• •••• •••• •••• •••• •••• •••• •••• •••• ••••</span>
              {/if}
            </div>
            <div class="secret-toolbar">
              <button
                type="button"
                class="btn-reveal-secret"
                aria-pressed={revealedSeed}
                aria-label={revealedSeed ? 'Hide recovery phrase' : 'Reveal recovery phrase'}
                title={revealedSeed ? 'Hide' : 'Reveal'}
                on:click={() => (revealedSeed = !revealedSeed)}
              >
                {#if revealedSeed}
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="reveal-icon" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                {:else}
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="reveal-icon" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                {/if}
              </button>
              <button type="button" class="btn-copy" on:click={() => copySecret(exportedKeys!.seed_phrase!, 'seed')}>
                {copiedKey === 'seed' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      {/if}

      <!-- All EVM account private keys -->
      {#if exportedKeys.evm_accounts?.length}
        <div class="key-section">
          <div class="key-header">
            <h3>EVM accounts</h3>
          </div>
          <p class="evm-export-intro">Each row is one wallet address. Copy works without revealing the key.</p>
          <ul class="evm-export-list">
            {#each exportedKeys.evm_accounts as acc (acc.id)}
              <li class="evm-export-card">
                <p class="evm-export-meta">
                  <span class="evm-export-addr">{shortEthAddr(acc.address)}</span>
                  {#if acc.label?.trim()}
                    <span> · {acc.label.trim()}</span>
                  {/if}
                  {#if acc.hdIndex != null}
                    <span> · Derived #{acc.hdIndex}</span>
                  {:else if acc.scheme === 'imported_private_key'}
                    <span> · Imported</span>
                  {/if}
                </p>
                <div class="key-value secret-value-shell">
                  <div class="secret-value-main">
                    {#if revealedEvm[acc.id]}
                      <span class="secret-plain">{acc.privateKey}</span>
                    {:else}
                      <span class="secret-mask" aria-hidden="true">•••••••••••••••••••••••••••••••••</span>
                    {/if}
                  </div>
                  <div class="secret-toolbar">
                    <button
                      type="button"
                      class="btn-reveal-secret"
                      aria-pressed={revealedEvm[acc.id] === true}
                      aria-label={revealedEvm[acc.id] ? 'Hide EVM private key' : 'Reveal EVM private key'}
                      title={revealedEvm[acc.id] ? 'Hide' : 'Reveal'}
                      on:click={() => toggleEvmReveal(acc.id)}
                    >
                      {#if revealedEvm[acc.id]}
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="reveal-icon" aria-hidden="true">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                        </svg>
                      {:else}
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="reveal-icon" aria-hidden="true">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      {/if}
                    </button>
                    <button type="button" class="btn-copy" on:click={() => copySecret(acc.privateKey, acc.id)}>
                      {copiedKey === acc.id ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      
      <div class="modal-notice">
        <p>💡 Tip: Store these keys securely offline. The recovery phrase is easier to backup than the nsec key.</p>
      </div>
      
      <div class="modal-actions">
        <button class="btn-close" on:click={closeExportModal}>
          Close
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .profile-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    height: 100%;
    overflow-y: auto;
    border-left: 1px solid var(--border-subtle);
  }

  .profile-container {
    max-width: 800px;
    margin: 0 auto;
    padding: 32px;
    width: 100%;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .profile-top-row {
    display: flex;
    align-items: stretch;
    gap: 12px;
    margin-bottom: 24px;
    min-width: 0;
  }

  /* Match TopNavbar `.mode-switcher` / `.mode-segment` (slim segmented control). */
  .settings-mode-bar {
    display: flex;
    align-items: stretch;
    flex: 1;
    min-width: 0;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 3px;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.06);
  }

  .settings-mode-tab {
    flex: 1;
    min-width: 0;
    padding: 0 14px;
    font-size: 0.9375rem;
    font-weight: 500;
    line-height: 1.2;
    font-family: inherit;
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: color 0.15s, background-color 0.15s;
    outline: none;
  }

  .settings-mode-tab:hover:not(.active) {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .settings-mode-tab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .settings-mode-tab.active {
    color: var(--text-primary);
    background: var(--bg-elevated);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  .settings-panel {
    min-width: 0;
  }

  .settings-panel--wallet {
    margin: 0 calc(-1 * 32px);
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .settings-panel--wallet :global(.wallet-view) {
    border-radius: 0;
  }

  .settings-panel--app {
    padding-bottom: 48px;
  }

  .settings-panel--app .theme-section {
    border-bottom: none;
    margin-bottom: 0;
    padding-bottom: 0;
  }

  h1 {
    color: var(--text-primary);
    font-size: 2rem;
    font-weight: 600;
    margin: 0 0 32px 0;
  }

  .profile-back {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 14px;
    min-height: 0;
    font-size: 0.9375rem;
    font-weight: 500;
    line-height: 1.2;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    transition: color 0.15s, background-color 0.15s, border-color 0.15s;
    outline: none;
    flex-shrink: 0;
    box-sizing: border-box;
  }

  .profile-back:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
    border-color: var(--border-subtle);
  }

  .profile-back:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .profile-back-icon {
    width: 18px;
    height: 18px;
    display: block;
    filter: var(--icon-dropdown-filter);
  }

  .theme-section {
    margin-bottom: 32px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .theme-section-title {
    color: var(--text-primary);
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0 0 8px 0;
  }

  .theme-label {
    display: block;
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-bottom: 8px;
  }

  .theme-options {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .theme-option {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .theme-option input {
    accent-color: var(--accent);
  }

  .theme-option-label {
    user-select: none;
  }

  .loading-state, .error-state, .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 64px 16px;
    color: var(--text-muted);
  }

  .spinner {
    width: 48px;
    height: 48px;
    border: 4px solid var(--border-subtle);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 16px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-state {
    color: var(--danger);
  }

  .error-detail {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin-top: 8px;
  }

  .profile-content {
    display: flex;
    flex-direction: column;
    gap: 32px;
  }

  .profile-banner {
    width: 100%;
    max-height: 200px;
    border-radius: 8px;
    overflow: hidden;
    background: var(--bg-elevated);
  }

  .banner-img {
    width: 100%;
    height: 100%;
    max-height: 200px;
    object-fit: cover;
    display: block;
  }

  .banner-placeholder {
    width: 100%;
    height: 120px;
    background: linear-gradient(135deg, var(--bg-elevated) 0%, var(--bg-hover) 100%);
  }

  .avatar-section {
    display: flex;
    justify-content: center;
  }

  .avatar {
    width: 128px;
    height: 128px;
    border-radius: 50%;
    object-fit: cover;
    border: 4px solid var(--border-subtle);
  }

  .avatar-placeholder {
    width: 128px;
    height: 128px;
    border-radius: 50%;
    background: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    font-weight: 600;
    font-size: 3rem;
    border: 4px solid var(--border-subtle);
  }

  .info-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .info-section h2 {
    color: var(--text-primary);
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0;
  }

  .nickname {
    color: var(--text-muted);
    font-style: italic;
    margin: 0;
  }

  .nip05 {
    color: var(--success);
    font-size: 0.875rem;
    margin: 0;
  }

  .about {
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0;
  }

  .website {
    color: var(--accent);
    text-decoration: none;
    font-size: 0.9375rem;
  }

  .website:hover {
    text-decoration: underline;
  }

  .lightning {
    color: var(--warning);
    font-size: 0.9375rem;
    margin: 0;
    font-family: monospace;
  }

  .debug-info {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border-subtle);
  }

  .meta {
    color: var(--text-muted);
    font-size: 0.75rem;
    margin: 4px 0;
    font-family: monospace;
  }

  .evm-address-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .evm-address-value {
    word-break: break-all;
  }
  .btn-copy-inline {
    font-size: 0.7rem;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .btn-copy-inline:hover {
    background: var(--bg-tertiary);
  }

  .profile-actions {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .edit-error {
    color: var(--danger);
    font-size: 0.875rem;
    margin: 0 0 12px 0;
  }

  .edit-label {
    display: block;
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin: 12px 0 4px 0;
  }

  .edit-input,
  .edit-textarea {
    width: 100%;
    padding: 10px 12px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 0.9375rem;
    outline: none;
  }

  .edit-input:focus,
  .edit-textarea:focus {
    border-color: var(--accent);
  }

  .edit-input:disabled,
  .edit-textarea:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .edit-textarea {
    resize: vertical;
    min-height: 72px;
  }

  .edit-image-buttons {
    display: flex;
    gap: 12px;
    margin-top: 16px;
  }

  .btn-edit-image {
    padding: 8px 16px;
    background: var(--bg-hover);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.875rem;
    cursor: pointer;
    outline: none;
  }

  .btn-edit-image:hover:not(:disabled) {
    background: var(--border);
  }

  .btn-edit-image:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .edit-actions {
    display: flex;
    gap: 12px;
    margin-top: 20px;
  }

  .btn-cancel-edit {
    padding: 10px 20px;
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.9375rem;
    cursor: pointer;
    outline: none;
  }

  .btn-cancel-edit:hover:not(:disabled) {
    background: var(--border-subtle);
    color: var(--text-primary);
  }

  .btn-cancel-edit:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .btn-save-edit {
    padding: 10px 20px;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    outline: none;
  }

  .btn-save-edit:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .btn-save-edit:disabled {
    opacity: 0.85;
    cursor: wait;
  }

  .btn-edit-profile {
    width: 100%;
    height: 48px;
    background: transparent;
    color: var(--accent);
    border: 2px solid var(--accent);
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    outline: none;
  }

  .btn-edit-profile:hover {
    background: rgba(88, 101, 242, 0.1);
  }

  .btn-export {
    width: 100%;
    height: 48px;
    background: transparent;
    color: var(--accent);
    border: 2px solid var(--accent);
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    outline: none;
  }

  .btn-export:hover {
    background: rgba(88, 101, 242, 0.1);
  }

  .btn-logout {
    width: 100%;
    height: 48px;
    background: transparent;
    color: var(--danger);
    border: 2px solid var(--danger);
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    outline: none;
  }

  .btn-logout:hover:not(:disabled) {
    background: rgba(242, 63, 66, 0.1);
  }

  .btn-logout:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Modal styles */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
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
    margin: 0 0 8px 0;
  }

  .modal-subtitle {
    color: var(--text-muted);
    font-size: 0.9375rem;
    margin: 0 0 24px 0;
  }

  .modal-warning {
    color: var(--warning);
    background: rgba(250, 166, 26, 0.1);
    padding: 16px;
    border-radius: 8px;
    border-left: 3px solid var(--warning);
    margin-bottom: 24px;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .modal-error {
    color: var(--danger);
    background: rgba(242, 63, 66, 0.1);
    padding: 12px 16px;
    border-radius: 8px;
    margin-bottom: 16px;
    font-size: 0.875rem;
  }

  .pin-boxes {
    display: flex;
    gap: 12px;
    justify-content: center;
    margin-bottom: 24px;
  }

  .pin-box {
    width: 56px;
    height: 64px;
    padding: 0;
    background: var(--bg-elevated);
    border: 2px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 1.5rem;
    text-align: center;
    outline: none;
    transition: all 0.2s;
    caret-color: var(--accent);
  }

  .pin-box:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(88, 101, 242, 0.2);
    background: var(--bg-panel);
  }

  .pin-box:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .key-section {
    margin-bottom: 24px;
  }

  .key-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .key-header h3 {
    color: var(--text-primary);
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }

  .btn-copy {
    padding: 8px 16px;
    background: var(--accent);
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-copy:hover {
    background: var(--accent-hover);
  }

  .key-value {
    background: var(--bg-elevated);
    padding: 16px;
    border-radius: 8px;
    color: var(--text-secondary);
    font-family: 'Courier New', monospace;
    font-size: 0.875rem;
    word-break: break-all;
    line-height: 1.6;
    border: 1px solid var(--border-subtle);
  }

  .secret-value-shell {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 12px;
    justify-content: space-between;
  }

  .secret-value-main {
    flex: 1;
    min-width: 140px;
  }

  .secret-plain {
    color: var(--text-secondary);
  }

  .secret-mask {
    color: var(--text-muted);
    letter-spacing: 0.04em;
    user-select: none;
  }

  .secret-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .btn-reveal-secret {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-panel);
    color: var(--text-primary);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }

  .btn-reveal-secret:hover {
    border-color: var(--text-muted);
    background: var(--bg-hover);
  }

  .btn-reveal-secret[aria-pressed='true'] {
    border-color: var(--accent);
    color: var(--accent);
  }

  .reveal-icon {
    width: 1.15rem;
    height: 1.15rem;
  }

  .evm-export-intro {
    color: var(--text-muted);
    font-size: 0.8125rem;
    margin: 0 0 12px 0;
    line-height: 1.45;
  }

  .evm-export-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .evm-export-card {
    margin: 0;
    padding: 0;
  }

  .evm-export-meta {
    color: var(--text-muted);
    font-size: 0.8125rem;
    margin: 0 0 8px 0;
    line-height: 1.4;
  }

  .evm-export-addr {
    font-family: 'Courier New', monospace;
    color: var(--text-primary);
  }

  .seed-phrase {
    line-height: 1.8;
  }

  .modal-notice {
    background: rgba(88, 101, 242, 0.1);
    padding: 16px;
    border-radius: 8px;
    border-left: 3px solid var(--accent);
    margin-bottom: 24px;
  }

  .modal-notice p {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0;
    line-height: 1.5;
  }

  .modal-actions {
    display: flex;
    gap: 12px;
    margin-top: 24px;
  }

  .btn-cancel, .btn-confirm, .btn-close {
    flex: 1;
    height: 48px;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    outline: none;
  }

  .btn-cancel {
    background: transparent;
    color: var(--text-muted);
    border: 2px solid var(--border);
  }

  .btn-cancel:hover:not(:disabled) {
    background: var(--border-subtle);
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .btn-confirm {
    background: var(--accent);
    color: #ffffff;
  }

  .btn-confirm:hover:not(:disabled) {
    background: var(--accent-hover);
    box-shadow: 0 4px 12px rgba(88, 101, 242, 0.4);
  }

  .btn-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-logout-confirm {
    background: var(--danger);
    color: #ffffff;
  }

  .btn-logout-confirm:hover:not(:disabled) {
    background: rgba(242, 63, 66, 0.85);
  }

  .btn-close {
    background: var(--accent);
    color: #ffffff;
  }

  .btn-close:hover {
    background: var(--accent-hover);
    box-shadow: 0 4px 12px rgba(88, 101, 242, 0.4);
  }

  .export-modal {
    max-width: 640px;
  }
</style>

