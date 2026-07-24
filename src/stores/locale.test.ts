import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { locale as svelteLocale } from 'svelte-i18n';
import {
	locale,
	setLocale,
	getStoredLocale,
	persistLocale,
	LOCALE_PREFIX,
	LOCALE_LAST_KEY,
	LOCALE_OPTIONS,
	initLocaleStore,
} from './locale';
import { setCurrentNpubForPersistence } from './persistence-context';

describe('locale store', () => {
	let storage: Map<string, string>;
	let documentAttribute: string | null;

	beforeEach(() => {
		storage = new Map();
		documentAttribute = null;

		vi.stubGlobal('localStorage', {
			getItem: (k: string) => storage.get(k) ?? null,
			setItem: (k: string, v: string) => storage.set(k, v),
			removeItem: (k: string) => storage.delete(k),
			clear: () => storage.clear(),
			key: (i: number) => [...storage.keys()][i] ?? null,
			get length() {
				return storage.size;
			},
		} as Storage);

		vi.stubGlobal('document', {
			documentElement: {
				setAttribute: (name: string, value: string) => {
					if (name === 'lang') documentAttribute = value;
				},
				getAttribute: (name: string) => (name === 'lang' ? documentAttribute : null),
			},
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		setCurrentNpubForPersistence(null);
		locale.set('en');
	});

	it('exposes supported locale options', () => {
		expect(LOCALE_OPTIONS.map((o) => o.value)).toEqual(['en', 'es']);
	});

	it('initializes to the globally stored last locale when no npub context exists', async () => {
		storage.set(LOCALE_LAST_KEY, 'es');
		await initLocaleStore();
		expect(get(locale)).toBe('es');
		expect(get(svelteLocale)).toBe('es');
	});

	it('initializes to default when no locale is stored and no global last locale exists', async () => {
		await initLocaleStore();
		expect(get(locale)).toBe('en');
		expect(get(svelteLocale)).toBe('en');
	});

	it('hydrates the persisted locale for an npub', async () => {
		const npub = 'npub1test';
		storage.set(`${LOCALE_PREFIX}_${npub}`, 'es');
		setCurrentNpubForPersistence(npub);
		await initLocaleStore();
		expect(get(locale)).toBe('es');
	});

	it('persists locale changes per npub and as a global fallback', async () => {
		const npub = 'npub1test';
		setCurrentNpubForPersistence(npub);
		await initLocaleStore();
		await setLocale('es');
		expect(storage.get(`${LOCALE_PREFIX}_${npub}`)).toBe('es');
		expect(storage.get(LOCALE_LAST_KEY)).toBe('es');
		expect(get(locale)).toBe('es');
		expect(get(svelteLocale)).toBe('es');
	});

	it('rejects unsupported locale values', async () => {
		const npub = 'npub1test';
		storage.set(`${LOCALE_PREFIX}_${npub}`, 'fr');
		setCurrentNpubForPersistence(npub);
		await initLocaleStore();
		expect(get(locale)).toBe('en');
	});

	it('returns null for getStoredLocale when persistence context has no npub', () => {
		setCurrentNpubForPersistence(null);
		expect(getStoredLocale()).toBeNull();
	});

	it('clears persisted locale when persistLocale receives null', () => {
		const npub = 'npub1test';
		setCurrentNpubForPersistence(npub);
		storage.set(`${LOCALE_PREFIX}_${npub}`, 'es');
		persistLocale(null);
		expect(storage.has(`${LOCALE_PREFIX}_${npub}`)).toBe(false);
	});
});
