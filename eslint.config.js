import js from '@eslint/js';
import globals from 'globals';
import svelte from 'eslint-plugin-svelte';
import ts from 'typescript-eslint';

/** @type {import('eslint').Linter.Config[]} */
export default [
	{ ignores: ['.svelte-kit/', 'build/', 'coverage/', 'dist/', 'node_modules/', 'src-tauri/target/', 'static/js/'] },
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		},
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
			]
		}
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser
			}
		},
		rules: {
			// The project uses legacy Svelte 4 reactive patterns in Svelte 5.
			// Core ESLint 10 and Svelte 5 recommended rules flag these idioms as errors,
			// so disable them for .svelte files.
			'no-useless-assignment': 'off',
			'@typescript-eslint/no-unused-expressions': 'off',
			'svelte/infinite-reactive-loop': 'off',
			'svelte/prefer-svelte-reactivity': 'off',
			'svelte/no-immutable-reactive-statements': 'off',
			'svelte/no-reactive-literals': 'off'
		}
	}
];
