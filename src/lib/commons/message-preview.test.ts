import { describe, expect, it } from 'vitest';
import { isCommonsMessageTruncated, truncateCommonsMessage } from './message-preview';

describe('truncateCommonsMessage', () => {
  it('returns short text unchanged', () => {
    expect(truncateCommonsMessage('hello')).toBe('hello');
  });

  it('cuts at a word boundary when possible', () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve';
    const out = truncateCommonsMessage(text, 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.endsWith(' ')).toBe(false);
    expect(isCommonsMessageTruncated(text, 30)).toBe(true);
  });
});
