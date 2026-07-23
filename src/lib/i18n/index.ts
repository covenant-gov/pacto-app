import { init, addMessages, locale, waitLocale } from 'svelte-i18n';

export const DEFAULT_LOCALE = 'en';
export const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

interface LocaleModule {
	[key: string]: unknown;
	default: Record<string, string>;
}

function isLocaleModule(value: unknown): value is LocaleModule {
	if (typeof value !== 'object' || value === null) return false;
	if (!('default' in value)) return false;
	const candidate = value as { default: unknown };
	return typeof candidate.default === 'object' && candidate.default !== null;
}

function mergeLocaleModules(modules: Record<string, unknown>): Record<string, string> {
	const merged: Record<string, string> = {};
	for (const mod of Object.values(modules)) {
		if (!isLocaleModule(mod)) continue;
		Object.assign(merged, mod.default);
	}
	return merged;
}

const enMessages = mergeLocaleModules(import.meta.glob('./locales/en/*.json', { eager: true }));
const esMessages = mergeLocaleModules(import.meta.glob('./locales/es/*.json', { eager: true }));

/** Initialize or re-initialize the i18n runtime. Called from the root layout and tests. */
export async function initI18n(initialLocale: SupportedLocale = DEFAULT_LOCALE): Promise<void> {
	addMessages(DEFAULT_LOCALE, enMessages);
	addMessages('es', esMessages);
	init({
		fallbackLocale: DEFAULT_LOCALE,
		initialLocale,
		handleMissingMessage: ({ locale: missingLocale, id, defaultValue }) => {
			if (missingLocale !== DEFAULT_LOCALE) {
				const fallback = enMessages[id];
				if (fallback !== undefined) return fallback;
			}
			return defaultValue ?? id;
		},
	});
	locale.set(initialLocale);
	await waitLocale();
}

export { format, waitLocale, getLocaleFromNavigator } from 'svelte-i18n';
export { locale };
