import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { setCurrentNpubForPersistence } from './persistence-context';
import { eventClockHour12, eventTimeFormat } from './event-time-format';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem: vi.fn() });
  setCurrentNpubForPersistence(null);
});
afterEach(() => { setCurrentNpubForPersistence(null); vi.unstubAllGlobals(); });

describe('event clock preference', () => {
  it('persists and restores independent account choices, resets on logout', () => {
    const saved = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) });
    setCurrentNpubForPersistence('A');
    eventTimeFormat.set('12h');
    setCurrentNpubForPersistence('B');
    expect(get(eventTimeFormat)).toBe('system');
    eventTimeFormat.set('24h');
    setCurrentNpubForPersistence('A');
    expect(get(eventTimeFormat)).toBe('12h');
    setCurrentNpubForPersistence(null);
    expect(get(eventTimeFormat)).toBe('system');
    setCurrentNpubForPersistence('B');
    expect(get(eventTimeFormat)).toBe('24h');
  });
  it('uses system defaults for corrupt/unavailable storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'invalid', setItem: vi.fn() });
    setCurrentNpubForPersistence('A');
    expect(get(eventTimeFormat)).toBe('system');
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: vi.fn() });
    setCurrentNpubForPersistence('B');
    expect(get(eventTimeFormat)).toBe('system');
  });
  it('honors explicit formats independent of locale and resolves system', () => {
    expect(eventClockHour12('12h', 'es')).toBe(true);
    expect(eventClockHour12('24h', 'en-US')).toBe(false);
    expect(eventClockHour12('system', 'en-US')).toBe(true);
    expect(eventClockHour12('system', 'es-ES')).toBe(false);
  });
});
