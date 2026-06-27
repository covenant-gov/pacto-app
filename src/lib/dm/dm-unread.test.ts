import { describe, expect, it } from 'vitest';
import { countUnreadInThread, formatUnreadBadgeCount, isScrollAtBottom } from './dm-unread';

describe('countUnreadInThread', () => {
  const msgs = [
    { id: 'a', mine: false },
    { id: 'b', mine: false },
    { id: 'c', mine: true },
    { id: 'd', mine: false },
  ];

  it('counts inbound messages after last read, stopping at own message', () => {
    expect(countUnreadInThread(msgs, 'd')).toBe(0);
    expect(countUnreadInThread(msgs, 'b')).toBe(1);
    expect(countUnreadInThread(msgs, '')).toBe(1);
  });

  it('returns zero when last read is the newest inbound', () => {
    expect(countUnreadInThread([{ id: 'x', mine: false }], 'x')).toBe(0);
  });
});

describe('formatUnreadBadgeCount', () => {
  it('formats counts for badges', () => {
    expect(formatUnreadBadgeCount(0)).toBe('');
    expect(formatUnreadBadgeCount(3)).toBe('3');
    expect(formatUnreadBadgeCount(100)).toBe('99+');
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
});
