import { beforeEach, afterEach } from 'vitest';
import { initI18n, DEFAULT_LOCALE } from './lib/i18n';
import { locale } from 'svelte-i18n';

beforeEach(async () => {
	await initI18n(DEFAULT_LOCALE);
});

afterEach(() => {
	locale.set(DEFAULT_LOCALE);
});
