/** Shared design-route session state (layout + subroutes). Fixtures only — no live data. */

import {
	squads as initialSquads,
	channels as initialChannels,
	channelsForSquad,
	messagesByChannel as initialMessagesByChannel,
} from './fixtures.js';
import type { Channel, Message, PresenceStatus, RailLens, Squad } from './fixtures.js';
import { currentUser } from './fixtures.js';
import { consumeChannelInList, withSyncedMentions } from './session.js';
import type { DitherPattern } from './dither.js';

const squadPalette = ['#2a4a3d', '#3d2c6b', '#1e3a4a', '#5a2a2a', '#26324a', '#3a2c4a'];

function initChannelsBySquad(): Record<string, Channel[]> {
	return Object.fromEntries(initialSquads.map((squad) => [squad.id, channelsForSquad(squad.id)]));
}

class DesignSession {
	squadList = $state<Squad[]>(
		initialSquads.map((squad) => {
			const synced = withSyncedMentions(structuredClone(squad), channelsForSquad(squad.id));
			if (squad.id === (initialSquads[0]?.id ?? '')) {
				return { ...synced, unread: false };
			}
			return synced;
		})
	);
	channelsBySquad = $state<Record<string, Channel[]>>(initChannelsBySquad());
	messagesByChannel = $state<Record<string, Message[]>>(
		Object.fromEntries(
			Object.entries(initialMessagesByChannel).map(([id, list]) => [id, structuredClone(list)])
		)
	);

	activeSquadId = $state(initialSquads[0]?.id ?? '');
	activeChannelId = $state('general');
	activeLens = $state<RailLens | null>(null);
	presence = $state<PresenceStatus>(currentUser.status);

	addSquadOpen = $state(false);
	addChannelOpen = $state(false);
	newSquadName = $state('');
	newChannelName = $state('');
	asideCollapsed = $state(false);

	ditherMix = $state(42);
	ditherTile = $state(8);
	ditherEdge = $state(12);
	ditherPattern = $state<DitherPattern>('bayer');
	gateOpen = $state(false);

	resetDither() {
		this.ditherMix = 42;
		this.ditherTile = 8;
		this.ditherEdge = 12;
		this.ditherPattern = 'bayer';
	}

	get activeSquad() {
		return this.squadList.find((squad) => squad.id === this.activeSquadId) ?? this.squadList[0];
	}

	get channelList() {
		return this.channelsBySquad[this.activeSquadId] ?? [];
	}

	get activeChannel() {
		return (
			this.channelList.find((channel) => channel.id === this.activeChannelId) ?? this.channelList[0]
		);
	}

	get messageList() {
		return this.messagesByChannel[this.activeChannelId] ?? [];
	}

	selectSquad(id: string) {
		this.activeSquadId = id;
		this.activeLens = null;
		this.squadList = this.squadList.map((squad) =>
			squad.id === id ? { ...squad, unread: false } : squad
		);
	}

	selectLens(lens: RailLens) {
		this.activeLens = lens;
	}

	/** Open a channel: clear its unread/mentions, then sync the squad rail badge. */
	consumeChannel(id: string) {
		this.activeChannelId = id;
		const current = this.channelsBySquad[this.activeSquadId] ?? [];
		const nextChannels = consumeChannelInList(current, id);
		this.channelsBySquad = { ...this.channelsBySquad, [this.activeSquadId]: nextChannels };
		this.squadList = this.squadList.map((squad) =>
			squad.id === this.activeSquadId ? withSyncedMentions(squad, nextChannels) : squad,
		);
	}

	markSquadRead(id: string) {
		const current = this.channelsBySquad[id] ?? [];
		const nextChannels = current.map((channel) => ({
			...channel,
			unread: false,
			mentionCount: undefined
		}));
		this.channelsBySquad = { ...this.channelsBySquad, [id]: nextChannels };
		this.squadList = this.squadList.map((squad) =>
			squad.id === id ? { ...squad, unread: false, mentionCount: undefined } : squad
		);
	}

	leaveSquad(id: string) {
		const remaining = this.squadList.filter((squad) => squad.id !== id);
		if (remaining.length === 0) return;
		const { [id]: _removed, ...restChannels } = this.channelsBySquad;
		this.channelsBySquad = restChannels;
		this.squadList = remaining;
		if (this.activeSquadId === id) {
			this.activeSquadId = remaining[0].id;
			this.activeChannelId = 'general';
			this.activeLens = null;
		}
	}

	squadHasNotifications(id: string): boolean {
		const squad = this.squadList.find((entry) => entry.id === id);
		if (squad?.unread || (squad?.mentionCount ?? 0) > 0) return true;
		return (this.channelsBySquad[id] ?? []).some(
			(channel) => channel.unread || (channel.mentionCount ?? 0) > 0
		);
	}

	changePresence(status: PresenceStatus) {
		this.presence = status;
	}

	openAddSquad() {
		this.newSquadName = '';
		this.addSquadOpen = true;
	}

	confirmAddSquad(event: SubmitEvent) {
		event.preventDefault();
		const name = this.newSquadName.trim();
		if (!name) return;
		const id = `squad-${Date.now()}`;
		const initials = name.slice(0, 2).toUpperCase();
		const color = squadPalette[this.squadList.length % squadPalette.length];
		const freshChannels = structuredClone(initialChannels);
		this.channelsBySquad = { ...this.channelsBySquad, [id]: freshChannels };
		this.squadList = [...this.squadList, { id, name, initials, color, unread: false }];
		this.activeSquadId = id;
		this.activeLens = null;
		this.addSquadOpen = false;
	}

	openAddChannel() {
		this.newChannelName = '';
		this.addChannelOpen = true;
	}

	confirmAddChannel(event: SubmitEvent) {
		event.preventDefault();
		const name = this.newChannelName
			.trim()
			.toLowerCase()
			.replace(/\s+/g, '-');
		if (!name) return;
		const id = `${name}-${Date.now()}`;
		const current = this.channelsBySquad[this.activeSquadId] ?? [];
		this.channelsBySquad = {
			...this.channelsBySquad,
			[this.activeSquadId]: [...current, { id, name, category: 'channels' }]
		};
		this.activeChannelId = id;
		this.addChannelOpen = false;
	}

	sendMessage(text: string, time: string) {
		const channelId = this.activeChannelId;
		const current = this.messagesByChannel[channelId] ?? [];
		this.messagesByChannel = {
			...this.messagesByChannel,
			[channelId]: [
				...current,
				{
					id: `m-${Date.now()}`,
					author: currentUser.name,
					initials: currentUser.initials,
					color: currentUser.color,
					time,
					kind: 'text',
					text,
				},
			],
		};
	}
}

export const design = new DesignSession();
