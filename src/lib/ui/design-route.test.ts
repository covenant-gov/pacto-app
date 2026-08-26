import { describe, expect, it, vi } from 'vitest';
import { createOnce, isDesignPath } from './design-route';

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
