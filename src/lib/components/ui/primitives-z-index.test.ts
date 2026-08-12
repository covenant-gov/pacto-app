import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const uiRoot = path.resolve(import.meta.dirname);

function readUi(relativePath: string): string {
	return fs.readFileSync(path.join(uiRoot, relativePath), 'utf8');
}

describe('ui primitive z-index contracts', () => {
	it('keeps dialog overlay and content above app chrome', () => {
		expect(readUi('dialog/dialog-overlay.svelte')).toContain('z-[10050]');
		expect(readUi('dialog/dialog-content.svelte')).toContain('z-[10050]');
	});

	it('keeps floating layers above dialog content', () => {
		for (const file of [
			'dropdown-menu/dropdown-menu-content.svelte',
			'dropdown-menu/dropdown-menu-sub-content.svelte',
			'popover/popover-content.svelte',
			'tooltip/tooltip-content.svelte',
		]) {
			expect(readUi(file)).toContain('z-[10060]');
		}
	});
});
