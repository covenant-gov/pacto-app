#!/usr/bin/env node
// Ratchet for Settings / Profile UI patterns. Scoped to
// src/components/settings/** and src/components/profile/**.
// Cookbook: docs/wallet/SETTINGS_LAYOUT.md (Building blocks).

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const roots = [
	join(repoRoot, 'src/components/settings'),
	join(repoRoot, 'src/components/profile'),
];

/** Visible Refresh / Edit as button or link text. */
const VISIBLE_REFRESH_EDIT_RE =
	/<(?:button|a)\b[^>]*>\s*(?:Refresh|Edit)\s*<\/(?:button|a)>/gi;

/** Always-visible tip-style paragraphs / classes (empty states use *-empty / *-muted / role=alert). */
const HINT_CLASS_RE =
	/\bclass\s*=\s*(['"])[^'"]*\bhint\b[^'"]*\1/gi;

/** Local shortAddr helper — use shortEvmAddress instead. */
const LOCAL_SHORT_ADDR_RE = /\bfunction\s+shortAddr\b/g;

/** Inline kebab / three-dot menu triggers that are not MoreActionsMenu. */
const FORBIDDEN_KEBAB_CLASS_RE =
	/\b(?:evm-account-menu-trigger|more-menu-trigger|kebab-trigger)\b/g;

/** Public keys use CopyableKeyPill, which owns CopyIconButton. */
const BARE_COPY_BUTTON_RE = /\bimport\s+CopyIconButton\b/g;

/** Hand-rolled outside-click close. Use DropdownMenu. */
const OUTSIDE_POINTER_RE = /addEventListener\(\s*['"]pointerdown['"]/g;

function walk(dir, out) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const abs = join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(abs, out);
			continue;
		}
		if (!/\.svelte$/.test(entry.name)) continue;
		out.push(abs);
	}
}

function lineOf(content, index) {
	return content.slice(0, index).split('\n').length;
}

function collect(content, re, kind) {
	const hits = [];
	re.lastIndex = 0;
	let m;
	while ((m = re.exec(content))) {
		hits.push({ line: lineOf(content, m.index), kind, text: m[0].slice(0, 80) });
	}
	return hits;
}

function findHits(filePath) {
	const content = readFileSync(filePath, 'utf8');
	return [
		...collect(content, VISIBLE_REFRESH_EDIT_RE, 'visible Refresh/Edit label'),
		...collect(content, HINT_CLASS_RE, 'hint class (use InfoTip or *-empty / *-muted)'),
		...collect(content, LOCAL_SHORT_ADDR_RE, 'local shortAddr (use shortEvmAddress)'),
		...collect(content, FORBIDDEN_KEBAB_CLASS_RE, 'inline kebab trigger (use MoreActionsMenu)'),
		...collect(content, BARE_COPY_BUTTON_RE, 'bare CopyIconButton (use CopyableKeyPill)'),
		...collect(content, OUTSIDE_POINTER_RE, 'hand-rolled outside-click (use DropdownMenu)'),
	];
}

const files = [];
for (const root of roots) walk(root, files);

const offenders = [];
for (const file of files) {
	for (const hit of findHits(file)) {
		offenders.push({
			file: relative(repoRoot, file).replaceAll('\\', '/'),
			...hit,
		});
	}
}

if (offenders.length === 0) {
	console.log(
		`check-settings-profile-ui: ok (${files.length} files under settings/ + profile/)`,
	);
	process.exit(0);
}

console.error('check-settings-profile-ui: Settings/Profile UI pattern violations:\n');
for (const o of offenders) {
	console.error(`  ${o.file}:${o.line}  [${o.kind}]  ${o.text}`);
}
console.error(
	'\nSee docs/wallet/SETTINGS_LAYOUT.md → Building blocks. Fix or use InfoTip / shared helpers.',
);
process.exit(1);
