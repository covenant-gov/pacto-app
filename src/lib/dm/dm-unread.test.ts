import { describe, expect, it } from 'vitest';
import { formatUnreadBadgeCount, isScrollAtBottom } from './dm-unread';

describe('formatUnreadBadgeCount', () => {
  it('formats counts for badges', () => {
    expect(formatUnreadBadgeCount(0)).toBe('');
    expect(formatUnreadBadgeCount(3)).toBe('3');
    expect(formatUnreadBadgeCount(99)).toBe('99');
    expect(formatUnreadBadgeCount(100)).toBe('99+');
    expect(formatUnreadBadgeCount(-1)).toBe('');
  });
});

describe('isScrollAtBottom', () => {
  it('detects when scroller is near the bottom', () => {
    const el = {
      scrollHeight: 1000,
      scrollTop: 850,
      clientHeight: 100,
    } as HTMLElement;
    expect(isScrollAtBottom(el)).toBe(true);
    expect(isScrollAtBottom({ ...el, scrollTop: 700 } as HTMLElement)).toBe(false);
  });

  it('uses the provided threshold', () => {
    const el = {
      scrollHeight: 1000,
      scrollTop: 821,
      clientHeight: 100,
    } as HTMLElement;
    expect(isScrollAtBottom(el, 80)).toBe(true);
    expect(isScrollAtBottom(el, 79)).toBe(false);
  });

  it('treats an exact-gap value as not at bottom', () => {
    const el = { scrollHeight: 500, scrollTop: 300, clientHeight: 100 } as HTMLElement;
    expect(isScrollAtBottom(el, 100)).toBe(false);
  });
});
