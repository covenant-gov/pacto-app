import { mentionTotal, type Channel, type Squad } from './fixtures';

/** Clear unread and mentions for one channel; leave the rest of the list intact. */
export function consumeChannelInList(
	channels: readonly Channel[],
	channelId: string,
): Channel[] {
	return channels.map((channel) =>
		channel.id === channelId ? { ...channel, unread: false, mentionCount: undefined } : channel,
	);
}

/** Keep the squad rail mention badge in sync with remaining channel mentions. */
export function withSyncedMentions(squad: Squad, channelList: readonly Channel[]): Squad {
	const total = mentionTotal(channelList);
	return {
		...squad,
		mentionCount: total > 0 ? total : undefined,
	};
}
