import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	DITHER_DEFAULTS,
	DITHER_PATTERNS,
	ditherMaskStyle,
	ditherPatternMaskImage,
	ditherPatternUrl,
} from './dither.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('design dither wiring', () => {
	const css = readFileSync(join(here, 'dither.css'), 'utf8');
	const layout = readFileSync(join(here, '+layout.svelte'), 'utf8');

	it('css root fallbacks match dither defaults', () => {
		expect(css).toContain(`--dither-mix: ${DITHER_DEFAULTS.mix};`);
		expect(css).toContain(`--dither-tile: ${DITHER_DEFAULTS.tile}px;`);
		expect(css).toContain(`--dither-edge: ${DITHER_DEFAULTS.edge}px;`);
	});

	it('binds pattern switching to data-dither-pattern on the design shell', () => {
		expect(layout).toContain('data-dither-pattern={design.ditherPattern}');
		expect(css).toContain("[data-dither-pattern='checker']");
	});

	it('swaps a single mask image per pattern so WebKit does not drop dual-mask composites', () => {
		expect(css).not.toContain('mask-composite:');
		expect(css).not.toContain('-webkit-mask-composite:');
		for (const pattern of DITHER_PATTERNS.filter((name) => name !== 'bayer')) {
			expect(css).toContain(`url('./dither/${pattern}.svg')`);
			expect(css).toContain(`[data-dither-pattern='${pattern}'] .shell-dither-seam::before`);
			expect(css).toContain(`[data-dither-pattern='${pattern}'] .shell-grid-void`);
			expect(css).toContain(`[data-dither-pattern='${pattern}'] .shell-dither-arc-wash`);
			expect(css).toContain(`[data-dither-pattern='${pattern}'] .shell-sys-notice-wash`);
		}
	});

	it('inlines pattern masks as svg data urls so picker thumbs paint in the webview', () => {
		for (const pattern of DITHER_PATTERNS) {
			expect(ditherPatternUrl(pattern)).toMatch(/^data:image\/svg\+xml,/);
			expect(ditherPatternMaskImage(pattern)).toMatch(/^url\("data:image\/svg\+xml,/);
			expect(ditherMaskStyle(pattern)).toContain(
				`mask-size: var(--dither-tile, ${DITHER_DEFAULTS.tile}px)`
			);
		}
	});

	it('lets the gate inherit dither pattern instead of replacing the wash mask', () => {
		const gate = readFileSync(join(here, 'components/DesignGate.svelte'), 'utf8');
		expect(gate).toContain('ditherMaskStyle(design.ditherPattern)');
		expect(css).not.toMatch(/\.shell-gate \.shell-dither-wash[\s\S]{0,200}radial-gradient/);
		expect(css).toContain(`var(--dither-tile, ${DITHER_DEFAULTS.tile}px)`);
	});

	it('sizes the panel seam from --dither-edge and mix', () => {
		const start = css.indexOf('.shell-dither-seam::before {');
		expect(start).toBeGreaterThan(-1);
		const block = css.slice(start, css.indexOf('}', start) + 1);
		expect(block).toContain('width: var(--dither-edge, 17px)');
		expect(block).toContain('var(--dither-mix, 32)');
		expect(block).toContain('var(--dither-ink)');
		expect(block).not.toContain('var(--muted)');
	});

	it('boots the playground at DEFAULT_THEME and applies it on mount', () => {
		expect(layout).toContain('previewTheme = $state<DesignTheme>(DEFAULT_THEME)');
		expect(layout).toContain('readDesignPreviewTheme() ?? DEFAULT_THEME');
		expect(layout).toContain('applyPlaygroundTheme(preview)');
		expect(layout).not.toMatch(/function selectTheme[\s\S]*setTheme\(/);
	});
});
