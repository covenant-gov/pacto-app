import {
  parseChannelInSquadMessage,
  parseSquadInviteMessage,
  type NostrProfile,
  type SquadInvitePayload,
} from '../api/nostr';
import { parseSquadInviteAccepted } from '../squad/squad-outbound-invite';
import {
  parseWalletPeerInfoDecline,
  parseWalletPeerInfoGrant,
  parseWalletPeerInfoRequest,
  parseWalletTxAnnouncement,
  parseWalletTxRequest,
  type WalletPeerInfoRequestPayload,
  type WalletTxAnnouncementPayload,
  type WalletTxRequestPayload,
} from '../wallet/dm-messages';
import {
  parseBotJoinDm,
  parseBotJoinResponseDm,
  type SquadBotJoinDmDto,
  type SquadBotJoinResponseDmDto,
} from '../squad/squad-join-mls';
import { summarizeStructuredMessageContent, type MessageFormatter } from '../messaging/structured-content-notice';
import { getProfileAvatarSrc, getProfileDisplayName } from '../utils/profile';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import {
  isPactoAppThreadId,
  resolveInviteInviterNpub,
  type PactoAppInboxEntry,
} from '../pacto-app-inbox';
import type { DmMessage } from '../../stores/dm';

export type ChannelInSquadPayload = NonNullable<ReturnType<typeof parseChannelInSquadMessage>>;
export type WalletPeerInfoGrantPayload = NonNullable<ReturnType<typeof parseWalletPeerInfoGrant>>;
export type WalletPeerInfoDeclinePayload = NonNullable<ReturnType<typeof parseWalletPeerInfoDecline>>;

export type DmMessagePresentation =
  | { kind: 'local-announcement' }
  | { kind: 'channel-in-squad'; payload: ChannelInSquadPayload }
  | { kind: 'squad-invite'; payload: SquadInvitePayload }
  | { kind: 'squad-pair-invite'; payload: SquadInvitePayload }
  | { kind: 'wallet-peer-info-request'; payload: WalletPeerInfoRequestPayload }
  | { kind: 'wallet-peer-info-grant'; payload: WalletPeerInfoGrantPayload }
  | { kind: 'wallet-peer-info-decline'; payload: WalletPeerInfoDeclinePayload }
  | { kind: 'wallet-tx-request'; payload: WalletTxRequestPayload }
  | { kind: 'wallet-tx-announcement'; payload: WalletTxAnnouncementPayload }
  | { kind: 'bot-join-response'; payload: SquadBotJoinResponseDmDto }
  | { kind: 'bot-join-dm'; payload: SquadBotJoinDmDto }
  | { kind: 'structured-notice'; text: string }
  | { kind: 'plain' };

export function resolveDmMessagePresentation(msg: DmMessage): DmMessagePresentation {
  const tFn = get(t);
  if (msg.is_local_announcement) return { kind: 'local-announcement' };
  const content = msg.content ?? '';
  // Channel joins are under-the-hood; never show as invite cards.
  if (parseChannelInSquadMessage(content)) {
    return { kind: 'structured-notice', text: 'Channel join' };
  }
  if (parseSquadInviteAccepted(content)) {
    return { kind: 'structured-notice', text: 'Squad join update' };
  }
  const invite = parseSquadInviteMessage(content);
  if (invite) {
    return invite.kind === 'squad-pair'
      ? { kind: 'squad-pair-invite', payload: invite }
      : { kind: 'squad-invite', payload: invite };
  }
  const walletPeerInfoRequest = parseWalletPeerInfoRequest(content);
  if (walletPeerInfoRequest) return { kind: 'wallet-peer-info-request', payload: walletPeerInfoRequest };
  const walletPeerInfoGrant = parseWalletPeerInfoGrant(content);
  if (walletPeerInfoGrant) return { kind: 'wallet-peer-info-grant', payload: walletPeerInfoGrant };
  const walletPeerInfoDecline = parseWalletPeerInfoDecline(content);
  if (walletPeerInfoDecline) return { kind: 'wallet-peer-info-decline', payload: walletPeerInfoDecline };
  const walletTxRequest = parseWalletTxRequest(content);
  if (walletTxRequest) return { kind: 'wallet-tx-request', payload: walletTxRequest };
  const walletTxAnnouncement = parseWalletTxAnnouncement(content);
  if (walletTxAnnouncement) return { kind: 'wallet-tx-announcement', payload: walletTxAnnouncement };
  const botJoinResponse = parseBotJoinResponseDm(content);
  if (botJoinResponse) return { kind: 'bot-join-response', payload: botJoinResponse };
  const botJoinDm = parseBotJoinDm(content);
  if (botJoinDm) return { kind: 'bot-join-dm', payload: botJoinDm };
  const structuredNotice = summarizeStructuredMessageContent(content, tFn);
  if (structuredNotice) return { kind: 'structured-notice', text: structuredNotice };
  return { kind: 'plain' };
}

export function inviteInviterNpub(msg: DmMessage, threadId: string): string | null {
  if (isPactoAppThreadId(threadId)) {
    const entry = msg as PactoAppInboxEntry;
    if (entry.inviterNpub?.trim()) return entry.inviterNpub.trim();
  }
  const content = msg.content ?? '';
  const resolved = resolveInviteInviterNpub(msg, threadId, content);
  return resolved?.startsWith('npub1') ? resolved : null;
}

export function getInviterDisplayFromNpub(
  inviterNpub: string | null | undefined,
  profilesMap: Record<string, NostrProfile | undefined>,
  tFn: MessageFormatter = get(t)
): { inviterName: string; inviterAvatarSrc: string | null } {
  if (!inviterNpub) return { inviterName: tFn('messaging.message.someone'), inviterAvatarSrc: null };
  const profile = profilesMap[inviterNpub];
  const inviterName = getProfileDisplayName(profile ?? null) || inviterNpub.slice(0, 12) + '…';
  const inviterAvatarSrc = profile ? getProfileAvatarSrc(profile) : null;
  return { inviterName, inviterAvatarSrc };
}

export function getInviterDisplay(
  msg: DmMessage,
  activeDmId: string | null,
  profilesMap: Record<string, NostrProfile | undefined>
): { inviterName: string; inviterAvatarSrc: string | null } {
  const otherNpub = msg.mine ? activeDmId : msg.npub ?? activeDmId;
  return getInviterDisplayFromNpub(otherNpub, profilesMap);
}

export function isInvitePresentation(p: DmMessagePresentation): boolean {
  return p.kind === 'squad-invite' || p.kind === 'squad-pair-invite';
}

export function buildPlainMessageProps(
  msg: DmMessage,
  threadNpub: string,
  profilesMap: Record<string, NostrProfile | undefined>,
  currentUserNpub: string | undefined,
  tFn: MessageFormatter = get(t)
) {
  const currentUserProfile = currentUserNpub ? profilesMap[currentUserNpub] : null;
  const base = {
    id: msg.id,
    authorName: '',
    content: msg.content,
    timestamp: new Date(msg.at).toISOString(),
    avatar: '',
    replyToId: msg.replied_to && msg.replied_to.length > 0 ? msg.replied_to : undefined,
    replyAuthorName: undefined as string | undefined,
    replyPreview: undefined as string | undefined,
    reactions: msg.reactions,
    attachments: msg.attachments,
    previewMetadata: msg.preview_metadata,
  };
  if (msg.mine) {
    base.authorName = tFn('messaging.message.authorYou');
    base.avatar = getProfileAvatarSrc(currentUserProfile) ?? '';
  } else {
    const senderNpub = msg.npub ?? threadNpub;
    const senderProfile = senderNpub ? profilesMap[senderNpub] : null;
    base.authorName = getProfileDisplayName(senderProfile);
    base.avatar = getProfileAvatarSrc(senderProfile) ?? '';
  }
  if (base.replyToId) {
    const replyNpub = msg.replied_to_npub ?? undefined;
    base.replyAuthorName =
      replyNpub && currentUserNpub && replyNpub === currentUserNpub
        ? tFn('messaging.message.authorYou')
        : replyNpub
          ? getProfileDisplayName(profilesMap[replyNpub] ?? null)
          : tFn('messaging.message.replyUnknown');
    base.replyPreview =
      msg.replied_to_has_attachment === true
        ? tFn('messaging.message.attachment')
        : msg.replied_to_content != null && msg.replied_to_content.length > 0
          ? msg.replied_to_content.slice(0, 80).trim() + (msg.replied_to_content.length > 80 ? '…' : '')
          : tFn('messaging.message.messageFallback');
  }
  return base;
}
