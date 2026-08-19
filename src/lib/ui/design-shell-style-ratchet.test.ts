import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const roots = [join(here, '../../routes/design'), join(here, '../../components/shell')];

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

describe('design shell styling ratchet', () => {
	const svelteFiles = roots.flatMap(walk).filter((path) => path.endsWith('.svelte'));

	it('keeps design and shared shell svelte files free of scoped style blocks', () => {
		expect(svelteFiles.length).toBeGreaterThan(0);
		const offenders = svelteFiles.filter((path) => /<style[\s>]/.test(readFileSync(path, 'utf8')));
		expect(offenders).toEqual([]);
	});

	it('does not use black/white hover washes in design or shared shell', () => {
		const wash = /hover:bg-black\/4|dark:hover:bg-white\/4/;
		const offenders = svelteFiles.filter((path) => wash.test(readFileSync(path, 'utf8')));
		expect(offenders).toEqual([]);
	});
});
