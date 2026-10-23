/**
 * Hold-to-record gesture state machine for voice messages.
 *
 * Pure reducer: the composer feeds pointer/keyboard/backend events in and runs
 * the returned effect (start or stop the native recorder, send or discard the
 * captured clip). Keeping it free of DOM and Tauri calls makes every gesture
 * path unit-testable.
 *
 * Gestures:
 * - Press and hold the mic, release to send.
 * - While holding, drag up past the lock threshold for hands-free recording.
 * - While holding, drag left past the cancel threshold to discard.
 * - Keyboard (or a click with no pointer hold) starts hands-free recording.
 * - Hands-free recording can be stopped into a preview, sent, or discarded.
 * - Leaving the conversation abandons whatever is in progress.
 */

/** Upward drag (px) that locks the recording so the pointer can be released. */
export const VOICE_LOCK_THRESHOLD_PX = 56;
/** Leftward drag (px) that cancels the recording. */
export const VOICE_CANCEL_THRESHOLD_PX = 96;
/** Clips shorter than this are discarded as accidental taps. */
export const VOICE_MIN_DURATION_MS = 600;
/** Recording stops into a preview at this length. */
export const VOICE_MAX_DURATION_MS = 5 * 60_000;

export type VoiceRecorderPhase =
  | 'idle'
  | 'starting'
  | 'holding'
  | 'locked'
  | 'finishing'
  | 'preview'
  | 'sending';

export type VoiceFinishIntent = 'send' | 'preview' | 'discard';

export interface VoiceRecorderState {
  phase: VoiceRecorderPhase;
  /** True when the recording follows a pointer hold, false for hands-free starts. */
  viaHold: boolean;
  /** Pointer position at press; drag offsets are measured from here. */
  origin: { x: number; y: number } | null;
  /** Current drag offset, clamped to the lock (up) and cancel (left) directions. */
  offset: { dx: number; dy: number };
  /** Timestamp (ms) when the native recorder confirmed it started. */
  startedAt: number | null;
  /** Release or cancel that arrived before the recorder finished starting. */
  pendingStop: 'release' | 'cancel' | null;
  /** What to do with the clip once the recorder stops. */
  intent: VoiceFinishIntent | null;
  /** Set when the last clip was discarded for being too short (drives a hint). */
  tooShort: boolean;
}

export type VoiceRecorderEvent =
  | { type: 'press'; x: number; y: number }
  | { type: 'activate' }
  | { type: 'started'; at: number }
  | { type: 'startFailed' }
  | { type: 'move'; x: number; y: number }
  | { type: 'release'; at: number }
  | { type: 'stop'; at: number }
  | { type: 'send'; at: number }
  | { type: 'cancel' }
  /** The composer moved to another conversation; never deliver this clip. */
  | { type: 'abandon' }
  | { type: 'tick'; at: number }
  | { type: 'finished'; ok: boolean }
  | { type: 'sent' }
  | { type: 'sendFailed' };

/**
 * Side effect the caller must run after a transition.
 * - `start`: begin native recording, then dispatch `started` / `startFailed`.
 * - `stop`: stop native recording, keep the bytes, then dispatch `finished`.
 * - `send`: send the kept bytes, then dispatch `sent` / `sendFailed`.
 * - `discard`: drop the kept bytes (and any preview URL).
 */
export type VoiceRecorderEffect = 'start' | 'stop' | 'send' | 'discard' | null;

export interface VoiceRecorderTransition {
  state: VoiceRecorderState;
  effect: VoiceRecorderEffect;
}

export const initialVoiceRecorderState: VoiceRecorderState = {
  phase: 'idle',
  viaHold: false,
  origin: null,
  offset: { dx: 0, dy: 0 },
  startedAt: null,
  pendingStop: null,
  intent: null,
  tooShort: false,
};

/** Phases where the microphone is live. */
export function isVoiceRecording(state: VoiceRecorderState): boolean {
  return state.phase === 'holding' || state.phase === 'locked';
}

/** Phases where the composer swaps the text field for recorder controls. */
export function isVoiceRecorderActive(state: VoiceRecorderState): boolean {
  return state.phase !== 'idle';
}

/** Elapsed recording time in ms, 0 when not recording. */
export function voiceElapsedMs(state: VoiceRecorderState, now: number): number {
  if (state.startedAt == null) return 0;
  return Math.max(0, now - state.startedAt);
}

function unchanged(state: VoiceRecorderState): VoiceRecorderTransition {
  return { state, effect: null };
}

function finish(state: VoiceRecorderState, intent: VoiceFinishIntent, tooShort = false): VoiceRecorderTransition {
  return {
    state: { ...state, phase: 'finishing', intent, tooShort, offset: { dx: 0, dy: 0 } },
    effect: 'stop',
  };
}

function finishUnlessTooShort(state: VoiceRecorderState, intent: VoiceFinishIntent, at: number): VoiceRecorderTransition {
  if (voiceElapsedMs(state, at) < VOICE_MIN_DURATION_MS) return finish(state, 'discard', true);
  return finish(state, intent);
}

function toIdle(tooShort = false): VoiceRecorderState {
  return { ...initialVoiceRecorderState, tooShort };
}

export function voiceRecorderTransition(
  state: VoiceRecorderState,
  event: VoiceRecorderEvent,
): VoiceRecorderTransition {
  switch (state.phase) {
    case 'idle': {
      if (event.type === 'press') {
        return {
          state: {
            ...initialVoiceRecorderState,
            phase: 'starting',
            viaHold: true,
            origin: { x: event.x, y: event.y },
          },
          effect: 'start',
        };
      }
      if (event.type === 'activate') {
        return {
          state: { ...initialVoiceRecorderState, phase: 'starting', viaHold: false },
          effect: 'start',
        };
      }
      return unchanged(state);
    }

    case 'starting': {
      if (event.type === 'started') {
        const started = { ...state, startedAt: event.at };
        if (state.pendingStop) {
          return finish(started, 'discard', state.pendingStop === 'release');
        }
        return { state: { ...started, phase: state.viaHold ? 'holding' : 'locked' }, effect: null };
      }
      if (event.type === 'startFailed') return { state: toIdle(), effect: null };
      if (event.type === 'release' && state.viaHold && !state.pendingStop) {
        return unchanged({ ...state, pendingStop: 'release' });
      }
      if (event.type === 'cancel' || event.type === 'abandon') return unchanged({ ...state, pendingStop: 'cancel' });
      return unchanged(state);
    }

    case 'holding': {
      if (event.type === 'move' && state.origin) {
        const dx = Math.min(0, event.x - state.origin.x);
        const dy = Math.min(0, event.y - state.origin.y);
        if (-dx >= VOICE_CANCEL_THRESHOLD_PX) return finish(state, 'discard');
        if (-dy >= VOICE_LOCK_THRESHOLD_PX) {
          return { state: { ...state, phase: 'locked', offset: { dx: 0, dy: 0 } }, effect: null };
        }
        return unchanged({ ...state, offset: { dx, dy } });
      }
      if (event.type === 'release') return finishUnlessTooShort(state, 'send', event.at);
      if (event.type === 'cancel' || event.type === 'abandon') return finish(state, 'discard');
      if (event.type === 'tick' && voiceElapsedMs(state, event.at) >= VOICE_MAX_DURATION_MS) {
        return finish(state, 'preview');
      }
      return unchanged(state);
    }

    case 'locked': {
      if (event.type === 'stop') return finishUnlessTooShort(state, 'preview', event.at);
      if (event.type === 'send') return finishUnlessTooShort(state, 'send', event.at);
      if (event.type === 'cancel' || event.type === 'abandon') return finish(state, 'discard');
      if (event.type === 'tick' && voiceElapsedMs(state, event.at) >= VOICE_MAX_DURATION_MS) {
        return finish(state, 'preview');
      }
      return unchanged(state);
    }

    case 'finishing': {
      if (event.type === 'abandon') return unchanged({ ...state, intent: 'discard', tooShort: false });
      if (event.type !== 'finished') return unchanged(state);
      if (!event.ok || state.intent === 'discard') {
        return { state: toIdle(state.tooShort), effect: event.ok ? 'discard' : null };
      }
      if (state.intent === 'send') {
        return { state: { ...state, phase: 'sending' }, effect: 'send' };
      }
      return { state: { ...state, phase: 'preview' }, effect: null };
    }

    case 'preview': {
      if (event.type === 'send') return { state: { ...state, phase: 'sending' }, effect: 'send' };
      if (event.type === 'cancel' || event.type === 'abandon') return { state: toIdle(), effect: 'discard' };
      return unchanged(state);
    }

    case 'sending': {
      // The send already targets the clip's own conversation; only its retry preview is dropped.
      if (event.type === 'abandon') return unchanged({ ...state, intent: 'discard' });
      if (event.type === 'sent') return { state: toIdle(), effect: 'discard' };
      // Keep the clip so a failed send can be retried or discarded from the preview.
      if (event.type === 'sendFailed') {
        if (state.intent === 'discard') return { state: toIdle(), effect: 'discard' };
        return { state: { ...state, phase: 'preview' }, effect: null };
      }
      return unchanged(state);
    }
  }
}
