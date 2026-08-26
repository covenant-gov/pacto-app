import { describe, expect, it } from 'vitest';
import { consumeChannelInList, withSyncedMentions } from './session.js';
import type { Channel, Squad } from './fixtures';

const channels: Channel[] = [
	{
		id: 'announcements',
		name: 'announcements',
		category: 'squad',
		unread: true,
		mentionCount: 1,
	},
	{
		id: 'governance',
		name: 'governance',
		category: 'channels',
		unread: true,
		mentionCount: 2,
	},
];

const squad: Squad = {
	id: 'cp',
	name: 'CP',
	initials: 'CP',
	color: '#26324a',
	unread: true,
	mentionCount: 3,
};

describe('consumeChannelInList', () => {
	it('clears unread and mentions for the opened channel only', () => {
		const next = consumeChannelInList(channels, 'governance');

		expect(next[0]).toMatchObject({ unread: true, mentionCount: 1 });
		expect(next[1]).toEqual({
			id: 'governance',
			name: 'governance',
			category: 'channels',
			unread: false,
			mentionCount: undefined,
		});
		expect(channels[1].unread).toBe(true);
		expect(channels[1].mentionCount).toBe(2);
	});
});

describe('withSyncedMentions', () => {
	it('syncs the squad rail badge to remaining channel mentions', () => {
		const remaining = consumeChannelInList(channels, 'governance');
		expect(withSyncedMentions(squad, remaining)).toEqual({
			...squad,
			mentionCount: 1,
		});
	});

	it('drops the badge when no channel mentions remain', () => {
		const cleared = consumeChannelInList(
			consumeChannelInList(channels, 'governance'),
			'announcements',
		);
		expect(withSyncedMentions(squad, cleared).mentionCount).toBeUndefined();
	});
});
