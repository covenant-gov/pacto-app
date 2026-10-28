#!/usr/bin/env node
// Flags string-literal toast copy that bypasses svelte-i18n.
// `@intlify/svelte/no-raw-text` only sees Svelte template text nodes; toasts
// built in TS modules and `<script>` never trip it. This ratchet catches the
// common escape hatch: `showToast('English…')`.
//
// Allowed: `showToast(get(t)('…'))`, `showToast(variable)`, template literals
// that are not plain quoted English. Failures are new hardcoded literals only.

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

function findHits(filePath) {
	const raw = readFileSync(filePath, 'utf8');
	const content = stripComments(raw);
	const hits = [];
	let m;
	LITERAL_TOAST_RE.lastIndex = 0;
	while ((m = LITERAL_TOAST_RE.exec(content))) {
		const before = content.slice(0, m.index);
		const line = before.split('\n').length;
		hits.push({ line, text: m[2] });
	}
	return hits;
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
		'Hardcoded showToast() string literals found. Pass get(t)(\'namespace.key\') (or a localized variable) instead:\n',
	);
	for (const o of offenders) {
		console.error(`  ${o.file}:${o.line}  showToast('${o.text}')`);
	}
	process.exit(1);
}

console.log('check-hardcoded-toasts: ok (0 literal showToast strings)');
