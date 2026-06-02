<script lang="ts">
  import { onMount } from 'svelte';
  import { loadProfile, profiles, profileLoadingStates } from '../../stores/profiles';
  import { currentUser } from '../../stores/auth';
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

  // Edit profile state
  let isEditing = false;
  let editName = '';
  let editAbout = '';
  let editAvatarUrl = '';
  let saveError: string | null = null;
  let savingProfile = false;
  let uploadingAvatar = false;

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

  function startEditing() {
    if (!profile) return;
    isEditing = true;
    saveError = null;
    editName = profile.name || profile.display_name || '';
    editAbout = profile.about || '';
    editAvatarUrl = profile.avatar || '';
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

  async function handleSaveProfile() {
    if (!profile || savingProfile) return;
    saveError = null;
    savingProfile = true;
    try {
      await updateProfile({
        name: editName.trim(),
        avatar: editAvatarUrl,
        banner: profile.banner ?? '',
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

            <div class="profile-account-id">
              <span class="profile-account-id-label">Account ID (nPub):</span>
              <div class="profile-account-id-row">
                <code class="profile-account-id-value">{profile.id}</code>
                <button
                  type="button"
                  class="btn-copy-account-id"
                  on:click={async () => {
                    try {
                      await navigator.clipboard.writeText(profile?.id ?? '');
                      copiedNpub = true;
                      setTimeout(() => (copiedNpub = false), 2000);
                    } catch (_) {}
                  }}
                >
                  {copiedNpub ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <!-- Actions -->
            <div class="profile-actions">
              <button 
                class="btn-edit-profile" 
                on:click={startEditing}
              >
                Edit profile
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

  .profile-account-id {
    margin-top: 20px;
    padding: 14px 16px;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--bg-panel);
  }

  .profile-account-id-label {
    display: block;
    margin-bottom: 8px;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: 0.02em;
  }

  .profile-account-id-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 10px;
  }

  .profile-account-id-value {
    flex: 1;
    min-width: 0;
    font-size: 0.875rem;
    line-height: 1.45;
    word-break: break-all;
    color: var(--text-secondary);
  }

  .btn-copy-account-id {
    flex-shrink: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .btn-copy-account-id:hover {
    border-color: var(--border);
    color: var(--text-primary);
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
</style>

