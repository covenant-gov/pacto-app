import { describe, it, expect } from 'vitest';
import { IntlMessageFormat } from 'intl-messageformat';

const localeModules = import.meta.glob('./locales/**/*.json', { eager: true }) as Record<
	string,
	{ default: Record<string, string> }
>;

function isLocalePath(path: string, locale: string): boolean {
	return path.startsWith(`./locales/${locale}/`);
}

function extractICUVariables(message: string): Set<string> {
	const found = new Set<string>();
	const matches = message.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)(?:[,!:]|\}\})/g);
	for (const match of matches) {
		found.add(match[1]);
	}
	return found;
}

describe('locale files', () => {
	it('every English namespace has a matching Spanish file', () => {
		for (const enPath of Object.keys(localeModules).filter((p) => isLocalePath(p, 'en')).sort()) {
			const esPath = enPath.replace('./locales/en/', './locales/es/');
			expect(localeModules[esPath]).toBeDefined();
		}
	});

	it('English and Spanish locale files share the same keys per namespace', () => {
		for (const [enPath, enMod] of Object.entries(localeModules)) {
			if (!isLocalePath(enPath, 'en')) continue;
			const esPath = enPath.replace('./locales/en/', './locales/es/');
			const esMod = localeModules[esPath];
			if (!esMod) continue;
			const enKeys = Object.keys(enMod.default).sort();
			const esKeys = Object.keys(esMod.default).sort();
			expect(esKeys).toEqual(enKeys);
		}
	});

	it('Spanish ICU messages include all variables used in English', () => {
		for (const [enPath, enMod] of Object.entries(localeModules)) {
			if (!isLocalePath(enPath, 'en')) continue;
			const esPath = enPath.replace('./locales/en/', './locales/es/');
			const esMod = localeModules[esPath];
			if (!esMod) continue;
			for (const key of Object.keys(enMod.default)) {
				const enVars = extractICUVariables(enMod.default[key]);
				const esVars = extractICUVariables(esMod.default[key]);
				for (const v of enVars) {
					expect(esVars.has(v), `${key} missing Spanish var ${v}`).toBe(true);
				}
			}
		}
	});

	it('all ICU plurals are syntactically valid in English and Spanish', () => {
		for (const [enPath, enMod] of Object.entries(localeModules)) {
			if (!isLocalePath(enPath, 'en')) continue;
			const esPath = enPath.replace('./locales/en/', './locales/es/');
			const esMod = localeModules[esPath];
			if (!esMod) continue;
			for (const [key, message] of Object.entries(enMod.default)) {
				if (!message.includes('plural') && !message.includes('select')) continue;
				expect(() => new IntlMessageFormat(message, 'en'), `en ${key}`).not.toThrow();
				expect(() => new IntlMessageFormat(esMod.default[key], 'es'), `es ${key}`).not.toThrow();
			}
		}
	});
});
