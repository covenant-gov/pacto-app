#!/usr/bin/env node
// Flags string-literal UI copy that bypasses svelte-i18n.
// `@intlify/svelte/no-raw-text` only sees Svelte template text nodes; copy built
// in TS modules and `<script>` never trips it. This ratchet catches common
// escape hatches: `showToast('English…')`, `confirm`/`alert` literals, and
// non-empty `getInvokeErrorMessage` string-literal fallbacks (including raw
// i18n keys passed instead of `get(t)('…')`).
//
// Allowed: `showToast(get(t)('…'))`, `getInvokeErrorMessage(e, get(t)('…'))`,
// `getInvokeErrorMessage(e, '')` (empty = no fallback for marker matching),
// variables, and template literals that are not plain quoted English.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(repoRoot, 'src');

const SKIP_DIRS = new Set([
	'node_modules',
	'.svelte-kit',
	'dist',
	'build',
	'lib/components/ui',
	'routes/design',
	'components/ui/interop-fixtures',
]);

const SKIP_FILE_RE = /\.test\.(ts|js|svelte)$/;

/** `showToast('…')` / `showToast("…")` with a non-empty literal first arg. */
const LITERAL_TOAST_RE = /\bshowToast\s*\(\s*(['"])((?:\\.|(?!\1).)+)\1/g;

/** `confirm('…')` / `alert('…')` / `window.confirm('…')` / `window.alert('…')`. */
const LITERAL_DIALOG_RE =
	/\b(?:window\s*\.\s*)?(?:confirm|alert)\s*\(\s*(['"])((?:\\.|(?!\1).)+)\1/g;

/**
 * Second arg to getInvokeErrorMessage that is a non-empty string literal.
 * Empty `''` is allowed (marker matching). Callers must pass `get(t)('…')`.
 */
const LITERAL_INVOKE_FALLBACK_RE =
	/\bgetInvokeErrorMessage\s*\(\s*[^,)]+,\s*(['"])((?:\\.|(?!\1).)+)\1/g;

function shouldSkipDir(relFromSrc) {
	return [...SKIP_DIRS].some((d) => relFromSrc === d || relFromSrc.startsWith(`${d}/`));
}

function walk(dir, out) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const abs = join(dir, entry.name);
		const rel = relative(srcRoot, abs).replaceAll('\\', '/');
		if (entry.isDirectory()) {
			if (shouldSkipDir(rel)) continue;
			walk(abs, out);
			continue;
		}
		if (!/\.(ts|svelte|js)$/.test(entry.name)) continue;
		if (SKIP_FILE_RE.test(entry.name)) continue;
		out.push(abs);
	}
}

function stripComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function collectHits(content, re, kind) {
	const hits = [];
	re.lastIndex = 0;
	let m;
	while ((m = re.exec(content))) {
		const before = content.slice(0, m.index);
		const line = before.split('\n').length;
		hits.push({ line, kind, text: m[2] });
	}
	return hits;
}

function findHits(filePath) {
	const raw = readFileSync(filePath, 'utf8');
	const content = stripComments(raw);
	return [
		...collectHits(content, LITERAL_TOAST_RE, 'showToast'),
		...collectHits(content, LITERAL_DIALOG_RE, 'confirm/alert'),
		...collectHits(content, LITERAL_INVOKE_FALLBACK_RE, 'getInvokeErrorMessage'),
	];
}

const files = [];
walk(srcRoot, files);
const offenders = [];
for (const file of files) {
	for (const hit of findHits(file)) {
		offenders.push({ file: relative(repoRoot, file).replaceAll('\\', '/'), ...hit });
	}
}

if (offenders.length > 0) {
	console.error(
		'Hardcoded UI string literals found. Pass get(t)(\'namespace.key\') (or a localized variable) instead:\n',
	);
	for (const o of offenders) {
		console.error(`  ${o.file}:${o.line}  [${o.kind}] '${o.text}'`);
	}
	process.exit(1);
}

console.log(
	'check-hardcoded-toasts: ok (0 literal showToast / confirm|alert / getInvokeErrorMessage fallbacks)',
);
