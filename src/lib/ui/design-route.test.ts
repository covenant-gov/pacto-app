// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	applyDesignPreviewThemeFromSession,
	createOnce,
	crossedDesignBoundary,
	DESIGN_PREVIEW_THEME_KEY,
	isDesignPath,
} from './design-route';

describe('isDesignPath', () => {
	it('matches the design playground and nested design routes', () => {
		expect(isDesignPath('/design')).toBe(true);
		expect(isDesignPath('/design/dashboard/status')).toBe(true);
	});

	it('does not match production routes', () => {
		expect(isDesignPath('/')).toBe(false);
		expect(isDesignPath('/designs')).toBe(false);
		expect(isDesignPath('/settings')).toBe(false);
	});
});

describe('crossedDesignBoundary', () => {
	it('is true only when entering or leaving /design', () => {
		expect(crossedDesignBoundary('/', '/design')).toBe(true);
		expect(crossedDesignBoundary('/design', '/')).toBe(true);
		expect(crossedDesignBoundary('/design', '/design/dashboard')).toBe(false);
		expect(crossedDesignBoundary('/settings', '/')).toBe(false);
	});
});

describe('applyDesignPreviewThemeFromSession', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		document.documentElement.removeAttribute('data-theme');
	});

	it('sets data-theme from sessionStorage without touching localStorage', () => {
		const session = new Map<string, string>([[DESIGN_PREVIEW_THEME_KEY, 'union']]);
		const local = new Map<string, string>([['pacto_theme', 'midnight']]);
		vi.stubGlobal('sessionStorage', {
			getItem: (key: string) => session.get(key) ?? null,
			setItem: vi.fn(),
		});
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => local.get(key) ?? null,
			setItem: vi.fn(),
		});

		applyDesignPreviewThemeFromSession();

		expect(document.documentElement.getAttribute('data-theme')).toBe('union');
		expect(local.get('pacto_theme')).toBe('midnight');
	});
});

describe('createOnce', () => {
	it('runs the wrapped function only on the first call', () => {
		const fn = vi.fn();
		const start = createOnce(fn);

		start();
		start();
		start();

		expect(fn).toHaveBeenCalledTimes(1);
	});
});
