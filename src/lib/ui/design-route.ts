export function isDesignPath(pathname: string): boolean {
	return pathname === '/design' || pathname.startsWith('/design/');
}

export const DESIGN_PREVIEW_THEME_KEY = 'pacto_design_theme';

export function crossedDesignBoundary(fromPathname: string, toPathname: string): boolean {
	return isDesignPath(fromPathname) !== isDesignPath(toPathname);
}

/** Attribute-only. Does not write `pacto_theme`. */
export function applyDesignPreviewThemeFromSession(): void {
	if (typeof document === 'undefined') return;
	let next = 'dark-techno';
	try {
		const raw = sessionStorage.getItem(DESIGN_PREVIEW_THEME_KEY);
		if (raw) next = raw;
	} catch {
		// ignore
	}
	document.documentElement.setAttribute('data-theme', next);
}

export function createOnce(fn: () => void): () => void {
	let done = false;
	return () => {
		if (done) return;
		done = true;
		fn();
	};
}
