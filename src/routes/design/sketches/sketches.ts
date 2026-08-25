import { THEME_OPTIONS, type Theme } from '../../../stores/theme';

/** Playground-only skins. Do not register in THEME_OPTIONS or app.html. */
export const SKETCH_THEME_OPTIONS = [
	{ value: 'techno-light-paper', label: 'Techno Light · Paper' },
	{ value: 'techno-light-signal', label: 'Techno Light · Signal' },
] as const;

export type SketchTheme = (typeof SKETCH_THEME_OPTIONS)[number]['value'];
export type DesignTheme = Theme | SketchTheme;

export const DESIGN_THEME_OPTIONS = [...THEME_OPTIONS, ...SKETCH_THEME_OPTIONS];

const SKETCH_THEME_SET = new Set<string>(SKETCH_THEME_OPTIONS.map((option) => option.value));
const SHIPPED_THEME_SET = new Set<string>(THEME_OPTIONS.map((option) => option.value));

const PREVIEW_STORAGE_KEY = 'pacto_design_theme';

export function isShippedTheme(value: string): value is Theme {
	return SHIPPED_THEME_SET.has(value);
}

export function isSketchTheme(value: string): value is SketchTheme {
	return SKETCH_THEME_SET.has(value);
}

export function isDesignTheme(value: string): value is DesignTheme {
	return isShippedTheme(value) || isSketchTheme(value);
}

export function applyPlaygroundTheme(value: DesignTheme): void {
	if (typeof document === 'undefined') return;
	document.documentElement.setAttribute('data-theme', value);
}

export function readDesignPreviewTheme(): DesignTheme | null {
	if (typeof sessionStorage === 'undefined') return null;
	try {
		const raw = sessionStorage.getItem(PREVIEW_STORAGE_KEY);
		if (!raw || !isSketchTheme(raw)) return null;
		return raw;
	} catch {
		return null;
	}
}

export function writeDesignPreviewTheme(value: DesignTheme): void {
	if (typeof sessionStorage === 'undefined') return;
	try {
		if (isSketchTheme(value)) {
			sessionStorage.setItem(PREVIEW_STORAGE_KEY, value);
			return;
		}
		sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
	} catch {
		// ignore
	}
}
