import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('VoteEmbedHeading', () => {
	it('owns the vote kicker so strip and card do not duplicate it', () => {
		const heading = readFileSync(join(here, 'VoteEmbedHeading.svelte'), 'utf8');
		const strip = readFileSync(join(here, 'VoteEmbedStrip.svelte'), 'utf8');
		const card = readFileSync(join(here, 'VoteEmbedCard.svelte'), 'utf8');

		expect(heading).toContain("design.chat.proposalFallback");
		expect(heading).toContain("design.chat.voteTreasury");
		expect(strip).toContain('VoteEmbedHeading');
		expect(card).toContain('VoteEmbedHeading');
		expect(strip).not.toContain("design.chat.proposalFallback");
		expect(card).not.toContain("design.chat.proposalFallback");
		expect(strip).not.toContain("design.chat.voteTreasury");
		expect(card).not.toContain("design.chat.voteTreasury");
	});
});
