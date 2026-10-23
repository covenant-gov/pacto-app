<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import Play from '@lucide/svelte/icons/play';
  import Pause from '@lucide/svelte/icons/pause';
  import Captions from '@lucide/svelte/icons/captions';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import type { Attachment } from '../../stores/dm';
  import { estimateVoiceDurationFromSize, formatVoiceDuration } from '../../lib/messaging/voice-message';
  import { shouldAutoTranscribe } from '../../lib/messaging/voice-transcription';
  import { ensurePlatformFeatures } from '../../stores/platform-features';
  import { voiceSettings } from '../../stores/voice-settings';
  import {
    ensureWhisperModelsLoaded,
    requestTranscription,
    transcriptionState,
    voiceTranscripts,
  } from '../../stores/voice-transcription';

  interface Props {
    attachment: Attachment;
    /** Playable local source once the clip is downloaded and decrypted. */
    src?: string;
    /** True while the encrypted clip is being fetched. */
    downloading?: boolean;
    /** Fetches and decrypts the clip; `src` arrives via a later prop update. */
    onRequestDownload: () => void | Promise<void>;
  }

  let { attachment, src, downloading = false, onRequestDownload }: Props = $props();

  let audioEl: HTMLAudioElement | undefined = $state();
  let playing = $state(false);
  let currentTime = $state(0);
  let loadedDuration = $state(0);
  let playRequested = $state(false);
  let transcribeRequested = $state(false);

  let duration = $derived(loadedDuration > 0 ? loadedDuration : estimateVoiceDurationFromSize(attachment.size));
  let progress = $derived(duration > 0 ? Math.min(1, currentTime / duration) : 0);
  let timeLabel = $derived(
    playing || currentTime > 0
      ? `${formatVoiceDuration(currentTime)} / ${formatVoiceDuration(duration)}`
      : formatVoiceDuration(duration),
  );
  let onDisk = $derived(Boolean(src) && Boolean(attachment.path));
  let transcript = $derived($voiceTranscripts[attachment.id]);
  let canTranscribe = $derived($transcriptionState.availability === 'ready');

  onMount(() => {
    void ensurePlatformFeatures().then(() => ensureWhisperModelsLoaded());
  });

  // Start playback once a requested download lands.
  $effect(() => {
    if (playRequested && src && audioEl) {
      playRequested = false;
      void audioEl.play().catch(() => {});
    }
  });

  // Manual transcription waits for the clip to be local; auto-transcription follows the setting.
  $effect(() => {
    if (!onDisk) return;
    const wanted =
      (transcribeRequested && canTranscribe && transcript?.status !== 'pending') ||
      shouldAutoTranscribe({
        availability: $transcriptionState.availability,
        autoTranscribe: $voiceSettings.autoTranscribe,
        onDisk,
        hasTranscriptEntry: transcript != null,
      });
    if (wanted) {
      transcribeRequested = false;
      requestTranscription(attachment.id, attachment.path);
    }
  });

  function togglePlay() {
    if (!src || !audioEl) {
      playRequested = true;
      if (!downloading) void onRequestDownload();
      return;
    }
    if (audioEl.paused) void audioEl.play().catch(() => {});
    else audioEl.pause();
  }

  function handleSeek(event: Event) {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (!audioEl || !Number.isFinite(value)) return;
    audioEl.currentTime = value;
    currentTime = value;
  }

  function handleLoadedMetadata() {
    const d = audioEl?.duration ?? 0;
    if (Number.isFinite(d) && d > 0) loadedDuration = d;
  }

  function handleTranscribe() {
    transcribeRequested = true;
    if (!onDisk && !downloading) void onRequestDownload();
  }
</script>

<div class="voice-message">
  <div class="voice-row">
    <button
      type="button"
      class="voice-play"
      onclick={togglePlay}
      aria-label={playing ? $t('messaging.voice.pause') : $t('messaging.voice.play')}
      title={playing ? $t('messaging.voice.pause') : $t('messaging.voice.play')}
      disabled={downloading && !src}
    >
      {#if downloading && !src}
        <span class="voice-spin"><LoaderCircle size={18} aria-hidden="true" /></span>
      {:else if playing}
        <Pause size={18} aria-hidden="true" />
      {:else}
        <Play size={18} aria-hidden="true" />
      {/if}
    </button>

    <input
      class="voice-seek"
      type="range"
      min="0"
      max={duration || 0}
      step="0.1"
      value={currentTime}
      disabled={!src}
      style="--voice-progress: {progress * 100}%"
      oninput={handleSeek}
      aria-label={$t('messaging.voice.seekAria')}
      aria-valuetext={timeLabel}
    />

    <span class="voice-time">{timeLabel}</span>

    {#if canTranscribe && (!transcript || transcript.status === 'error')}
      <button
        type="button"
        class="voice-transcribe"
        onclick={handleTranscribe}
        disabled={transcribeRequested}
        aria-label={transcript?.status === 'error' ? $t('messaging.voice.retryTranscribe') : $t('messaging.voice.transcribe')}
        title={transcript?.status === 'error' ? $t('messaging.voice.retryTranscribe') : $t('messaging.voice.transcribe')}
      >
        <Captions size={18} aria-hidden="true" />
      </button>
    {/if}
  </div>

  {#if transcript?.status === 'pending'}
    <p class="voice-transcript muted" role="status">
      <span class="voice-spin"><LoaderCircle size={14} aria-hidden="true" /></span>
      {$t('messaging.voice.transcribing')}
    </p>
  {:else if transcript?.status === 'done'}
    <p class="voice-transcript" class:muted={!transcript.text}>
      {transcript.text || $t('messaging.voice.noSpeech')}
    </p>
  {:else if transcript?.status === 'error'}
    <p class="voice-transcript error" role="alert">{$t('messaging.voice.transcribeFailed')}</p>
  {/if}

  {#if src}
    <audio
      bind:this={audioEl}
      {src}
      preload="metadata"
      onplay={() => (playing = true)}
      onpause={() => (playing = false)}
      onended={() => {
        playing = false;
        currentTime = 0;
      }}
      ontimeupdate={() => (currentTime = audioEl?.currentTime ?? 0)}
      onloadedmetadata={handleLoadedMetadata}
    ></audio>
  {/if}
</div>

<style>
  .voice-message {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: min(340px, 100%);
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
  }

  .voice-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .voice-play {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    border: none;
    border-radius: 50%;
    background: var(--brand);
    color: var(--on-brand);
    cursor: pointer;
  }

  .voice-play:disabled {
    cursor: progress;
    opacity: 0.8;
  }

  .voice-play:focus-visible,
  .voice-transcribe:focus-visible,
  .voice-seek:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  .voice-seek {
    flex: 1 1 auto;
    min-width: 60px;
    height: 4px;
    margin: 0;
    border-radius: 2px;
    appearance: none;
    background: linear-gradient(
      to right,
      var(--brand) 0 var(--voice-progress),
      var(--border-subtle) var(--voice-progress) 100%
    );
    cursor: pointer;
  }

  .voice-seek:disabled {
    cursor: default;
  }

  .voice-seek::-webkit-slider-thumb {
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--brand);
  }

  .voice-time {
    flex-shrink: 0;
    font-family: var(--font-mono-family);
    font-variant-numeric: tabular-nums;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .voice-transcribe {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    min-width: 28px;
    min-height: 28px;
    padding: 4px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }

  .voice-transcribe:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .voice-transcribe:disabled {
    opacity: 0.5;
    cursor: progress;
  }

  .voice-transcript {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--text-secondary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .voice-transcript.muted {
    color: var(--text-muted);
    font-style: italic;
  }

  .voice-transcript.error {
    color: var(--danger);
  }

  .voice-spin {
    display: inline-flex;
    animation: voice-spin 0.9s linear infinite;
  }

  @keyframes voice-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .voice-spin {
      animation: none;
    }
  }
</style>
