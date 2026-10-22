export function formatUnreadBadgeCount(count: number): string {
  if (count <= 0) return '';
  if (count > 99) return '99+';
  return String(count);
}

export function isScrollAtBottom(container: HTMLElement, thresholdPx = 100): boolean {
  return container.scrollHeight - container.scrollTop - container.clientHeight < thresholdPx;
}

/**
 * Messages appended after `seenId`. An unknown or missing id means the reader
 * has seen nothing in the list yet, so every message counts as new.
 */
export function countMessagesAfter(
  messages: readonly { id: string }[],
  seenId: string | null
): number {
  if (!seenId) return messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.id === seenId) return messages.length - 1 - i;
  }
  return messages.length;
}
