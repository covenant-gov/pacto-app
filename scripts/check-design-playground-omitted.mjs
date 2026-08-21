#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.VITE_AGENT_BUILD ? 'build-agent' : 'build';
const needles = ['design.gate.wordmark', 'DesignGate', 'design.dither.title', '/dither/bayer.svg'];

function walk(dir) {
	if (!fs.existsSync(dir)) {
		throw new Error(`missing frontend dist ${dir}`);
	}
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		return entry.isDirectory() ? walk(full) : [full];
	});
}

const ditherDir = path.join(root, 'dither');
if (fs.existsSync(ditherDir)) {
	console.error(`design playground assets packed: ${ditherDir}`);
	process.exit(1);
}

const hits = [];
for (const file of walk(root)) {
	if (!/\.(js|css|html|json|svg)$/.test(file)) continue;
	const text = fs.readFileSync(file, 'utf8');
	for (const needle of needles) {
		if (text.includes(needle)) {
			hits.push(`${file}: ${needle}`);
		}
	}
}

if (hits.length > 0) {
	console.error('design playground leaked into the production frontend dist:');
	for (const hit of hits) console.error(`  ${hit}`);
	process.exit(1);
}

console.log(`ok: no design playground in ${root}`);
