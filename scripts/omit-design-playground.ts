import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DESIGN_ROUTES = path.join(root, 'src/routes/design');
export const DESIGN_STASH = path.join(root, 'node_modules/.cache/pacto-omit-design/design');

export function viteIsProductionBuild(): boolean {
	if (process.env.PACTO_INCLUDE_DESIGN === '1') return false;
	return process.argv.includes('build');
}

export function restoreDesignRoutes(): void {
	if (fs.existsSync(DESIGN_STASH) && !fs.existsSync(DESIGN_ROUTES)) {
		fs.mkdirSync(path.dirname(DESIGN_ROUTES), { recursive: true });
		fs.renameSync(DESIGN_STASH, DESIGN_ROUTES);
	}
}

export function hideDesignRoutes(): void {
	restoreDesignRoutes();
	if (!viteIsProductionBuild()) return;
	if (!fs.existsSync(DESIGN_ROUTES)) return;
	fs.mkdirSync(path.dirname(DESIGN_STASH), { recursive: true });
	if (fs.existsSync(DESIGN_STASH)) {
		fs.rmSync(DESIGN_STASH, { recursive: true, force: true });
	}
	fs.renameSync(DESIGN_ROUTES, DESIGN_STASH);
}

export function omitDesignPlaygroundPlugin(): Plugin {
	return {
		name: 'omit-design-playground',
		enforce: 'pre',
		buildEnd() {
			restoreDesignRoutes();
		},
		closeBundle() {
			restoreDesignRoutes();
		},
		configureServer() {
			restoreDesignRoutes();
		},
	};
}
