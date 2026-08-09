import { describe, expect, it } from 'vitest';
import { validateShortcode } from './sticker-pack-validation';

describe('validateShortcode', () => {
  it('rejects an empty shortcode', () => {
    expect(validateShortcode({ id: 'a', shortcode: '' }, [])).toBe('empty');
  });

  it('rejects a whitespace-only shortcode', () => {
    expect(validateShortcode({ id: 'a', shortcode: '   ' }, [])).toBe('empty');
  });

  it('rejects a shortcode duplicated elsewhere in the pack', () => {
    const entries = [
      { id: 'a', shortcode: 'thumbsup' },
      { id: 'b', shortcode: 'wave' },
    ];
    expect(validateShortcode({ id: 'b', shortcode: 'thumbsUp' }, entries)).toBe('duplicate');
  });

  it('does not flag an entry as a duplicate of itself', () => {
    const entries = [{ id: 'a', shortcode: 'thumbsup' }];
    expect(validateShortcode({ id: 'a', shortcode: 'thumbsup' }, entries)).toBeNull();
  });

  it('accepts a unique, non-empty shortcode', () => {
    const entries = [{ id: 'a', shortcode: 'thumbsup' }];
    expect(validateShortcode({ id: 'b', shortcode: 'wave' }, entries)).toBeNull();
  });

  it('trims surrounding whitespace before comparing', () => {
    const entries = [{ id: 'a', shortcode: 'thumbsup' }];
    expect(validateShortcode({ id: 'b', shortcode: '  thumbsup  ' }, entries)).toBe('duplicate');
  });
});
