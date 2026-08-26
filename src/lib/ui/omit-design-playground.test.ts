import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	DESIGN_ROUTES,
	DESIGN_STASH,
	hideDesignRoutes,
	restoreDesignRoutes,
	restoreStashedDirectory,
	stashDirectory,
	viteIsProductionBuild,
} from '../../../scripts/omit-design-playground';

describe('omit-design-playground', () => {
	afterEach(() => {
		restoreDesignRoutes();
		delete process.env.PACTO_INCLUDE_DESIGN;
	});

	it('does not treat vitest as a production build', () => {
		expect(viteIsProductionBuild()).toBe(false);
		expect(fs.existsSync(DESIGN_ROUTES)).toBe(true);
	});

	it('treats vite build argv as production unless PACTO_INCLUDE_DESIGN=1', () => {
		const argv = ['node', 'vite', 'build'];
		expect(viteIsProductionBuild(argv, {})).toBe(true);
		expect(viteIsProductionBuild(argv, { PACTO_INCLUDE_DESIGN: '1' })).toBe(false);
	});

	it('leaves design routes in place outside vite build', () => {
		hideDesignRoutes();
		expect(fs.existsSync(DESIGN_ROUTES)).toBe(true);
		expect(fs.existsSync(DESIGN_STASH)).toBe(false);
	});

	it('stashes and restores a directory the way production builds do', () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omit-design-'));
		const source = path.join(tmp, 'design');
		const stash = path.join(tmp, 'stash');
		fs.mkdirSync(source);
		fs.writeFileSync(path.join(source, 'keep.txt'), 'ok');

		stashDirectory(source, stash);
		expect(fs.existsSync(source)).toBe(false);
		expect(fs.existsSync(path.join(stash, 'keep.txt'))).toBe(true);

		restoreStashedDirectory(source, stash);
		expect(fs.readFileSync(path.join(source, 'keep.txt'), 'utf8')).toBe('ok');
		expect(fs.existsSync(stash)).toBe(false);
	});

	it('registers SIGINT and SIGTERM restore on the production omit path', () => {
		const src = fs.readFileSync(
			path.join(process.cwd(), 'scripts/omit-design-playground.ts'),
			'utf8',
		);
		expect(src).toContain('SIGINT');
		expect(src).toContain('SIGTERM');
		expect(src).toContain('registerDesignRouteRestoreHandlers');
	});
});
