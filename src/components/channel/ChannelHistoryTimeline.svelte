<svelte:options runes={true} />

<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { ComponentProps } from 'svelte';
  import Message from '../dm/Message.svelte';
  import AnnounceCard from '../announcements/AnnounceCard.svelte';
  import JoinInboxAnnounceCard from '../announcements/JoinInboxAnnounceCard.svelte';
  import { parseAnnouncement } from '../../lib/announcements';
  import { parseJoinInboxAnnounceMessage } from '../../lib/squad/join-inbox-announce';
  import { announceCardAllowedForTimelineBucket } from '../../lib/mls/virtual-channel-bucket';
  import { shouldStackChannelWithPrevious } from '../../lib/dm/message-stack';
  import type { DmMessage } from '../../stores/app';
  import type { MessageEditRequest } from '../../lib/messaging/message-edit';

  type BuiltMessageProps = ComponentProps<typeof Message>;

  interface Props {
    historyAbove: DmMessage[];
    historyBelow: DmMessage[];
    timelineKey: string;
    showMlsHistoryWelcome: boolean;
    channelParsesStructuredAnnounces: boolean;
    toMessageProps: (message: DmMessage) => BuiltMessageProps;
    channelMessageIsCard: (message: DmMessage) => boolean;
    editRequest: MessageEditRequest | null;
    chatId: string;
    onReact: (messageId: string, emoji: string) => void;
    onCopy: (messageId: string, text: string) => void;
    onReply: (messageId: string) => void;
    onEdit: (message: DmMessage, newBody: string) => Promise<boolean>;
    onSaveToDocs?: (messageId: string, text: string) => void;
  }

  let {
    historyAbove,
    historyBelow,
    timelineKey,
    showMlsHistoryWelcome,
    channelParsesStructuredAnnounces,
    toMessageProps,
    channelMessageIsCard,
    editRequest,
    chatId,
    onReact,
    onCopy,
    onReply,
    onEdit,
    onSaveToDocs,
  }: Props = $props();
</script>

{#snippet historyRow(message: DmMessage, previous: DmMessage | undefined)}
  {@const props = toMessageProps(message)}
  {@const parsed = channelParsesStructuredAnnounces ? parseAnnouncement(message.content) : null}
  {@const joinInboxAnnounce =
    channelParsesStructuredAnnounces ? parseJoinInboxAnnounceMessage(message.content) : null}
  {@const announceForCard =
    parsed && announceCardAllowedForTimelineBucket(parsed, message) ? parsed : null}
  {#if announceForCard}
    <AnnounceCard
      id={message.id}
      announce={announceForCard}
      authorName={props.authorName}
      authorNpub={message.npub}
      timestamp={props.timestamp}
    />
  {:else if joinInboxAnnounce}
    <JoinInboxAnnounceCard
      id={message.id}
      announce={joinInboxAnnounce}
      authorName={props.authorName}
      authorNpub={message.npub}
      timestamp={props.timestamp}
    />
  {:else}
    <Message
      {...props}
      editRequest={editRequest?.scope === timelineKey && editRequest.messageId === message.id
        ? editRequest
        : null}
      {chatId}
      {onReact}
      {onCopy}
      {onReply}
      onEdit={(_id, body) => onEdit(message, body)}
      {onSaveToDocs}
      compact={shouldStackChannelWithPrevious(previous, message, channelMessageIsCard)}
    />
  {/if}
{/snippet}

{#each historyAbove as message, i (`${timelineKey}:copy:${message.id}`)}
  {@render historyRow(message, historyAbove[i - 1])}
{/each}
{#if showMlsHistoryWelcome}
  <div class="mls-history-welcome" role="note">
    <p class="mls-history-welcome-title">{$t('messaging.channel.mlsWelcomeTitle')}</p>
    <p class="mls-history-welcome-body">
      {$t('messaging.channel.mlsWelcomeBody')}
    </p>
  </div>
{/if}
{#each historyBelow as message, i (`${timelineKey}:${message.id}`)}
  {@render historyRow(message, historyBelow[i - 1])}
{/each}

<style>
  .mls-history-welcome {
    margin: 16px 16px 8px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-elevated);
  }

  .mls-history-welcome-title {
    margin: 0 0 6px;
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 600;
  }

  .mls-history-welcome-body {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.875rem;
    line-height: 1.45;
  }
</style>
