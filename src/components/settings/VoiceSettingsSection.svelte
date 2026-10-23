<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import { deleteWhisperModel, downloadWhisperModel } from '../../lib/api/voice';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { ensurePlatformFeatures, platformFeatures } from '../../stores/platform-features';
  import { updateVoiceSettings, voiceSettings } from '../../stores/voice-settings';
  import {
    clearWhisperDownloadProgress,
    refreshWhisperModels,
    transcriptionState,
    whisperDownloadProgress,
    whisperModels,
  } from '../../stores/voice-transcription';

  /** Short quality/speed labels per model id; unknown ids fall back to the backend name. */
  const MODEL_LABEL_KEYS: Record<string, string> = {
    tiny: 'settings.voiceModelTiny',
    base: 'settings.voiceModelBase',
    small: 'settings.voiceModelSmall',
    medium: 'settings.voiceModelMedium',
    'large-v3': 'settings.voiceModelLarge',
  };

  let downloading = $state<string | null>(null);
  let deleting = $state<string | null>(null);
  let error = $state<string | null>(null);

  let supported = $derived($platformFeatures?.transcription === true);
  let activeModel = $derived($transcriptionState.model);
  let hasModel = $derived($transcriptionState.availability === 'ready');

  onMount(() => {
    void ensurePlatformFeatures().then(() => refreshWhisperModels());
  });

  function modelLabel(name: string, fallback: string): string {
    const key = MODEL_LABEL_KEYS[name];
    return key ? $t(key) : fallback;
  }

  async function handleDownload(name: string): Promise<void> {
    if (downloading) return;
    downloading = name;
    error = null;
    try {
      await downloadWhisperModel(name);
      await refreshWhisperModels();
      if (!get(voiceSettings).model) updateVoiceSettings({ model: name });
    } catch (e) {
      error = getInvokeErrorMessage(e, $t('settings.voiceDownloadError'));
    } finally {
      clearWhisperDownloadProgress(name);
      downloading = null;
    }
  }

  async function handleDelete(name: string): Promise<void> {
    if (deleting) return;
    deleting = name;
    error = null;
    try {
      await deleteWhisperModel(name);
      await refreshWhisperModels();
      if (get(voiceSettings).model === name) updateVoiceSettings({ model: null });
    } catch (e) {
      error = getInvokeErrorMessage(e, $t('settings.voiceDeleteError'));
    } finally {
      deleting = null;
    }
  }
</script>

{#if supported}
  <hr class="voice-divider" />

  <section class="voice-settings" aria-labelledby="voice-settings-heading">
    <h3 id="voice-settings-heading" class="voice-heading">{$t('settings.voiceTitle')}</h3>
    <p class="voice-description">{$t('settings.voiceDescription')}</p>

    <div class="voice-models" role="radiogroup" aria-label={$t('settings.voiceModelLabel')}>
      {#each $whisperModels as entry (entry.model.name)}
        {@const name = entry.model.name}
        {@const progress = $whisperDownloadProgress[name]}
        <div class="voice-model" class:active={activeModel === name}>
          <label class="voice-model-pick">
            <input
              type="radio"
              name="voice-model"
              value={name}
              checked={activeModel === name}
              disabled={!entry.downloaded}
              onchange={() => updateVoiceSettings({ model: name })}
            />
            <span class="voice-model-text">
              <span class="voice-model-name">{name}</span>
              <span class="voice-model-meta">
                {modelLabel(name, entry.model.display_name)} · {$t('settings.voiceModelSize', { values: { size: entry.model.size } })}
              </span>
            </span>
          </label>
          {#if entry.downloaded}
            <button
              type="button"
              class="voice-model-action"
              disabled={deleting === name}
              onclick={() => handleDelete(name)}
            >
              {deleting === name ? $t('settings.voiceDeleting') : $t('settings.voiceDelete')}
            </button>
          {:else}
            <button
              type="button"
              class="voice-model-action"
              disabled={downloading !== null}
              onclick={() => handleDownload(name)}
            >
              {#if downloading === name}
                {progress != null
                  ? $t('settings.voiceDownloadingPercent', { values: { percent: progress } })
                  : $t('settings.voiceDownloading')}
              {:else}
                {$t('settings.voiceDownload')}
              {/if}
            </button>
          {/if}
        </div>
      {:else}
        <p class="voice-description">{$t('settings.voiceModelsLoading')}</p>
      {/each}
    </div>

    <label class="voice-toggle">
      <input
        type="checkbox"
        checked={$voiceSettings.autoTranscribe}
        disabled={!hasModel}
        onchange={(e) => updateVoiceSettings({ autoTranscribe: (e.currentTarget as HTMLInputElement).checked })}
      />
      <span>{$t('settings.voiceAutoTranscribeLabel')}</span>
    </label>
    <p class="voice-toggle-description">{$t('settings.voiceAutoTranscribeDescription')}</p>

    <label class="voice-toggle">
      <input
        type="checkbox"
        checked={$voiceSettings.useGpu}
        onchange={(e) => updateVoiceSettings({ useGpu: (e.currentTarget as HTMLInputElement).checked })}
      />
      <span>{$t('settings.voiceUseGpuLabel')}</span>
    </label>
    <p class="voice-toggle-description">{$t('settings.voiceUseGpuDescription')}</p>

    {#if error}
      <p class="voice-error" role="alert">{error}</p>
    {/if}
  </section>
{/if}

<style>
  .voice-divider {
    width: 100%;
    margin: 0;
    border: none;
    border-top: 1px solid var(--border-subtle);
  }

  .voice-settings {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .voice-heading {
    color: var(--text-primary);
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 8px 0;
  }

  .voice-description,
  .voice-toggle-description {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .voice-models {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    max-width: 520px;
  }

  .voice-model {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-elevated);
  }

  .voice-model.active {
    border-color: var(--brand);
  }

  .voice-model-pick {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    cursor: pointer;
  }

  .voice-model-pick input {
    accent-color: var(--brand);
  }

  .voice-model-pick input:disabled + .voice-model-text {
    opacity: 0.7;
  }

  .voice-model-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .voice-model-name {
    font-family: var(--font-mono-family);
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .voice-model-meta {
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .voice-model-action {
    flex-shrink: 0;
    min-height: 28px;
    padding: 4px 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .voice-model-action:hover:not(:disabled) {
    color: var(--text-primary);
  }

  .voice-model-action:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .voice-model-action:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  .voice-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 0.875rem;
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
  }

  .voice-toggle input {
    accent-color: var(--brand);
  }

  .voice-toggle input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .voice-error {
    margin: 0;
    color: var(--danger);
    font-size: 0.8125rem;
  }
</style>
