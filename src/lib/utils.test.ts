import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('combines conditional classes and keeps the last Tailwind conflict', () => {
    expect(cn('block px-2', { hidden: false }, ['px-4'])).toBe('block px-4');
  });
});
