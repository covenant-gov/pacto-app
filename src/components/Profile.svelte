<script lang="ts">
  import { onMount } from 'svelte';
  import { loadProfile, profiles, profileLoadingStates } from '../stores/profiles';
  import { logout, currentUser } from '../stores/auth';
  import { exportKeys } from '../lib/api/auth';
  import { loadAndDecryptKey } from '../lib/api/encryption';
  import { updateProfile, uploadAvatar } from '../lib/api/nostr';
  import { getProfileAvatarSrc, getProfileBannerSrc } from '../lib/utils/profile';
  import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
  import { theme, setTheme, type Theme } from '../stores/theme';
  import { activeView } from '../stores/app';
  import backIcon from '../icons/chevron-double-left.svg';

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
  let uploadingAvatar = false;
  let uploadingBanner = false;
  
  // Export keys modal state
  let showExportModal = false;
  let showPinModal = false;
  let exportedKeys: { nsec: string; seed_phrase?: string } | null = null;
  let pinDigits = ['', '', '', '', '', ''];
  let pinError = '';
  let isExporting = false;
  let copiedNsec = false;
  let copiedSeed = false;
  let pinInputs: HTMLInputElement[] = [];

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

  async function handleLogout() {
    isLoggingOut = true;
    try {
      await logout(false); // Don't clear keys, just logout
    } catch (e) {
      console.error('Logout failed:', e);
    }
    // Will redirect to login automatically via +layout.svelte
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
    if (!profile) return;
    saveError = null;
    try {
      await updateProfile({
        name: editName.trim(),
        avatar: editAvatarUrl,
        banner: editBannerUrl,
        about: editAbout.trim(),
      });
      isEditing = false;
      // profile_update event will update the store and UI
    } catch (e: any) {
      console.error('Save profile failed:', e);
      saveError = e?.message || 'Failed to save profile';
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
    copiedNsec = false;
    copiedSeed = false;
  }

  function closePinModal() {
    showPinModal = false;
    pinDigits = ['', '', '', '', '', ''];
    pinError = '';
  }

  async function copyToClipboard(text: string, type: 'nsec' | 'seed') {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'nsec') {
        copiedNsec = true;
        setTimeout(() => copiedNsec = false, 2000);
      } else {
        copiedSeed = true;
        setTimeout(() => copiedSeed = false, 2000);
      }
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  }
</script>

<div class="profile-view">
  <div class="profile-container">
    <div class="profile-header">
      <button type="button" class="profile-back" on:click={goBack} aria-label="Back to DMs or Squads">
        <img src={backIcon} alt="" class="profile-back-icon" />
        <span>Back</span>
      </button>
    </div>
    
    {#if loading}
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
            <h2>Edit profile</h2>
            {#if saveError}
              <p class="edit-error" role="alert">{saveError}</p>
            {/if}
            <label class="edit-label" for="edit-name">Name</label>
            <input id="edit-name" type="text" class="edit-input" bind:value={editName} placeholder="Display name" />
            <label class="edit-label" for="edit-about">About</label>
            <textarea id="edit-about" class="edit-textarea" bind:value={editAbout} placeholder="Bio" rows="3"></textarea>
            <div class="edit-image-buttons">
              <button type="button" class="btn-edit-image" on:click={handleChangeAvatar} disabled={uploadingAvatar}>
                {uploadingAvatar ? 'Uploading…' : 'Change avatar'}
              </button>
              <button type="button" class="btn-edit-image" on:click={handleChangeBanner} disabled={uploadingBanner}>
                {uploadingBanner ? 'Uploading…' : 'Change banner'}
              </button>
            </div>
            <div class="edit-actions">
              <button type="button" class="btn-cancel-edit" on:click={cancelEditing}>Cancel</button>
              <button type="button" class="btn-save-edit" on:click={handleSaveProfile}>Save</button>
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
              <a href={profile.website} target="_blank" rel="noopener noreferrer" class="website">
                🌐 {profile.website}
              </a>
            {/if}

            <!-- Lightning Address -->
            {#if profile.lud16 || profile.lud06}
              <p class="lightning">⚡ {profile.lud16 || profile.lud06}</p>
            {/if}

            <!-- Debug Info -->
            <div class="debug-info">
              <p class="meta">ID: {profile.id}</p>
              <p class="meta">Muted: {profile.muted ? 'Yes' : 'No'} | Bot: {profile.bot ? 'Yes' : 'No'}</p>
            </div>

            <!-- Appearance -->
            <section class="theme-section" aria-labelledby="theme-heading">
              <h2 id="theme-heading" class="theme-section-title">Appearance</h2>
              <span class="theme-label">Theme</span>
              <div class="theme-options" role="radiogroup" aria-label="App theme">
                {#each ['default', 'light', 'colorful'] as t}
                  {@const value = t as Theme}
                  <label class="theme-option">
                    <input type="radio" name="theme" value={value} checked={$theme === value} on:change={() => setTheme(value)} />
                    <span class="theme-option-label">{value === 'default' ? 'Dark' : value === 'light' ? 'Light' : 'Midnight'}</span>
                  </label>
                {/each}
              </div>
            </section>

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
                on:click={handleLogout}
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
          <button class="btn-copy" on:click={() => copyToClipboard(exportedKeys!.nsec, 'nsec')}>
            {copiedNsec ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <div class="key-value">{exportedKeys.nsec}</div>
      </div>
      
      <!-- Seed Phrase (if available) -->
      {#if exportedKeys.seed_phrase}
        <div class="key-section">
          <div class="key-header">
            <h3>Recovery Phrase (12 words)</h3>
            <button class="btn-copy" on:click={() => copyToClipboard(exportedKeys!.seed_phrase!, 'seed')}>
              {copiedSeed ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div class="key-value seed-phrase">{exportedKeys.seed_phrase}</div>
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
  }

  .profile-header {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    margin-bottom: 32px;
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
    gap: 6px;
    padding: 8px 14px;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    transition: color 0.15s, background-color 0.15s, border-color 0.15s;
    outline: none;
    flex-shrink: 0;
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

  .btn-cancel-edit:hover {
    background: var(--border-subtle);
    color: var(--text-primary);
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

  .btn-save-edit:hover {
    background: var(--accent-hover);
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

