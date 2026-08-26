import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('PollEmbedHeading', () => {
	it('owns the poll kicker so strip and card do not duplicate it', () => {
		const heading = readFileSync(join(here, 'PollEmbedHeading.svelte'), 'utf8');
		const strip = readFileSync(join(here, 'PollEmbedStrip.svelte'), 'utf8');
		const card = readFileSync(join(here, 'PollEmbedCard.svelte'), 'utf8');

		expect(heading).toContain('design.chat.pollTag');
		expect(heading).toContain('#{channel}');
		expect(strip).toContain('PollEmbedHeading');
		expect(card).toContain('PollEmbedHeading');
		expect(strip).not.toContain('design.chat.pollTag');
		expect(card).not.toContain('design.chat.pollTag');
	});
});
