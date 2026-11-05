import { parseMessageContent } from './mentions';
import { replyQuoteExcerpt } from '../utils/url-tracking';

/** Quote chip: caption or text body, then the attachment label, then the generic fallback. */
export function replyTargetExcerpt(
  content: string | null | undefined,
  hasAttachment: boolean,
  stripTracking: boolean,
  labels: { attachment: string; fallback: string },
): string {
  const body = parseMessageContent(content).body.trim();
  if (body.length > 0) {
    const excerpt = replyQuoteExcerpt(body, stripTracking);
    if (excerpt) return excerpt;
  }
  if (hasAttachment) return labels.attachment;
  return labels.fallback;
}
