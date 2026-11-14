/**
 * Public channel behavior for the channel chat shell: plaintext text-only send path and feature guards.
 */

import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { sendDmMessage, sendPublicChannelMessage, type SendDmMessageOptions } from '../api/nostr';

type VirtualBucket = SendDmMessageOptions['virtualBucket'];

export function isPublicChannelAccess(access: string | undefined): boolean {
  return access === 'public';
}

/** True when the action is unsupported on a public channel; reports why through `notify`. */
export function blockedOnPublicChannel(isPublic: boolean, notify: (message: string) => void): boolean {
  if (!isPublic) return false;
  notify(get(t)('messaging.channel.publicTextOnly'));
  return true;
}

/** Public channels send the raw body as plaintext kind 42; everything else sends the MLS content. */
export function sendChannelText(opts: {
  isPublic: boolean;
  groupId: string;
  body: string;
  mlsContent: string;
  repliedTo: string;
  virtualBucket: VirtualBucket;
}): Promise<boolean> {
  const { isPublic, groupId, body, mlsContent, repliedTo, virtualBucket } = opts;
  return isPublic
    ? sendPublicChannelMessage(groupId, body, repliedTo)
    : sendDmMessage(groupId, mlsContent, repliedTo, { virtualBucket });
}
