/**
 * Compute the next package version for Prepare Release.
 *
 * prerelease=none: normal bump, or strip -beta.N when promoting.
 * prerelease=beta: start or continue a -beta.N train (see docs/build/OPERATOR_UPDATES.md).
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BUMPS = new Set(['patch', 'minor', 'major']);
const CHANNELS = new Set(['none', 'beta']);
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([a-zA-Z0-9.-]+))?$/;

export function parseVersion(version) {
  const match = VERSION_RE.exec(version ?? '');
  if (!match) return null;
  return {
    base: `${match[1]}.${match[2]}.${match[3]}`,
    prerelease: match[4] ?? null,
  };
}

export function bumpBase(base, bump) {
  const parsed = parseVersion(base);
  if (!parsed || parsed.prerelease) {
    throw new Error(`Expected an X.Y.Z base version, got ${base}`);
  }
  const [major, minor, patch] = parsed.base.split('.').map(Number);
  switch (bump) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'major':
      return `${major + 1}.0.0`;
    default:
      throw new Error(`Unknown bump type: ${bump}`);
  }
}

function betaNumber(prerelease) {
  const match = /^beta\.(\d+)$/.exec(prerelease ?? '');
  return match ? Number(match[1]) : null;
}

/**
 * @param {string} current package.json version
 * @param {'patch'|'minor'|'major'} bump
 * @param {'none'|'beta'} prerelease
 */
export function computeNextVersion(current, bump, prerelease = 'none') {
  if (!BUMPS.has(bump)) throw new Error(`bump must be patch, minor, or major (got ${bump})`);
  if (!CHANNELS.has(prerelease)) throw new Error(`prerelease must be none or beta (got ${prerelease})`);

  const parsed = parseVersion(current);
  if (!parsed) throw new Error(`Invalid current version: ${current}`);

  if (prerelease === 'none') {
    if (betaNumber(parsed.prerelease) !== null) return parsed.base;
    return bumpBase(parsed.base, bump);
  }

  const currentBeta = betaNumber(parsed.prerelease);
  // On an existing beta train, patch continues the same base; minor/major open a new train.
  const targetBase =
    currentBeta !== null && bump === 'patch' ? parsed.base : bumpBase(parsed.base, bump);

  if (currentBeta !== null && targetBase === parsed.base) {
    return `${targetBase}-beta.${currentBeta + 1}`;
  }
  return `${targetBase}-beta.1`;
}

function main(argv) {
  const [current, bump, prerelease = 'none'] = argv;
  if (!current || !bump) {
    console.error('Usage: node scripts/compute-next-version.mjs <current> <patch|minor|major> [none|beta]');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${computeNextVersion(current, bump, prerelease)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
