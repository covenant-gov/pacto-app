import { writable, type Writable } from 'svelte/store';
import { locale as svelteLocale, waitLocale } from 'svelte-i18n';
import { persistenceKey } from './persistence-context';
import { DEFAULT_LOCALE, type SupportedLocale, initI18n } from '../lib/i18n';

export const LOCALE_PREFIX = 'pacto_locale_v1';

/** Ordered supported locales with native labels. */
export const LOCALE_OPTIONS: { value: SupportedLocale; label: string }[] = [
	{ value: 'en', label: 'English' },
	{ value: 'es', label: 'Español' },
];

function isSupportedLocale(value: string): value is SupportedLocale {
	return LOCALE_OPTIONS.some((opt) => opt.value === value);
}

/** Read the persisted locale for the current npub from localStorage. */
export function getStoredLocale(): SupportedLocale | null {
	if (typeof localStorage === 'undefined') return null;
	const key = persistenceKey(LOCALE_PREFIX);
	if (!key) return null;
	const raw = localStorage.getItem(key);
	if (!raw) return null;
	if (!isSupportedLocale(raw)) return null;
	return raw;
}

/** Persist the locale for the current npub; pass null to clear. */
export function persistLocale(value: SupportedLocale | null): void {
	if (typeof localStorage === 'undefined') return;
	const key = persistenceKey(LOCALE_PREFIX);
	if (!key) return;
	if (value) {
		localStorage.setItem(key, value);
	} else {
		localStorage.removeItem(key);
	}
}

/** Reactive store for the active locale. Mirrors svelte-i18n locale. */
export const locale: Writable<SupportedLocale> = writable(DEFAULT_LOCALE);

/** Set the active locale, update svelte-i18n, and persist per npub. */
export async function setLocale(value: SupportedLocale): Promise<void> {
	if (!isSupportedLocale(value)) return;
	persistLocale(value);
	svelteLocale.set(value);
	locale.set(value);
	await waitLocale();
}

/** Initialize the locale store. Should be called once on app startup. */
export async function initLocaleStore(): Promise<void> {
	const stored = getStoredLocale();
	const initial = stored ?? DEFAULT_LOCALE;
	await initI18n(initial);
	locale.set(initial);
}

/** Hydrate the locale for an account after login/import/unlock. */
export function hydrateLocale(npub: string): void {
	const key = `${LOCALE_PREFIX}_${npub}`;
	if (typeof localStorage === 'undefined') return;
	const raw = localStorage.getItem(key);
	const value = raw && isSupportedLocale(raw) ? raw : DEFAULT_LOCALE;
	void setLocale(value);
}
