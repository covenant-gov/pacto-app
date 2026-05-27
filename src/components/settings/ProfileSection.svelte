<script lang="ts">
  import { onMount } from 'svelte';
  import { loadProfile, profiles, profileLoadingStates } from '../../stores/profiles';
  import { logout, currentUser } from '../../stores/auth';
  import { updateProfile, uploadAvatar } from '../../lib/api/nostr';
  import { getProfileAvatarSrc, getProfileBannerSrc } from '../../lib/utils/profile';
  import { openExternalUrl } from '../../lib/utils/open-external';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
  import { showToast } from '../../stores/toast';
  import SettingsCollapsibleSection from './SettingsCollapsibleSection.svelte';
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

  let showLogoutConfirm = false;

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

</script>

<SettingsCollapsibleSection sectionId="settings-profile" title="Profile">

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
                <span>npub:</span>
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
</SettingsCollapsibleSection>

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

<style>
  .loading-state, .error-state, .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
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

  .modal-actions {
    display: flex;
    gap: 12px;
    margin-top: 24px;
  }

  .btn-cancel, .btn-confirm {
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
</style>

