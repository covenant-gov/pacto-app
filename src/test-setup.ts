import { beforeEach, afterEach } from 'vitest';
import { initI18n, DEFAULT_LOCALE } from './lib/i18n';
import { locale } from 'svelte-i18n';

/** Node 25+ exposes a `localStorage` getter that is `undefined` unless
 * `--localstorage-file` is set. jsdom then skips installing Storage. */
function ensureLocalStorage(): void {
	const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	if (!desc) return;
	const value = 'value' in desc ? desc.value : undefined;
	if (value && typeof value.getItem === 'function' && typeof value.setItem === 'function') {
		return;
	}
	const store = new Map<string, string>();
	const memory = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(String(key), String(value));
		},
		removeItem: (key: string) => {
			store.delete(String(key));
		},
		clear: () => {
			store.clear();
		},
		key: (index: number) => [...store.keys()][index] ?? null,
		get length() {
			return store.size;
		},
	} satisfies Storage;
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		enumerable: true,
		writable: true,
		value: memory,
	});
}

ensureLocalStorage();

beforeEach(async () => {
	ensureLocalStorage();
	await initI18n(DEFAULT_LOCALE);
});

afterEach(() => {
	locale.set(DEFAULT_LOCALE);
});
