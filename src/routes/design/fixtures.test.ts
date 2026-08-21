import { describe, expect, it } from 'vitest';
import { memberToggleFaces, members } from './fixtures';

describe('memberToggleFaces', () => {
	it('returns the first three present members', () => {
		expect(memberToggleFaces(members, 'default')).toEqual([
			{ id: 'alice', initials: 'A', color: '#2a4a3d' },
			{ id: 'borrowlucid', initials: 'B', color: '#3d2c6b' },
			{ id: 'daopunk', initials: 'D', color: '#1a3a3a' },
		]);
	});

	it('returns an empty stack when the roster overlay is empty', () => {
		expect(memberToggleFaces(members, 'empty')).toEqual([]);
	});
});
