import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { locale, t, waitLocale } from 'svelte-i18n';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './index';

describe('i18n', () => {
	beforeEach(async () => {
		await waitLocale();
	});

	afterEach(async () => {
		locale.set(DEFAULT_LOCALE);
		await waitLocale();
	});

	it('starts with the default locale', () => {
		expect(get(locale)).toBe(DEFAULT_LOCALE);
		expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE);
	});

	it('renders English messages', () => {
		expect(get(t)('test.hello')).toBe('Hello');
	});

	it('renders Spanish messages after switching locale', async () => {
		locale.set('es');
		await waitLocale();
		expect(get(t)('test.hello')).toBe('Hola');
	});

	it('renders ICU plurals correctly in English', () => {
		const tFn = get(t);
		expect(tFn('test.items', { values: { count: 0 } })).toBe('No items');
		expect(tFn('test.items', { values: { count: 1 } })).toBe('One item');
		expect(tFn('test.items', { values: { count: 2 } })).toBe('2 items');
	});

	it('renders ICU plurals correctly in Spanish', async () => {
		locale.set('es');
		await waitLocale();
		const tFn = get(t);
		expect(tFn('test.items', { values: { count: 0 } })).toBe('Sin elementos');
		expect(tFn('test.items', { values: { count: 1 } })).toBe('Un elemento');
		expect(tFn('test.items', { values: { count: 2 } })).toBe('2 elementos');
	});

	it('falls back to English for a missing Spanish key', async () => {
		locale.set('es');
		await waitLocale();
		expect(get(t)('test.hello')).toBe('Hola');
		expect(get(t)('missing.only.en', { default: 'Fallback' })).toBe('Fallback');
	});
});
