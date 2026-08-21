import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
	DESIGN_ROUTES,
	DESIGN_STASH,
	hideDesignRoutes,
	restoreDesignRoutes,
	viteIsProductionBuild,
} from '../../../scripts/omit-design-playground.ts';

describe('omit-design-playground', () => {
	afterEach(() => {
		restoreDesignRoutes();
		delete process.env.PACTO_INCLUDE_DESIGN;
	});

	it('does not treat vitest as a production build', () => {
		expect(viteIsProductionBuild()).toBe(false);
		expect(fs.existsSync(DESIGN_ROUTES)).toBe(true);
	});

	it('leaves design routes in place outside vite build', () => {
		hideDesignRoutes();
		expect(fs.existsSync(DESIGN_ROUTES)).toBe(true);
		expect(fs.existsSync(DESIGN_STASH)).toBe(false);
	});
});
