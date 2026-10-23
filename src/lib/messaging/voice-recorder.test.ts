import { describe, it, expect } from 'vitest';
import {
  initialVoiceRecorderState,
  isVoiceRecorderActive,
  isVoiceRecording,
  voiceElapsedMs,
  voiceRecorderTransition,
  VOICE_CANCEL_THRESHOLD_PX,
  VOICE_LOCK_THRESHOLD_PX,
  VOICE_MAX_DURATION_MS,
  VOICE_MIN_DURATION_MS,
  type VoiceRecorderEffect,
  type VoiceRecorderEvent,
  type VoiceRecorderState,
} from './voice-recorder';

/** Runs events in order, returning the final state and every effect emitted. */
function run(events: VoiceRecorderEvent[], from: VoiceRecorderState = initialVoiceRecorderState) {
  let state = from;
  const effects: VoiceRecorderEffect[] = [];
  for (const event of events) {
    const next = voiceRecorderTransition(state, event);
    state = next.state;
    if (next.effect) effects.push(next.effect);
  }
  return { state, effects };
}

const T0 = 1_000_000;
const holding = (): VoiceRecorderEvent[] => [
  { type: 'press', x: 100, y: 100 },
  { type: 'started', at: T0 },
];

describe('voice recorder: hold to record', () => {
  it('press starts the recorder and waits in starting', () => {
    const { state, effects } = run([{ type: 'press', x: 10, y: 20 }]);
    expect(state.phase).toBe('starting');
    expect(state.viaHold).toBe(true);
    expect(state.origin).toEqual({ x: 10, y: 20 });
    expect(effects).toEqual(['start']);
  });

  it('started moves a held press into holding', () => {
    const { state } = run(holding());
    expect(state.phase).toBe('holding');
    expect(state.startedAt).toBe(T0);
    expect(isVoiceRecording(state)).toBe(true);
  });

  it('release after the minimum duration stops and then sends', () => {
    const { state, effects } = run([
      ...holding(),
      { type: 'release', at: T0 + VOICE_MIN_DURATION_MS + 1 },
    ]);
    expect(state.phase).toBe('finishing');
    expect(state.intent).toBe('send');
    expect(effects).toEqual(['start', 'stop']);

    const sent = run([{ type: 'finished', ok: true }, { type: 'sent' }], state);
    expect(sent.effects).toEqual(['send', 'discard']);
    expect(sent.state).toEqual(initialVoiceRecorderState);
  });

  it('a quick tap is discarded and flagged as too short', () => {
    const { state, effects } = run([
      ...holding(),
      { type: 'release', at: T0 + VOICE_MIN_DURATION_MS - 1 },
      { type: 'finished', ok: true },
    ]);
    expect(effects).toEqual(['start', 'stop', 'discard']);
    expect(state.phase).toBe('idle');
    expect(state.tooShort).toBe(true);
  });

  it('a release that beats the recorder start discards once it starts', () => {
    const { state, effects } = run([
      { type: 'press', x: 0, y: 0 },
      { type: 'release', at: T0 },
      { type: 'started', at: T0 + 5 },
    ]);
    expect(state.phase).toBe('finishing');
    expect(state.intent).toBe('discard');
    expect(state.tooShort).toBe(true);
    expect(effects).toEqual(['start', 'stop']);
  });

  it('a failed start returns to idle without effects', () => {
    const { state, effects } = run([{ type: 'press', x: 0, y: 0 }, { type: 'startFailed' }]);
    expect(state).toEqual(initialVoiceRecorderState);
    expect(effects).toEqual(['start']);
  });
});

describe('voice recorder: drag gestures', () => {
  it('tracks drag offsets, clamped to up and left', () => {
    const { state } = run([...holding(), { type: 'move', x: 130, y: 80 }]);
    expect(state.phase).toBe('holding');
    expect(state.offset).toEqual({ dx: 0, dy: -20 });
  });

  it('dragging up past the threshold locks the recording', () => {
    const { state, effects } = run([...holding(), { type: 'move', x: 100, y: 100 - VOICE_LOCK_THRESHOLD_PX }]);
    expect(state.phase).toBe('locked');
    expect(state.offset).toEqual({ dx: 0, dy: 0 });
    expect(effects).toEqual(['start']);
  });

  it('release after locking keeps recording', () => {
    const { state } = run([
      ...holding(),
      { type: 'move', x: 100, y: 0 },
      { type: 'release', at: T0 + 5_000 },
    ]);
    expect(state.phase).toBe('locked');
  });

  it('dragging left past the threshold cancels', () => {
    const { state, effects } = run([
      ...holding(),
      { type: 'move', x: 100 - VOICE_CANCEL_THRESHOLD_PX, y: 100 },
    ]);
    expect(state.phase).toBe('finishing');
    expect(state.intent).toBe('discard');
    expect(state.tooShort).toBe(false);
    expect(effects).toEqual(['start', 'stop']);
  });

  it('pointer cancel while holding discards', () => {
    const { state } = run([...holding(), { type: 'cancel' }, { type: 'finished', ok: true }]);
    expect(state).toEqual(initialVoiceRecorderState);
  });
});

describe('voice recorder: hands-free and preview', () => {
  const locked = (): VoiceRecorderEvent[] => [{ type: 'activate' }, { type: 'started', at: T0 }];

  it('keyboard activation records hands-free', () => {
    const { state, effects } = run(locked());
    expect(state.phase).toBe('locked');
    expect(state.viaHold).toBe(false);
    expect(effects).toEqual(['start']);
  });

  it('ignores release events in hands-free mode', () => {
    const { state } = run([{ type: 'activate' }, { type: 'release', at: T0 }, { type: 'started', at: T0 }]);
    expect(state.phase).toBe('locked');
  });

  it('stop goes to preview, then send delivers the clip', () => {
    const { state, effects } = run([
      ...locked(),
      { type: 'stop', at: T0 + 2_000 },
      { type: 'finished', ok: true },
    ]);
    expect(state.phase).toBe('preview');
    expect(effects).toEqual(['start', 'stop']);

    const sent = run([{ type: 'send', at: T0 + 9_000 }, { type: 'sent' }], state);
    expect(sent.effects).toEqual(['send', 'discard']);
    expect(sent.state.phase).toBe('idle');
  });

  it('send from locked skips the preview', () => {
    const { state, effects } = run([
      ...locked(),
      { type: 'send', at: T0 + 2_000 },
      { type: 'finished', ok: true },
    ]);
    expect(state.phase).toBe('sending');
    expect(effects).toEqual(['start', 'stop', 'send']);
  });

  it('a failed send falls back to the preview so nothing is lost', () => {
    const { state, effects } = run([
      ...locked(),
      { type: 'send', at: T0 + 2_000 },
      { type: 'finished', ok: true },
      { type: 'sendFailed' },
    ]);
    expect(state.phase).toBe('preview');
    expect(effects).not.toContain('discard');
  });

  it('discarding the preview releases the clip', () => {
    const { state, effects } = run([
      ...locked(),
      { type: 'stop', at: T0 + 2_000 },
      { type: 'finished', ok: true },
      { type: 'cancel' },
    ]);
    expect(state).toEqual(initialVoiceRecorderState);
    expect(effects.at(-1)).toBe('discard');
  });

  it('stopping too early discards instead of previewing', () => {
    const { state } = run([...locked(), { type: 'stop', at: T0 + 10 }, { type: 'finished', ok: true }]);
    expect(state.phase).toBe('idle');
    expect(state.tooShort).toBe(true);
  });

  it('hitting the max length stops into a preview', () => {
    const before = run([...locked(), { type: 'tick', at: T0 + VOICE_MAX_DURATION_MS - 1 }]);
    expect(before.state.phase).toBe('locked');
    const after = run([{ type: 'tick', at: T0 + VOICE_MAX_DURATION_MS }], before.state);
    expect(after.state.phase).toBe('finishing');
    expect(after.state.intent).toBe('preview');
    expect(after.effects).toEqual(['stop']);
  });

  it('a failed stop returns to idle without a discard effect', () => {
    const { state, effects } = run([...locked(), { type: 'send', at: T0 + 2_000 }, { type: 'finished', ok: false }]);
    expect(state.phase).toBe('idle');
    expect(effects).toEqual(['start', 'stop']);
  });
});

describe('voice recorder helpers', () => {
  it('reports activity and elapsed time', () => {
    expect(isVoiceRecorderActive(initialVoiceRecorderState)).toBe(false);
    const { state } = run(holding());
    expect(isVoiceRecorderActive(state)).toBe(true);
    expect(voiceElapsedMs(state, T0 + 1_500)).toBe(1_500);
    expect(voiceElapsedMs(state, T0 - 10)).toBe(0);
    expect(voiceElapsedMs(initialVoiceRecorderState, T0)).toBe(0);
  });

  it('ignores events that do not apply to the current phase', () => {
    const idle = voiceRecorderTransition(initialVoiceRecorderState, { type: 'release', at: T0 });
    expect(idle.state).toBe(initialVoiceRecorderState);
    expect(idle.effect).toBeNull();
  });
});
