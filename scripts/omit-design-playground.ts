import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DESIGN_ROUTES = path.join(root, 'src/routes/design');
export const DESIGN_STASH = path.join(root, 'node_modules/.cache/pacto-omit-design/design');

export function viteIsProductionBuild(
	argv: readonly string[] = process.argv,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	if (env.PACTO_INCLUDE_DESIGN === '1') return false;
	return argv.includes('build');
}

export function restoreStashedDirectory(source: string, stash: string): void {
	if (fs.existsSync(stash) && !fs.existsSync(source)) {
		fs.mkdirSync(path.dirname(source), { recursive: true });
		fs.renameSync(stash, source);
	}
}

export function stashDirectory(source: string, stash: string): void {
	if (!fs.existsSync(source)) return;
	fs.mkdirSync(path.dirname(stash), { recursive: true });
	if (fs.existsSync(stash)) {
		fs.rmSync(stash, { recursive: true, force: true });
	}
	fs.renameSync(source, stash);
}

export function restoreDesignRoutes(): void {
	restoreStashedDirectory(DESIGN_ROUTES, DESIGN_STASH);
}

export function hideDesignRoutes(): void {
	restoreDesignRoutes();
	if (!viteIsProductionBuild()) return;
	stashDirectory(DESIGN_ROUTES, DESIGN_STASH);
}

export function registerDesignRouteRestoreHandlers(): void {
	process.on('exit', restoreDesignRoutes);
	if (!viteIsProductionBuild()) return;
	const restoreAndExit = (code: number) => {
		restoreDesignRoutes();
		process.exit(code);
	};
	process.once('SIGINT', () => restoreAndExit(130));
	process.once('SIGTERM', () => restoreAndExit(143));
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
