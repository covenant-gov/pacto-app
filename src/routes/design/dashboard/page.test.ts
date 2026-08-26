import { describe, expect, it } from 'vitest';

describe('design dashboard root load', () => {
	it('redirects to /design/dashboard/status', async () => {
		const { isRedirect } = await import('@sveltejs/kit');
		const { load } = await import('./+page');

		try {
			load();
			expect.fail('expected a redirect');
		} catch (error) {
			expect(isRedirect(error)).toBe(true);
			if (isRedirect(error)) {
				expect(error.status).toBe(307);
				expect(error.location).toBe('/design/dashboard/status');
			}
		}
	});
});
