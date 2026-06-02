export const COMMONS_MESSAGE_PREVIEW_MAX = 140;

export function truncateCommonsMessage(
  text: string,
  max = COMMONS_MESSAGE_PREVIEW_MAX,
): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > max * 0.55 ? slice.slice(0, lastSpace) : slice;
  return cut.trimEnd();
}

export function isCommonsMessageTruncated(
  text: string,
  max = COMMONS_MESSAGE_PREVIEW_MAX,
): boolean {
  return text.length > max;
}
