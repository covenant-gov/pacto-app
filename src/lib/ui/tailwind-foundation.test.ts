import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { __unstable__loadDesignSystem } from '@tailwindcss/node';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const appCssPath = path.join(repoRoot, 'src/app.css');
const pagePath = path.join(repoRoot, 'src/routes/+page.svelte');

describe('tailwind foundation', () => {
	let appCss: string;
	let pageSource: string;

	beforeAll(() => {
		appCss = fs.readFileSync(appCssPath, 'utf8');
		pageSource = fs.readFileSync(pagePath, 'utf8');
	});

	it('uses layered tailwind imports instead of bare tailwindcss', () => {
		expect(appCss).not.toMatch(/^@import 'tailwindcss';/m);
		expect(appCss).toContain("@import 'tailwindcss/theme.css' layer(theme)");
		expect(appCss).toContain("@import 'tailwindcss/utilities.css' layer(utilities)");
	});

	it('binds dark variant to data-theme palettes excluding techno', () => {
		expect(appCss).toContain('@custom-variant dark');
		expect(appCss).toContain('[data-theme="dark-techno"]');
		expect(appCss).toContain('[data-theme="union"]');
		expect(appCss).not.toMatch(/\[data-theme="techno"\]/);
	});

	it('uses app-shell on main instead of tailwind container', () => {
		expect(pageSource).toMatch(/<main class="app-shell"/);
		expect(pageSource).not.toMatch(/<main class="container"/);
	});

	it('compiles semantic shadcn color utilities', async () => {
		const designSystem = await __unstable__loadDesignSystem(appCss, {
			base: path.join(repoRoot, 'src'),
		});
		const order = designSystem.getClassOrder([
			'bg-primary',
			'text-primary-foreground',
			'bg-popover',
			'text-muted-foreground',
			'dark:bg-primary',
			'bg-notif',
			'text-on-notif',
			'bg-gov-success',
			'text-on-success',
			'bg-shell-rail',
			'bg-user-strip',
			'text-mention-accent',
		]);
		for (const [, weight] of order) {
			expect(weight).not.toBeNull();
		}
		const darkCss = String(
			designSystem.candidatesToCss(['dark:bg-primary']) ?? ''
		);
		expect(darkCss).toMatch(/\[data-theme=/);
		expect(darkCss).not.toMatch(/prefers-color-scheme:\s*dark/);
	});
});
