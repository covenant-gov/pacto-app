import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_OPTIONS } from '../../../stores/theme';
import {
	SKETCH_THEME_OPTIONS,
	readDesignPreviewTheme,
	writeDesignPreviewTheme,
} from './sketches';

const here = dirname(fileURLToPath(import.meta.url));
const appCssPath = join(here, '../../../app.css');
const appHtmlPath = join(here, '../../../app.html');

const REQUIRED_THEME_TOKENS = [
	'--bg-page',
	'--bg-panel',
	'--bg-elevated',
	'--bg-hover',
	'--text-primary',
	'--text-secondary',
	'--text-muted',
	'--border',
	'--border-subtle',
	'--brand',
	'--brand-hover',
	'--on-brand',
	'--danger',
	'--success',
	'--warning',
	'--notif',
	'--on-notif',
	'--on-success',
	'--shell-rail-bg',
	'--user-strip-bg',
	'--gov-avatar-bg',
	'--role-quartermaster',
	'--role-community-manager',
	'--mention-accent',
	'--danger-muted-fg',
] as const;

function read(path: string): string {
	return readFileSync(path, 'utf8');
}

function parseHex(hex: string): [number, number, number] {
	const raw = hex.replace('#', '').trim();
	if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
		throw new Error(`expected 6-digit hex, got ${hex}`);
	}
	return [
		parseInt(raw.slice(0, 2), 16),
		parseInt(raw.slice(2, 4), 16),
		parseInt(raw.slice(4, 6), 16),
	];
}

function channelToLinear(c: number): number {
	const s = c / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
	const [r, g, b] = parseHex(hex).map(channelToLinear);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
	const l1 = relativeLuminance(a);
	const l2 = relativeLuminance(b);
	const lighter = Math.max(l1, l2);
	const darker = Math.min(l1, l2);
	return (lighter + 0.05) / (darker + 0.05);
}

function tokenHex(css: string, name: string): string {
	const re = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`);
	const match = css.match(re);
	if (!match) {
		throw new Error(`missing hex for ${name}`);
	}
	return match[1];
}

describe('design techno-light sketches', () => {
	it('stays off the shipped theme registry', () => {
		const shipped = THEME_OPTIONS.map((option) => option.value);
		for (const option of SKETCH_THEME_OPTIONS) {
			expect(shipped).not.toContain(option.value);
		}
		const appCss = read(appCssPath);
		const appHtml = read(appHtmlPath);
		for (const option of SKETCH_THEME_OPTIONS) {
			expect(appCss).not.toContain(option.value);
			expect(appHtml).not.toContain(option.value);
		}
	});

	for (const option of SKETCH_THEME_OPTIONS) {
		it(`${option.value} defines required tokens and light scheme`, () => {
			const css = read(join(here, `${option.value}.css`));
			expect(css).toContain(`:root[data-theme="${option.value}"]`);
			expect(css).toContain('color-scheme: light;');
			for (const token of REQUIRED_THEME_TOKENS) {
				expect(css).toMatch(new RegExp(`${token}\\s*:`));
			}
			expect(css).not.toMatch(/^\s*--accent\s*:/m);
			expect(css).not.toMatch(/--accent-hover\s*:/);
			expect(css).not.toMatch(/--accent-contrast\s*:/);
			expect(css).not.toMatch(/--bg-secondary\s*:/);
		});

		it(`${option.value} keeps readable fills`, () => {
			const css = read(join(here, `${option.value}.css`));
			expect(contrastRatio(tokenHex(css, '--brand'), tokenHex(css, '--on-brand'))).toBeGreaterThanOrEqual(4.5);
			expect(contrastRatio(tokenHex(css, '--notif'), tokenHex(css, '--on-notif'))).toBeGreaterThanOrEqual(4.5);
			expect(contrastRatio(tokenHex(css, '--success'), tokenHex(css, '--on-success'))).toBeGreaterThanOrEqual(4.5);
		});
	}

	it('boots /design from pacto_design_theme or dark-techno, not pacto_theme', () => {
		const appHtml = read(appHtmlPath);
		expect(appHtml).toContain("path === '/design'");
		expect(appHtml).toContain('pacto_design_theme');
		expect(appHtml).toContain('pacto_theme');
	});

	it('does not let the root layout overwrite /design with the stored app theme', () => {
		const root = read(join(here, '../../+layout.svelte'));
		expect(root).toContain('if (!initialIsDesignRoute)');
		expect(root).toMatch(/if \(!initialIsDesignRoute\) \{[\s\S]*setTheme\(/);
		expect(root).toContain('crossedDesignBoundary');
		expect(root).toContain('applyDesignPreviewThemeFromSession');
	});
});

describe('design preview theme storage', () => {
	let store: Map<string, string>;

	beforeEach(() => {
		store = new Map();
		vi.stubGlobal('sessionStorage', {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => {
				store.set(key, value);
			},
			removeItem: (key: string) => {
				store.delete(key);
			},
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('persists shipped playground themes', () => {
		writeDesignPreviewTheme('dark-techno');
		expect(readDesignPreviewTheme()).toBe('dark-techno');
		writeDesignPreviewTheme('techno');
		expect(readDesignPreviewTheme()).toBe('techno');
	});

	it('persists sketch playground themes', () => {
		writeDesignPreviewTheme('techno-light-paper');
		expect(readDesignPreviewTheme()).toBe('techno-light-paper');
	});

	it('ignores unknown preview values', () => {
		sessionStorage.setItem('pacto_design_theme', 'not-a-theme');
		expect(readDesignPreviewTheme()).toBeNull();
	});
});
