/** Static fixtures for the /design sandbox (dev-only, no live data). */

import type { ShellPreviewState } from '$lib/shell';

export type RailLens = 'home' | 'dms' | 'activity' | 'commons';

export interface Squad {
	id: string;
	name: string;
	initials: string;
	/** Squircle fill, hex. */
	color: string;
	/** False = read (dims to 42% opacity); true = unread, stays full-color. */
	unread: boolean;
	mentionCount?: number;
}

export const squads: Squad[] = [
	{ id: 't14', name: 't14', initials: 't14', color: '#3d2c6b', unread: true },
	{ id: 'cp', name: 'CP', initials: 'CP', color: '#26324a', unread: true, mentionCount: 3 },
	{ id: '8b', name: '8B', initials: '8B', color: '#1e3a4a', unread: true },
	{ id: 'cg', name: 'CG', initials: 'CG', color: '#3a2c4a', unread: false }
];

export type ChannelCategory = 'squad' | 'channels';

export interface Channel {
	id: string;
	name: string;
	category: ChannelCategory;
	unread?: boolean;
	mentionCount?: number;
	locked?: boolean;
}

/** Baseline channel list (cloned per squad in the design shell). */
export const channels: Channel[] = [
	{ id: 'dashboard', name: 'dashboard', category: 'squad' },
	{ id: 'announcements', name: 'announcements', category: 'squad' },
	{ id: 'polls', name: 'polls', category: 'squad' },
	{ id: 'general', name: 'general', category: 'channels' },
	{ id: 'governance', name: 'governance', category: 'channels' },
	{ id: 'hackathon', name: 'hackathon', category: 'channels' }
];

/** Per-squad unread/mention overlays for progressive-consume demos. */
export const channelOverridesBySquad: Record<string, Partial<Channel>[]> = {
	t14: [
		{ id: 'announcements', unread: true },
		{ id: 'governance', unread: true }
	],
	cp: [
		{ id: 'announcements', unread: true, mentionCount: 1 },
		{ id: 'governance', unread: true, mentionCount: 2 }
	],
	'8b': [{ id: 'general', unread: true }],
	cg: []
};

export function channelsForSquad(squadId: string): Channel[] {
	const overrides = channelOverridesBySquad[squadId] ?? [];
	return channels.map((channel) => {
		const override = overrides.find((entry) => entry.id === channel.id);
		return override ? { ...channel, ...override } : { ...channel };
	});
}

export function mentionTotal(channelList: readonly Channel[]): number {
	return channelList.reduce((sum, channel) => sum + (channel.mentionCount ?? 0), 0);
}

export type Hat = 'admin' | 'quartermaster' | 'crew';
export type PresenceStatus = 'online' | 'away' | 'dnd' | 'offline' | 'invisible';

export interface Member {
	id: string;
	name: string;
	initials: string;
	color: string;
	hat: Hat;
	status: PresenceStatus;
}

export const members: Member[] = [
	{ id: 'alice', name: 'Alice', initials: 'A', color: '#2a4a3d', hat: 'admin', status: 'online' },
	{
		id: 'borrowlucid',
		name: 'BorrowLucid',
		initials: 'B',
		color: '#3d2c6b',
		hat: 'quartermaster',
		status: 'online'
	},
	{
		id: 'daopunk',
		name: 'daopunk',
		initials: 'D',
		color: '#1a3a3a',
		hat: 'quartermaster',
		status: 'dnd'
	},
	{ id: 'ruffs', name: 'ruffs', initials: 'R', color: '#f97316', hat: 'crew', status: 'online' },
	{ id: 'dan', name: 'Dan', initials: 'D', color: '#5a2a2a', hat: 'crew', status: 'away' },
	{ id: 'eve', name: 'Eve', initials: 'E', color: '#26324a', hat: 'crew', status: 'offline' },
	{ id: 'molly', name: 'Molly', initials: 'M', color: '#3a2c4a', hat: 'crew', status: 'offline' }
];

export type MessageKind = 'text' | 'gov' | 'sys';
export type MessageRole = 'admin' | 'qm' | 'cm';

/** Squad proposals referenced as #N in chat (GitHub-issue style pills). */
export interface ProposalRef {
	id: number;
	title: string;
	status: 'open' | 'passed' | 'failed';
}

export const proposals: Record<string, ProposalRef> = {
	'12': { id: 12, title: 'Treasury top-up', status: 'passed' },
	'14': { id: 14, title: 'Hackathon prize pool', status: 'open' }
};

export function proposalPillLabel(token: string): string {
	const id = token.replace(/^#/, '');
	const proposal = proposals[id];
	return proposal ? `#${proposal.id} ${proposal.title}` : token;
}

export function proposalTitle(token: string): string | undefined {
	const id = token.replace(/^#/, '');
	return proposals[id]?.title;
}

export interface PollRef {
	id: number;
	title: string;
}

export const pollRefs: Record<string, PollRef> = {
	'1': { id: 1, title: 'Friday demo night' }
};

export function pollTitle(token: string): string | undefined {
	const id = token.replace(/^#poll-/, '');
	return pollRefs[id]?.title;
}

export type MessageEmbed =
	| {
			kind: 'poll';
			title: string;
			options: {
				label: string;
				votes: number;
				selected?: boolean;
				voters?: { initials: string; color: string }[];
			}[];
			closes: string;
			channel: string;
			tag?: string;
	  }
	| {
			kind: 'vote';
			title: string;
			detail: string;
			amount: string;
			quorum: string;
			status: 'open' | 'passed' | 'failed';
			channel: string;
			tag?: string;
			proposalId?: number;
			/** Seconds-style urgency label, e.g. "closes 8h". */
			closes?: string;
			forPct?: number;
			againstPct?: number;
			quorumNeeded?: number;
	  };

export interface Message {
	id: string;
	author: string;
	initials: string;
	color: string;
	role?: MessageRole;
	time: string;
	kind: MessageKind;
	/** Plain text; @Name, #channel, #N proposals, and #poll-N render as chips. */
	text: string;
	network?: string;
	embeds?: MessageEmbed[];
}

export const messages: Message[] = [
	{
		id: 'm1',
		author: 'Alice',
		initials: 'A',
		color: '#2a4a3d',
		role: 'admin',
		time: 'Today at 9:06 AM',
		kind: 'text',
		text: "Treasury vote closes tonight — if you hold a Crew hat, get your ballot in. Quorum's at 78%."
	},
	{
		id: 'm2',
		author: 'BorrowLucid',
		initials: 'B',
		color: '#3d2c6b',
		role: 'qm',
		time: 'Today at 9:08 AM',
		kind: 'text',
		text: 'Done. Also pushed the Sepolia deploy addresses to #announcements for anyone verifying on-chain.'
	},
	{
		id: 'm3',
		author: 'Dan',
		initials: 'D',
		color: '#5a2a2a',
		time: 'Today at 9:11 AM',
		kind: 'text',
		text: 'gm — catching up now'
	},
	{
		id: 'm3b',
		author: 'Pacto',
		initials: 'P',
		color: '#14120f',
		time: 'Today at 9:12 AM',
		kind: 'sys',
		text: 'Join inbox keys rotated for this squad.'
	},
	{
		id: 'm3c',
		author: 'Eve',
		initials: 'E',
		color: '#26324a',
		time: 'Today at 9:13 AM',
		kind: 'text',
		text: 'rotations always land right when I’m mid-thread'
	},
	{
		id: 'm3d',
		author: 'Molly',
		initials: 'M',
		color: '#3a2c4a',
		time: 'Today at 9:13 AM',
		kind: 'text',
		text: 'same. scrolling back.'
	},
	{
		id: 'm4',
		author: 'Pacto Gov',
		initials: 'PG',
		color: '#152a2a',
		role: 'qm',
		time: 'Today at 9:14 AM',
		kind: 'gov',
		text: '#12 passed · Treasury +2.5 ETH',
		network: 'Sepolia'
	}
];

/** Channel-scoped fixture threads (falls back to `messages` / empty). */
export const messagesByChannel: Record<string, Message[]> = {
	general: messages,
	announcements: [
		{
			id: 'a1',
			author: 'Nova',
			initials: 'N',
			color: '#5b3a6e',
			role: 'cm',
			time: 'Today at 10:02 AM',
			kind: 'text',
			text: '✷ Weekend pulse — #poll-1 and #14 for @Crew. Vote in the linked channels; this feed is announce-only.',
			embeds: [
				{
					kind: 'poll',
					title: 'Should we run a live Friday demo night?',
					channel: 'polls',
					tag: 'Squad poll',
					closes: 'Fri 4:00 PM',
					options: [
						{
							label: 'Hell yes — projectors & snacks',
							votes: 14,
							voters: [
								{ initials: 'R', color: '#f97316' },
								{ initials: 'A', color: '#2a4a3d' },
								{ initials: 'B', color: '#3d2c6b' }
							]
						},
						{
							label: 'Async recap thread is enough',
							votes: 6,
							voters: [
								{ initials: 'D', color: '#5a2a2a' },
								{ initials: 'E', color: '#26324a' }
							]
						},
						{
							label: 'Only if Alice DJs',
							votes: 9,
							voters: [
								{ initials: 'M', color: '#3a2c4a' },
								{ initials: 'D', color: '#1a3a3a' },
								{ initials: 'B', color: '#3d2c6b' }
							]
						}
					]
				},
				{
					kind: 'vote',
					title: 'Hackathon prize pool',
					detail: 'Move 0.5 ETH from the Safe to prizes for the weekend build sprint. Quartermaster-sponsored.',
					amount: '0.5 ETH',
					quorum: '61% · needs 75%',
					status: 'open',
					channel: 'governance',
					tag: 'Proposal',
					proposalId: 14,
					closes: '8h left',
					forPct: 61,
					againstPct: 39,
					quorumNeeded: 75
				}
			]
		},
		{
			id: 'a2',
			author: 'Nova',
			initials: 'N',
			color: '#5b3a6e',
			role: 'cm',
			time: 'Today at 10:03 AM',
			kind: 'text',
			text: '1 · #poll-1 is open — vote in #polls, not here. Winner gets pinned Fri EOD.',
			embeds: [
				{
					kind: 'poll',
					title: 'Should we run a live Friday demo night?',
					channel: 'polls',
					tag: 'Squad poll',
					closes: 'Fri 4:00 PM',
					options: [
						{
							label: 'Hell yes — projectors & snacks',
							votes: 14,
							voters: [
								{ initials: 'R', color: '#f97316' },
								{ initials: 'A', color: '#2a4a3d' },
								{ initials: 'B', color: '#3d2c6b' }
							]
						},
						{
							label: 'Async recap thread is enough',
							votes: 6,
							voters: [
								{ initials: 'D', color: '#5a2a2a' },
								{ initials: 'E', color: '#26324a' }
							]
						},
						{
							label: 'Only if Alice DJs',
							votes: 9,
							voters: [
								{ initials: 'M', color: '#3a2c4a' },
								{ initials: 'D', color: '#1a3a3a' },
								{ initials: 'B', color: '#3d2c6b' }
							]
						}
					]
				}
			]
		},
		{
			id: 'a3',
			author: 'Nova',
			initials: 'N',
			color: '#5b3a6e',
			role: 'cm',
			time: 'Today at 10:04 AM',
			kind: 'text',
			text: '2 · #14 is live on-chain — 0.5 ETH hackathon prize pool. Cast under dashboard → Treasury; chatter in #governance. Quorum needs a push before tonight — @Alice @daopunk on nudge duty.',
			embeds: [
				{
					kind: 'vote',
					title: 'Hackathon prize pool',
					detail: 'Move 0.5 ETH from the Safe to prizes for the weekend build sprint. Quartermaster-sponsored.',
					amount: '0.5 ETH',
					quorum: '61% · needs 75%',
					status: 'open',
					channel: 'governance',
					tag: 'Proposal',
					proposalId: 14,
					closes: '8h left',
					forPct: 61,
					againstPct: 39,
					quorumNeeded: 75
				}
			]
		}
	],
	polls: [
		{
			id: 'p1',
			author: 'Nova',
			initials: 'N',
			color: '#5b3a6e',
			role: 'cm',
			time: 'Today at 10:03 AM',
			kind: 'text',
			text: '#poll-1 — smash a button before Friday:',
			embeds: [
				{
					kind: 'poll',
					title: 'Should we run a live Friday demo night?',
					channel: 'polls',
					tag: 'Live',
					closes: 'Fri 4:00 PM',
					options: [
						{
							label: 'Hell yes — projectors & snacks',
							votes: 14,
							selected: true,
							voters: [
								{ initials: 'R', color: '#f97316' },
								{ initials: 'A', color: '#2a4a3d' },
								{ initials: 'B', color: '#3d2c6b' }
							]
						},
						{
							label: 'Async recap thread is enough',
							votes: 6,
							voters: [
								{ initials: 'D', color: '#5a2a2a' },
								{ initials: 'E', color: '#26324a' }
							]
						},
						{
							label: 'Only if Alice DJs',
							votes: 9,
							voters: [
								{ initials: 'M', color: '#3a2c4a' },
								{ initials: 'D', color: '#1a3a3a' },
								{ initials: 'B', color: '#3d2c6b' }
							]
						}
					]
				}
			]
		}
	],
	governance: [
		{
			id: 'g1',
			author: 'Pacto Gov',
			initials: 'PG',
			color: '#152a2a',
			role: 'qm',
			time: 'Today at 9:14 AM',
			kind: 'gov',
			text: '#12 passed · Treasury +2.5 ETH',
			network: 'Sepolia'
		},
		{
			id: 'g2',
			author: 'BorrowLucid',
			initials: 'B',
			color: '#3d2c6b',
			role: 'qm',
			time: 'Today at 10:01 AM',
			kind: 'text',
			text: "It's live. #14 is finally on-chain! we have been grinding this prize-pool proposal for weeks and the Safe path just cleared. 0.5 ETH for the weekend sprint. So excited!!",
			embeds: [
				{
					kind: 'vote',
					title: 'Hackathon prize pool',
					detail: 'Move 0.5 ETH from the Safe to prizes for the weekend build sprint.',
					amount: '0.5 ETH',
					quorum: '61% · needs 75%',
					status: 'open',
					channel: 'governance',
					tag: 'Proposal',
					proposalId: 14,
					closes: '8h left',
					forPct: 61,
					againstPct: 39,
					quorumNeeded: 75
				}
			]
		}
	]
};

export type DashboardMode = 'status' | 'governance' | 'treasury' | 'roles';

export interface ModeOption {
	id: DashboardMode;
	label: string;
}

export const modes: ModeOption[] = [
	{ id: 'status', label: 'Status' },
	{ id: 'governance', label: 'Governance' },
	{ id: 'treasury', label: 'Treasury' },
	{ id: 'roles', label: 'Roles' }
];

export function isDashboardMode(value: string): value is DashboardMode {
	return modes.some((mode) => mode.id === value);
}

export interface CurrentUser {
	id: string;
	name: string;
	initials: string;
	color: string;
	status: PresenceStatus;
	statusLabel: string;
}

export const currentUser: CurrentUser = {
	id: 'ruffs',
	name: 'ruffs',
	initials: 'R',
	color: '#f97316',
	status: 'online',
	statusLabel: 'Online'
};

export const presenceStatuses: PresenceStatus[] = ['online', 'away', 'dnd', 'invisible'];

const denseChannels: Channel[] = Array.from({ length: 12 }, (_, index) => ({
	id: `project-${index + 1}`,
	name: `project-${String(index + 1).padStart(2, '0')}`,
	category: 'channels',
	unread: index % 3 === 0,
	mentionCount: index % 7 === 0 ? index + 1 : undefined,
}));

const longChannel: Channel = {
	id: 'long-channel',
	name: 'cross-regional-disaster-preparedness-and-neighborhood-resource-coordination',
	category: 'channels',
	mentionCount: 104,
};

const denseMembers: Member[] = Array.from({ length: 14 }, (_, index) => ({
	id: `member-${index + 1}`,
	name: `Member ${String(index + 1).padStart(2, '0')}`,
	initials: `M${(index + 1) % 10}`,
	color: '#26324a',
	hat: 'crew',
	status: index % 3 === 0 ? 'online' : index % 3 === 1 ? 'away' : 'offline',
}));

const longMember: Member = {
	id: 'long-member',
	name: 'Alexandria-María de la Cruz-Washington with an intentionally unbroken display name',
	initials: 'AM',
	color: '#3a2c4a',
	hat: 'crew',
	status: 'online',
};

const denseMessages: Message[] = Array.from({ length: 16 }, (_, index) => ({
	id: `dense-message-${index + 1}`,
	author: index % 2 === 0 ? 'Alice' : 'Dan',
	initials: index % 2 === 0 ? 'A' : 'D',
	color: index % 2 === 0 ? '#2a4a3d' : '#5a2a2a',
	time: `10:${String(index).padStart(2, '0')} AM`,
	kind: 'text',
	text:
		index % 3 === 0
			? 'Quick status update: the assigned task is complete and the shared checklist is current.'
			: 'Acknowledged. I will post the next update after the route check.',
}));

const longMessage: Message = {
	id: 'long-message',
	author: 'Alexandria-María de la Cruz-Washington with a very long display name',
	initials: 'AM',
	color: '#3a2c4a',
	time: '11:59 PM',
	kind: 'text',
	text: 'This intentionally long fixture verifies that messages wrap without expanding the shell: pneumonoultramicroscopicsilicovolcanoconiosis.example/coordination/this-segment-has-no-natural-breaks and then continues with ordinary prose so both pathological and realistic content are exercised across narrow and wide windows.',
};

export function overlayChannels(channels: readonly Channel[], state: ShellPreviewState): Channel[] {
	if (state === 'dense') return [...channels, ...denseChannels];
	if (state === 'long') return [longChannel, ...channels];
	return [...channels];
}

export function overlayMembers(memberList: readonly Member[], state: ShellPreviewState): Member[] {
	if (state === 'empty') return [];
	if (state === 'dense') return [...memberList, ...denseMembers];
	if (state === 'long') return [longMember, ...memberList];
	return [...memberList];
}

export function memberToggleFaces(
	memberList: readonly Member[],
	state: ShellPreviewState,
): Array<{ id: string; initials: string; color: string }> {
	const list = overlayMembers(memberList, state);
	const present = list.filter((member) => member.status !== 'offline' && member.status !== 'invisible');
	return (present.length ? present : list)
		.slice(0, 3)
		.map(({ id, initials, color }) => ({ id, initials, color }));
}

export function overlayMessages(messageList: readonly Message[], state: ShellPreviewState): Message[] {
	if (state === 'dense') return [...messageList, ...denseMessages];
	if (state === 'long') return [longMessage, ...messageList];
	return [...messageList];
}
