import { describe, it, expect } from 'vitest';
import { APP_WINDOW_TITLE_BASE, formatAppWindowTitle } from './window-title';

describe('formatAppWindowTitle', () => {
  it('returns Pacto when name is null', () => {
    expect(formatAppWindowTitle(null)).toBe(APP_WINDOW_TITLE_BASE);
  });

  it('returns Pacto when name is undefined or whitespace', () => {
    expect(formatAppWindowTitle(undefined)).toBe(APP_WINDOW_TITLE_BASE);
    expect(formatAppWindowTitle('')).toBe(APP_WINDOW_TITLE_BASE);
    expect(formatAppWindowTitle('   ')).toBe(APP_WINDOW_TITLE_BASE);
  });

  it('joins with interpunct when name is set', () => {
    expect(formatAppWindowTitle('alpha-test')).toBe('Pacto · alpha-test');
  });

  it('trims profile name before formatting', () => {
    expect(formatAppWindowTitle('  Iso  ')).toBe('Pacto · Iso');
  });

  it('preserves special characters in the profile name', () => {
    expect(formatAppWindowTitle('Al "Ace" O')).toBe('Pacto · Al "Ace" O');
  });
});
