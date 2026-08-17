import { describe, expect, it } from 'vitest';
import { filterShellChannels, groupShellChannels, parseShellPreviewState } from './state';
import type { ShellChannel } from './types';

const channels: ShellChannel[] = [
	{
		id: 'general',
		name: 'general',
		groupId: 'squad',
		groupLabel: 'Squad',
		kind: 'text',
	},
	{
		id: 'deliveries',
		name: 'West Deliveries',
		groupId: 'work',
		groupLabel: 'Working groups',
		kind: 'private',
	},
	{
		id: 'announcements',
		name: 'announcements',
		groupId: 'squad',
		groupLabel: 'Squad',
		kind: 'announcement',
	},
];

describe('shell preview state', () => {
	it('accepts known states and falls back for unknown values', () => {
		expect(parseShellPreviewState('dense')).toBe('dense');
		expect(parseShellPreviewState('unknown')).toBe('default');
		expect(parseShellPreviewState(null)).toBe('default');
	});
});

describe('shell channel helpers', () => {
	it('filters channels case-insensitively without mutating the input', () => {
		expect(filterShellChannels(channels, ' west ')).toEqual([channels[1]]);
		expect(filterShellChannels(channels, '')).toBe(channels);
		expect(filterShellChannels(channels, '   ')).toBe(channels);
	});

	it('groups channels in their first-seen order', () => {
		expect(groupShellChannels(channels)).toEqual([
			{
				id: 'squad',
				label: 'Squad',
				channels: [channels[0], channels[2]],
			},
			{
				id: 'work',
				label: 'Working groups',
				channels: [channels[1]],
			},
		]);
	});
});
