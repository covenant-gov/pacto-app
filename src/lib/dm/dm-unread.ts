export function formatUnreadBadgeCount(count: number): string {
  if (count <= 0) return '';
  if (count > 99) return '99+';
  return String(count);
}

export function isScrollAtBottom(container: HTMLElement, thresholdPx = 100): boolean {
  return container.scrollHeight - container.scrollTop - container.clientHeight < thresholdPx;
}
