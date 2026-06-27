/** Matches backend unread walk: newest → oldest, stop at own message or last-read id. */
export function countUnreadInThread(
  messages: ReadonlyArray<{ id: string; mine?: boolean }>,
  lastReadId: string,
): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.mine) break;
    if (lastReadId && msg.id === lastReadId) break;
    count++;
  }
  return count;
}

export function formatUnreadBadgeCount(count: number): string {
  if (count <= 0) return '';
  if (count > 99) return '99+';
  return String(count);
}

export function isScrollAtBottom(container: HTMLElement, thresholdPx = 100): boolean {
  return container.scrollHeight - container.scrollTop - container.clientHeight < thresholdPx;
}
