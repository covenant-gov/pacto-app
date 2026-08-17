import { describe, expect, it, vi } from 'vitest';
import en from './locales/en.json';
import es from './locales/es.json';

const environment = vi.hoisted(() => ({ dev: true }));

vi.mock('$app/environment', () => ({
	get dev() {
		return environment.dev;
	},
}));

describe('design layout load', () => {
	it('allows the route when dev is true', async () => {
		environment.dev = true;
		const { load } = await import('./+layout');
		expect(load()).toBeUndefined();
	});

	it('redirects home when dev is false', async () => {
		environment.dev = false;
		const { isRedirect } = await import('@sveltejs/kit');
		const { load } = await import('./+layout');

		try {
			load();
			expect.fail('expected a redirect');
		} catch (error) {
			expect(isRedirect(error)).toBe(true);
			if (isRedirect(error)) {
				expect(error.status).toBe(307);
				expect(error.location).toBe('/');
			}
		}
	});
});

describe('design locale catalogs', () => {
	it('keeps English and Spanish keys aligned', () => {
		expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
	});
});
