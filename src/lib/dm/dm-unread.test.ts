import { describe, expect, it } from 'vitest';
import { countUnreadInThread, formatUnreadBadgeCount, isScrollAtBottom } from './dm-unread';

describe('countUnreadInThread', () => {
  it('returns zero for empty messages', () => {
    expect(countUnreadInThread([], '')).toBe(0);
  });

  it('counts all inbound messages when no last-read and no own message', () => {
    const msgs = [
      { id: 'a', mine: false },
      { id: 'b', mine: false },
      { id: 'c', mine: false },
    ];
    expect(countUnreadInThread(msgs, '')).toBe(3);
  });

  it('counts only messages newer than last-read id', () => {
    const msgs = [
      { id: 'a', mine: false },
      { id: 'b', mine: false },
      { id: 'c', mine: false },
    ];
    expect(countUnreadInThread(msgs, 'b')).toBe(1);
    expect(countUnreadInThread(msgs, 'a')).toBe(2);
  });

  it('stops at own message even if it appears before last-read id', () => {
    const msgs = [
      { id: 'a', mine: false },
      { id: 'b', mine: true },
      { id: 'c', mine: false },
    ];
    expect(countUnreadInThread(msgs, 'a')).toBe(1);
  });

  it('stops counting at the newest message when it is the last-read id', () => {
    expect(countUnreadInThread([{ id: 'x', mine: false }], 'x')).toBe(0);
  });

  it('returns zero when last-read id is not found and newest is own', () => {
    const msgs = [
      { id: 'a', mine: false },
      { id: 'b', mine: true },
    ];
    expect(countUnreadInThread(msgs, 'z')).toBe(0);
  });

  it('stops before own message when last-read id is missing', () => {
    const msgs = [
      { id: 'a', mine: false },
      { id: 'b', mine: false },
      { id: 'c', mine: true },
    ];
    expect(countUnreadInThread(msgs, 'z')).toBe(0);
  });
});

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
