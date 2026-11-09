/** Next tab index for ARIA tablist keys; null when the key is not handled. */
export function nextHubModeIndex(length: number, index: number, key: string): number | null {
  if (length <= 0) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % length;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + length) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return null;
}
