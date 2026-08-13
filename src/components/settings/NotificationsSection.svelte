<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import SettingsCollapsibleSection from './SettingsCollapsibleSection.svelte';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import {
    getNotificationSettings,
    setNotificationSettings,
    previewNotificationSound,
    selectCustomNotificationSound,
    getNotificationPermissionState,
    requestNotificationPermission,
    BUILT_IN_NOTIFICATION_SOUNDS,
    type NotificationSettings,
    type NotificationSound,
    type NotificationPermissionState,
  } from '../../lib/api/notifications';

  let settings = $state<NotificationSettings | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let selectingCustomSound = $state(false);
  let error = $state<string | null>(null);
  let permissionState = $state<NotificationPermissionState>('default');

  onMount(() => {
    void loadSettings();
    void loadPermission();
  });

  async function loadSettings(): Promise<void> {
    loading = true;
    error = null;
    try {
      settings = await getNotificationSettings();
    } catch (e) {
      error = getInvokeErrorMessage(e, $t('notifications.loadError'));
    } finally {
      loading = false;
    }
  }

  async function loadPermission(): Promise<void> {
    const current = getNotificationPermissionState();
    if (current !== 'default') {
      permissionState = current;
      return;
    }
    try {
      // Settle an undetermined answer once, per R7; already-decided states are read-only from here.
      permissionState = await requestNotificationPermission();
    } catch {
      permissionState = current;
    }
  }

  /** Persists `next` optimistically, reverting and surfacing an error on failure. Never rejects. */
  async function persist(next: NotificationSettings): Promise<void> {
    const previous = settings;
    settings = next;
    saving = true;
    error = null;
    try {
      await setNotificationSettings(next);
    } catch (e) {
      settings = previous;
      error = getInvokeErrorMessage(e, $t('notifications.saveError'));
    } finally {
      saving = false;
    }
  }

  function handleSoundChange(sound: NotificationSound): void {
    if (!settings) return;
    void persist({ ...settings, sound });
  }

  function handleMuteChange(e: Event): void {
    if (!settings) return;
    const checked = (e.currentTarget as HTMLInputElement).checked;
    void persist({ ...settings, global_mute: checked });
  }

  async function handlePreview(sound: NotificationSound): Promise<void> {
    try {
      await previewNotificationSound(sound);
    } catch (e) {
      error = getInvokeErrorMessage(e, $t('notifications.previewError'));
    }
  }

  async function handleChooseCustomSound(): Promise<void> {
    if (!settings || selectingCustomSound) return;
    selectingCustomSound = true;
    error = null;
    try {
      const path = await selectCustomNotificationSound();
      await persist({ ...settings, sound: { type: 'Custom', path } });
    } catch (e) {
      const message = getInvokeErrorMessage(e, '');
      if (message === 'No file selected') {
        // Dialog cancelled — leave the previous selection as-is, no error to show.
      } else if (message === 'FILE_TOO_LARGE') {
        error = $t('notifications.customSoundTooLarge');
      } else {
        error = message || $t('notifications.selectSoundError');
      }
    } finally {
      selectingCustomSound = false;
    }
  }

  function soundOptionLabel(sound: NotificationSound): string {
    switch (sound.type) {
      case 'Default':
        return $t('notifications.soundOptionDefault');
      case 'Techno':
        return $t('notifications.soundOptionTechno');
      case 'None':
        return $t('notifications.soundOptionNone');
      case 'Custom':
        return $t('notifications.soundOptionCustom');
    }
    return '';
  }

  function customSoundFileName(path: string): string {
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] || path;
  }

  function permissionStateLabel(state: NotificationPermissionState): string {
    switch (state) {
      case 'granted':
        return $t('notifications.permissionGranted');
      case 'denied':
        return $t('notifications.permissionDenied');
      case 'default':
        return $t('notifications.permissionDefault');
      case 'unsupported':
        return $t('notifications.permissionUnsupported');
    }
    return '';
  }
</script>

<SettingsCollapsibleSection sectionId="settings-notifications" title={$t('notifications.title')}>
  <div class="notifications-settings">
    {#if loading}
      <p class="notifications-loading">{$t('notifications.loading')}</p>
    {:else if settings}
      <div class="sound-section" aria-labelledby="notif-sound-heading">
        <h3 id="notif-sound-heading" class="theme-subheading">{$t('notifications.soundSectionTitle')}</h3>
        <span class="theme-label">{$t('notifications.soundLabel')}</span>
        <div class="sound-options" role="radiogroup" aria-label={$t('notifications.soundLabel')}>
          {#each BUILT_IN_NOTIFICATION_SOUNDS as opt (opt.type)}
            <div class="sound-option-row">
              <label class="theme-option">
                <input
                  type="radio"
                  name="notif-sound"
                  value={opt.type}
                  checked={settings.sound.type === opt.type}
                  disabled={saving}
                  onchange={() => handleSoundChange(opt)}
                />
                <span class="theme-option-label">{soundOptionLabel(opt)}</span>
              </label>
              {#if opt.type !== 'None'}
                <button type="button" class="btn-secondary preview-btn" disabled={saving} onclick={() => handlePreview(opt)}>
                  {$t('notifications.previewButton')}
                </button>
              {/if}
            </div>
          {/each}

          <div class="sound-option-row">
            <label class="theme-option">
              <input
                type="radio"
                name="notif-sound"
                value="Custom"
                checked={settings.sound.type === 'Custom'}
                disabled={saving || selectingCustomSound}
                onchange={handleChooseCustomSound}
              />
              <span class="theme-option-label">
                {settings.sound.type === 'Custom'
                  ? $t('notifications.soundOptionCustomWithFile', {
                      values: { file: customSoundFileName(settings.sound.path) },
                    })
                  : $t('notifications.soundOptionCustom')}
              </span>
            </label>
            <button type="button" class="btn-secondary" disabled={selectingCustomSound} onclick={handleChooseCustomSound}>
              {selectingCustomSound ? $t('notifications.choosingFile') : $t('notifications.chooseFileButton')}
            </button>
            {#if settings.sound.type === 'Custom'}
              <button
                type="button"
                class="btn-secondary preview-btn"
                disabled={saving}
                onclick={() => settings && handlePreview(settings.sound)}
              >
                {$t('notifications.previewButton')}
              </button>
            {/if}
          </div>
        </div>
      </div>

      <hr class="notifications-divider" />

      <div class="mute-section" aria-labelledby="notif-mute-heading">
        <h3 id="notif-mute-heading" class="theme-subheading">{$t('notifications.muteSectionTitle')}</h3>
        <label class="mute-toggle">
          <input type="checkbox" checked={settings.global_mute} disabled={saving} onchange={handleMuteChange} />
          <span>{$t('notifications.muteLabel')}</span>
        </label>
        <p class="notifications-hint">{$t('notifications.muteHint')}</p>
      </div>

      <hr class="notifications-divider" />

      <div class="permission-section" aria-labelledby="notif-permission-heading">
        <h3 id="notif-permission-heading" class="theme-subheading">{$t('notifications.permissionSectionTitle')}</h3>
        <p class="permission-state">
          {$t('notifications.permissionStateLabel', { values: { state: permissionStateLabel(permissionState) } })}
        </p>
        <p class="notifications-hint">{$t('notifications.permissionHint')}</p>
      </div>

      {#if error}
        <p class="notifications-error">{error}</p>
      {/if}
    {:else}
      <p class="notifications-error">{error ?? $t('notifications.loadError')}</p>
    {/if}
  </div>
</SettingsCollapsibleSection>

<style>
  .notifications-settings {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .notifications-loading {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .theme-subheading {
    color: var(--text-primary);
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 8px 0;
  }

  .theme-label {
    display: block;
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-bottom: 8px;
  }

  .sound-options {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .sound-option-row {
    display: flex;
    align-items: center;
    gap: 12px;
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
    accent-color: var(--brand);
  }

  .theme-option-label {
    user-select: none;
  }

  .notifications-divider {
    width: 100%;
    border: 0;
    border-top: 1px solid var(--border-subtle);
    margin: 0;
  }

  .mute-section,
  .permission-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .mute-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 0.875rem;
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
  }

  .mute-toggle input {
    accent-color: var(--brand);
  }

  .permission-state {
    margin: 0;
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 600;
  }

  .notifications-hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .notifications-error {
    margin: 0;
    color: var(--danger, #e53e3e);
    font-size: 0.8125rem;
  }

  .btn-secondary {
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 0.8125rem;
    background: var(--bg-elevated);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    cursor: pointer;
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .preview-btn {
    flex-shrink: 0;
  }
</style>
