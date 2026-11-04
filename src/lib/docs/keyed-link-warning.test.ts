import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import {
  KEYED_LINK_WARNING_PREFIX,
  confirmKeyedLinkWarning,
  needsKeyedLinkWarning,
  textHasKeyedLink,
} from './keyed-link-warning';

const NPUB_A = 'npub1alice';
const NPUB_B = 'npub1bob';
const FRAGMENT_TEXT = 'Edit here: https://cryptpad.fr/pad/#/2/pad/edit/secret thanks';
const SECRET_TEXT = 'See https://example.com/a?secret=x.';

let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  setCurrentNpubForPersistence(NPUB_A);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCurrentNpubForPersistence(null);
});

describe('textHasKeyedLink', () => {
  it('detects fragment and secret-query URLs', () => {
    expect(textHasKeyedLink(FRAGMENT_TEXT)).toBe(true);
    expect(textHasKeyedLink(SECRET_TEXT)).toBe(true);
  });

  it('ignores plain, tracker-only, and empty-secret URLs', () => {
    expect(textHasKeyedLink('Plain https://example.com/a here')).toBe(false);
    expect(textHasKeyedLink('https://example.com/a?utm_source=x&fbclid=y')).toBe(false);
    expect(textHasKeyedLink('https://example.com/a?token=')).toBe(false);
    expect(textHasKeyedLink('https://example.com/a#')).toBe(false);
    expect(textHasKeyedLink('no links at all')).toBe(false);
  });
});

describe('needsKeyedLinkWarning', () => {
  it('warns for keyed links and not for plain ones', () => {
    expect(needsKeyedLinkWarning(FRAGMENT_TEXT)).toBe(true);
    expect(needsKeyedLinkWarning(SECRET_TEXT)).toBe(true);
    expect(needsKeyedLinkWarning('https://example.com/a')).toBe(false);
  });

  it('cancel (no confirm) leaves the flag unset and keeps warning', () => {
    expect(needsKeyedLinkWarning(FRAGMENT_TEXT)).toBe(true);
    expect(storage.size).toBe(0);
    expect(needsKeyedLinkWarning(FRAGMENT_TEXT)).toBe(true);
  });

  it('confirm sets an npub-scoped flag and later checks skip', () => {
    confirmKeyedLinkWarning();
    expect(storage.get(`${KEYED_LINK_WARNING_PREFIX}_${NPUB_A}`)).toBe('true');
    expect(needsKeyedLinkWarning(FRAGMENT_TEXT)).toBe(false);
    expect(needsKeyedLinkWarning(SECRET_TEXT)).toBe(false);
  });

  it('another npub on the same profile still warns', () => {
    confirmKeyedLinkWarning();
    setCurrentNpubForPersistence(NPUB_B);
    expect(needsKeyedLinkWarning(FRAGMENT_TEXT)).toBe(true);
  });

  it('warns without a persistence npub and confirm writes nothing', () => {
    setCurrentNpubForPersistence(null);
    confirmKeyedLinkWarning();
    expect(storage.size).toBe(0);
    expect(needsKeyedLinkWarning(FRAGMENT_TEXT)).toBe(true);
  });
});
