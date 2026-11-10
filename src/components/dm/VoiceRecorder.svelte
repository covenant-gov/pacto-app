<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import Mic from '@lucide/svelte/icons/mic';
  import Lock from '@lucide/svelte/icons/lock';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Square from '@lucide/svelte/icons/square';
  import Send from '@lucide/svelte/icons/send';
  import Play from '@lucide/svelte/icons/play';
  import Pause from '@lucide/svelte/icons/pause';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { startRecording, stopRecording } from '../../lib/api/voice';
  import {
    initialVoiceRecorderState,
    isVoiceRecorderActive,
    isVoiceRecording,
    voiceElapsedMs,
    voiceRecorderTransition,
    type VoiceRecorderEffect,
    type VoiceRecorderEvent,
  } from '../../lib/messaging/voice-recorder';
  import { formatVoiceDuration, wavDurationSeconds } from '../../lib/messaging/voice-message';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { showToast } from '../../stores/toast';

  interface Props {
    disabled?: boolean;
    /** Conversation the composer posts to (npub or MLS group id). */
    target: string;
    /** Sends the WAV clip to the conversation it was recorded in; resolve `false` to keep it for a retry. */
    onSend: (bytes: Uint8Array, target: string) => Promise<boolean>;
    /** True while the recorder owns the composer row. */
    active?: boolean;
  }

  let { disabled = false, target, onSend, active = $bindable(false) }: Props = $props();

  let rec = $state(initialVoiceRecorderState);
  let now = $state(Date.now());
  let clip: Uint8Array | null = null;
  // Conversation captured at record start; the clip never goes anywhere else.
  let boundTarget: string | null = null;
  let previewUrl: string | null = $state(null);
  let previewDuration = $state(0);
  let previewEl: HTMLAudioElement | undefined = $state();
  let previewPlaying = $state(false);
  let destroyed = false;

  let elapsedLabel = $derived(formatVoiceDuration(voiceElapsedMs(rec, now) / 1000));
  let recording = $derived(isVoiceRecording(rec));

  $effect(() => {
    active = isVoiceRecorderActive(rec);
  });

  // Switching conversations drops the recording or preview instead of carrying it over.
  $effect(() => {
    const current = target;
    untrack(() => {
      if (rec.phase !== 'idle' && boundTarget !== null && current !== boundTarget) dispatch({ type: 'abandon' });
    });
  });

  // Drives the elapsed timer and the max-length cutoff while the mic is live.
  $effect(() => {
    if (!recording) return;
    now = Date.now();
    const id = setInterval(() => {
      now = Date.now();
      dispatch({ type: 'tick', at: now });
    }, 250);
    return () => clearInterval(id);
  });

  function dispatch(event: VoiceRecorderEvent) {
    const { state: next, effect } = voiceRecorderTransition(rec, event);
    const tooShortNow = next.tooShort && next.phase === 'idle' && rec.phase !== 'idle';
    rec = next;
    runEffect(effect);
    if (rec.phase === 'preview') ensurePreview();
    if (tooShortNow) showToast(get(t)('messaging.voice.holdHint'));
  }

  function runEffect(effect: VoiceRecorderEffect) {
    if (effect === 'start') {
      boundTarget = target;
      startRecording()
        .then(() => {
          if (destroyed) {
            void stopRecording().catch(() => {});
            return;
          }
          dispatch({ type: 'started', at: Date.now() });
        })
        .catch((err: unknown) => {
          if (destroyed) return;
          dispatch({ type: 'startFailed' });
          showToast(getInvokeErrorMessage(err, get(t)('messaging.voice.micUnavailable')), undefined, undefined, {
            error: true,
          });
        });
    } else if (effect === 'stop') {
      stopRecording()
        .then((bytes) => {
          if (destroyed) return;
          clip = bytes;
          dispatch({ type: 'finished', ok: true });
        })
        .catch((err: unknown) => {
          if (destroyed) return;
          const discarding = rec.intent === 'discard';
          dispatch({ type: 'finished', ok: false });
          if (!discarding) {
            showToast(getInvokeErrorMessage(err, get(t)('messaging.voice.recordFailed')), undefined, undefined, {
              error: true,
            });
          }
        });
    } else if (effect === 'send') {
      const bytes = clip;
      const sendTo = boundTarget;
      if (!bytes || sendTo === null) {
        dispatch({ type: 'sendFailed' });
        return;
      }
      if (sendTo !== target) {
        dispatch({ type: 'abandon' });
        dispatch({ type: 'sendFailed' });
        return;
      }
      onSend(bytes, sendTo)
        .then((ok) => {
          if (!destroyed) dispatch(ok ? { type: 'sent' } : { type: 'sendFailed' });
        })
        .catch(() => {
          if (!destroyed) dispatch({ type: 'sendFailed' });
        });
    } else if (effect === 'discard') {
      releaseClip();
    }
  }

  /** Any clip kept for the preview (stopped by hand or after a failed send) must be playable. */
  function ensurePreview() {
    if (!clip || previewUrl) return;
    previewUrl = URL.createObjectURL(new Blob([new Uint8Array(clip)], { type: 'audio/wav' }));
    previewDuration = wavDurationSeconds(clip) ?? 0;
  }

  function releaseClip() {
    clip = null;
    boundTarget = null;
    previewEl?.pause();
    previewPlaying = false;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    previewDuration = 0;
  }

  onDestroy(() => {
    destroyed = true;
    const phase = rec.phase;
    if (phase === 'holding' || phase === 'locked' || phase === 'finishing') {
      void stopRecording().catch(() => {});
    }
    releaseClip();
  });

  function handlePointerDown(event: PointerEvent) {
    if (disabled || event.button !== 0 || rec.phase !== 'idle') return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    dispatch({ type: 'press', x: event.clientX, y: event.clientY });
  }

  function handlePointerMove(event: PointerEvent) {
    if (rec.phase !== 'holding') return;
    dispatch({ type: 'move', x: event.clientX, y: event.clientY });
  }

  function handlePointerUp() {
    dispatch({ type: 'release', at: Date.now() });
  }

  function handlePointerCancel() {
    if (rec.phase === 'holding' || rec.phase === 'starting') dispatch({ type: 'cancel' });
  }

  /** Keyboard activation (no pointer) starts hands-free recording. */
  function handleMicClick(event: MouseEvent) {
    if (disabled || event.detail !== 0) return;
    dispatch({ type: 'activate' });
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && rec.phase !== 'idle' && rec.phase !== 'sending' && rec.phase !== 'finishing') {
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: 'cancel' });
    }
  }

  function togglePreview() {
    if (!previewEl) return;
    if (previewEl.paused) void previewEl.play().catch(() => {});
    else previewEl.pause();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="voice-recorder" class:active={rec.phase !== 'idle'}>
  {#if rec.phase !== 'idle'}
    <div class="voice-bar" role="group" aria-label={$t('messaging.voice.recorderAria')}>
      {#if rec.phase === 'preview' || rec.phase === 'sending'}
        <button
          type="button"
          class="voice-icon-btn danger"
          onclick={() => dispatch({ type: 'cancel' })}
          disabled={rec.phase === 'sending'}
          aria-label={$t('messaging.voice.discard')}
          title={$t('messaging.voice.discard')}
        >
          <Trash2 size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          class="voice-icon-btn"
          onclick={togglePreview}
          disabled={!previewUrl}
          aria-label={previewPlaying ? $t('messaging.voice.pause') : $t('messaging.voice.playPreview')}
          title={previewPlaying ? $t('messaging.voice.pause') : $t('messaging.voice.playPreview')}
        >
          {#if previewPlaying}
            <Pause size={18} aria-hidden="true" />
          {:else}
            <Play size={18} aria-hidden="true" />
          {/if}
        </button>
        <span class="voice-time">{formatVoiceDuration(previewDuration)}</span>
        <span class="voice-status">
          {rec.phase === 'sending' ? $t('messaging.voice.sending') : $t('messaging.voice.previewLabel')}
        </span>
        {#if previewUrl}
          <audio
            bind:this={previewEl}
            src={previewUrl}
            preload="auto"
            onplay={() => (previewPlaying = true)}
            onpause={() => (previewPlaying = false)}
            onended={() => (previewPlaying = false)}
          ></audio>
        {/if}
      {:else}
        <span class="voice-dot" class:live={recording} aria-hidden="true"></span>
        <span class="voice-time" aria-live="off">{elapsedLabel}</span>
        {#if rec.phase === 'locked'}
          <span class="voice-status">{$t('messaging.voice.recordingLocked')}</span>
        {:else if rec.phase === 'finishing'}
          <span class="voice-status">
            <span class="voice-spin"><LoaderCircle size={14} aria-hidden="true" /></span>
          </span>
        {:else}
          <span class="voice-cancel-hint" style="transform: translateX({rec.offset.dx}px)">
            <ChevronLeft size={16} aria-hidden="true" />
            {$t('messaging.voice.slideToCancel')}
          </span>
        {/if}
      {/if}

      <span class="sr-only" aria-live="polite">
        {#if rec.phase === 'holding'}{$t('messaging.voice.recordingHeldAnnounce')}{:else if rec.phase === 'locked'}{$t('messaging.voice.recordingLockedAnnounce')}{:else if rec.phase === 'preview'}{$t('messaging.voice.previewAnnounce')}{/if}
      </span>

      {#if rec.phase === 'locked'}
        <button
          type="button"
          class="voice-icon-btn danger"
          onclick={() => dispatch({ type: 'cancel' })}
          aria-label={$t('messaging.voice.discard')}
          title={$t('messaging.voice.discard')}
        >
          <Trash2 size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          class="voice-icon-btn"
          onclick={() => dispatch({ type: 'stop', at: Date.now() })}
          aria-label={$t('messaging.voice.stopAndPreview')}
          title={$t('messaging.voice.stopAndPreview')}
        >
          <Square size={16} aria-hidden="true" />
        </button>
      {/if}
    </div>
  {/if}

  {#if rec.phase === 'locked' || rec.phase === 'preview' || rec.phase === 'sending'}
    <button
      type="button"
      class="voice-send-btn"
      onclick={() => dispatch({ type: 'send', at: Date.now() })}
      disabled={rec.phase === 'sending'}
      aria-label={$t('messaging.voice.send')}
      title={$t('messaging.voice.send')}
    >
      {#if rec.phase === 'sending'}
        <span class="voice-spin"><LoaderCircle size={20} aria-hidden="true" /></span>
      {:else}
        <Send size={20} aria-hidden="true" />
      {/if}
    </button>
  {:else}
    <div class="voice-mic-wrap">
      {#if rec.phase === 'holding'}
        <span class="voice-lock-hint" style="transform: translateY({rec.offset.dy}px)" aria-hidden="true">
          <Lock size={14} />
          <ChevronUp size={14} />
        </span>
      {/if}
      <button
        type="button"
        class="voice-mic-btn"
        class:recording={rec.phase === 'starting' || rec.phase === 'holding'}
        {disabled}
        aria-label={$t('messaging.voice.record')}
        title={$t('messaging.voice.recordHint')}
        onpointerdown={handlePointerDown}
        onpointermove={handlePointerMove}
        onpointerup={handlePointerUp}
        onpointercancel={handlePointerCancel}
        onclick={handleMicClick}
        oncontextmenu={(e) => e.preventDefault()}
      >
        <Mic size={20} aria-hidden="true" />
      </button>
    </div>
  {/if}
</div>

<style>
  .voice-recorder {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .voice-recorder.active {
    flex: 1 1 auto;
    min-width: 0;
  }

  .voice-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 44px;
    overflow: hidden;
  }

  .voice-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text-muted);
    flex-shrink: 0;
  }

  .voice-dot.live {
    background: var(--danger);
    animation: voice-pulse 1.2s ease-in-out infinite;
  }

  .voice-time {
    font-family: var(--font-mono-family);
    font-variant-numeric: tabular-nums;
    font-size: 0.9375rem;
    color: var(--text-primary);
    flex-shrink: 0;
  }

  .voice-status {
    display: inline-flex;
    align-items: center;
    font-size: 0.875rem;
    color: var(--text-muted);
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .voice-cancel-hint {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin: 0 auto;
    font-size: 0.875rem;
    color: var(--text-muted);
    white-space: nowrap;
    transition: transform 0.05s linear;
  }

  .voice-icon-btn,
  .voice-mic-btn,
  .voice-send-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    min-width: 32px;
    min-height: 32px;
    padding: 4px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
  }

  .voice-icon-btn:hover:not(:disabled),
  .voice-mic-btn:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--code-border);
  }

  .voice-icon-btn.danger:hover:not(:disabled) {
    color: var(--danger);
  }

  .voice-icon-btn:disabled,
  .voice-mic-btn:disabled,
  .voice-send-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .voice-icon-btn:focus-visible,
  .voice-mic-btn:focus-visible,
  .voice-send-btn:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  .voice-mic-wrap {
    position: relative;
    display: inline-flex;
  }

  .voice-mic-btn {
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .voice-mic-btn.recording {
    color: var(--on-brand);
    background: var(--brand);
    border-radius: 50%;
    transform: scale(1.15);
  }

  .voice-lock-hint {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 50%;
    margin-left: -14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: 28px;
    padding: 6px 0;
    border-radius: 14px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    color: var(--text-muted);
    pointer-events: none;
  }

  .voice-send-btn {
    color: var(--brand);
  }

  .voice-send-btn:hover:not(:disabled) {
    background: var(--code-border);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .voice-spin {
    display: inline-flex;
    animation: voice-spin 0.9s linear infinite;
  }

  @keyframes voice-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }

  @keyframes voice-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .voice-dot.live,
    .voice-spin {
      animation: none;
    }
    .voice-cancel-hint {
      transition: none;
    }
  }
</style>
