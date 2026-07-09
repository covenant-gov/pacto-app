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
	},
	// Temporary suppressions for files whose remaining lint errors require
	// behavioral fixes. These are being addressed in the parent lint PR and
	// will be removed once the risky changes land.
	{
		files: ['src/components/auth/Login.svelte', 'src/components/settings/ProfileSection.svelte'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off'
		}
	},
	{
		files: [
			'src/components/parent/DashboardPollsPanel.svelte',
			'src/lib/api/encryption.ts',
			'src/routes/+page.svelte'
		],
		rules: {
			'preserve-caught-error': 'off'
		}
	},
	{
		files: ['src/lib/api/encryption.ts'],
		rules: {
			'@typescript-eslint/no-unused-vars': 'off'
		}
	},
	{
		files: ['src/components/parent/governance/PactoGovInfraList.svelte'],
		rules: {
			'svelte/no-navigation-without-resolve': 'off'
		}
	},
	{
		files: ['src/lib/utils/message-formatting.ts'],
		rules: {
			'no-useless-escape': 'off'
		}
	},
	{
		files: ['src/stores/auth.ts', 'src/stores/profiles.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': 'off'
		}
	}
];
