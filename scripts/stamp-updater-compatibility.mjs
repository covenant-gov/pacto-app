#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OWNER = 'covenant-gov';
const REPO = 'pacto-app';
const TRACKED_CONFIG_PATH = resolve(__dirname, 'release-compatibility.json');

// Strict semver core + optional leading 'v', pre-release, and build metadata.
// Anything that isn't this shape (including shell metacharacters) fails the
// test up front, before the value ever reaches a comparison, a file, or a
// command.
const VERSION_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * True when `value` is a syntactically valid (optionally `v`-prefixed) semver
 * string. Pure and side-effect free — safe to call on untrusted input before
 * any shell or network call.
 */
export function isSyntacticVersion(value) {
  return typeof value === 'string' && VERSION_PATTERN.test(value.trim());
}

/**
 * Strip an optional leading 'v' so tracked values, manifest versions, and
 * overrides all normalize to one form before comparison or storage.
 */
function normalizeVersion(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('v') || trimmed.startsWith('V') ? trimmed.slice(1) : trimmed;
}

function parseVersionParts(value) {
  const match = VERSION_PATTERN.exec(value);
  const [, major, minor, patch, prerelease] = match;
  return {
    core: [Number(major), Number(minor), Number(patch)],
    prerelease: prerelease ? prerelease.split('.') : [],
  };
}

function comparePrereleaseIdentifier(a, b) {
  const aIsNumeric = /^\d+$/.test(a);
  const bIsNumeric = /^\d+$/.test(b);
  if (aIsNumeric && bIsNumeric) return Number(a) - Number(b);
  if (aIsNumeric) return -1; // numeric identifiers have lower precedence
  if (bIsNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * SemVer 2.0.0 precedence comparator. Build metadata is ignored, as the spec
 * requires. Callers must have already confirmed both strings match
 * `VERSION_PATTERN`.
 */
function compareVersions(rawA, rawB) {
  const a = parseVersionParts(normalizeVersion(rawA));
  const b = parseVersionParts(normalizeVersion(rawB));

  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  }

  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1; // no pre-release outranks a pre-release
  if (b.prerelease.length === 0) return -1;

  const len = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < len; i++) {
    if (a.prerelease[i] === undefined) return -1; // fewer fields = lower precedence
    if (b.prerelease[i] === undefined) return 1;
    const cmp = comparePrereleaseIdentifier(a.prerelease[i], b.prerelease[i]);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

/**
 * Parse a manifest JSON string (e.g. a downloaded `latest.json`) into an
 * object. Throws with a clear message on invalid JSON rather than letting
 * `JSON.parse`'s error surface unannotated.
 */
export function parseManifest(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Could not parse manifest JSON: ${err.message}`, { cause: err });
  }
}

/**
 * Read `minimumCompatibleVersion` out of a parsed release-compatibility.json
 * object. Throws when the key is absent or not a string.
 */
export function readTrackedMinimum(config) {
  if (!config || typeof config.minimumCompatibleVersion !== 'string') {
    throw new Error("release-compatibility.json is missing a 'minimumCompatibleVersion' string.");
  }
  return config.minimumCompatibleVersion;
}

/**
 * Validate a candidate minimum-compatible-version against a manifest object.
 * Rejects (throws) when the value isn't a valid version string, or when it
 * is a valid version that is greater than the manifest's own `version`. The
 * syntax check runs first and does not need the manifest, so a malformed or
 * malicious value is rejected before anything else about it is inspected.
 * Returns the normalized (no leading 'v') version string on success.
 */
export function validateMinimumVersion(minimumRaw, manifest) {
  if (!isSyntacticVersion(minimumRaw)) {
    throw new Error(`Minimum compatible version '${minimumRaw}' is not a valid semantic version.`);
  }

  if (!manifest || !isSyntacticVersion(manifest.version)) {
    throw new Error('Manifest has no valid version field to validate the minimum against.');
  }

  const minimum = normalizeVersion(minimumRaw);
  const manifestVersion = normalizeVersion(manifest.version);

  if (compareVersions(minimum, manifestVersion) > 0) {
    throw new Error(
      `Minimum compatible version ${minimum} is greater than the release version ${manifestVersion}.`,
    );
  }

  return minimum;
}

/**
 * Merge a validated minimum-compatible-version into a manifest object as
 * `minimum_compatible_version`, matching the manifest's existing snake_case
 * `pub_date` key. Every other field is preserved untouched. Re-merging an
 * already-stamped manifest replaces the value in place rather than adding a
 * second key.
 */
export function mergeMinimumVersion(manifest, minimum) {
  return { ...manifest, minimum_compatible_version: minimum };
}

function ghUpload(tag, filePath) {
  execFileSync('gh', ['release', 'upload', tag, filePath, '--clobber'], {
    stdio: 'inherit',
    env: process.env,
  });
}

function ghDownloadLatestJson(tag, destDir) {
  execFileSync(
    'gh',
    [
      'release',
      'download',
      tag,
      '--repo',
      `${OWNER}/${REPO}`,
      '--pattern',
      'latest.json',
      '--dir',
      destDir,
      '--clobber',
    ],
    { stdio: 'inherit', env: process.env },
  );
}

function getTag() {
  const fromArg = process.argv[2];
  if (fromArg) return fromArg;

  const fromEnv = process.env.RELEASE_TAG;
  if (fromEnv) return fromEnv;

  const ref = process.env.GITHUB_REF;
  if (ref && ref.startsWith('refs/tags/')) {
    return ref.replace('refs/tags/', '');
  }

  return null;
}

/**
 * Optional override for the minimum, e.g. from a workflow_dispatch input.
 * Read from an explicit CLI argument or an env var so the workflow can pass
 * it through `env:` without ever interpolating it into a shell body.
 */
function getOverrideValue() {
  const fromArg = process.argv[3];
  if (fromArg && fromArg.trim()) return fromArg.trim();

  const fromEnv = process.env.OVERRIDE_MINIMUM_COMPATIBLE_VERSION;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  return null;
}

function readTrackedConfig() {
  return JSON.parse(readFileSync(TRACKED_CONFIG_PATH, 'utf8'));
}

async function main() {
  const tag = getTag();
  if (!tag) {
    throw new Error('No release tag provided (pass it as an argument, RELEASE_TAG, or a tag GITHUB_REF).');
  }

  // Reject a malformed or malicious override before it ever reaches a
  // command or a network call — the tracked-file fallback below only touches
  // the filesystem, never a shell.
  const overrideRaw = getOverrideValue();
  if (overrideRaw !== null && !isSyntacticVersion(overrideRaw)) {
    throw new Error(`Override minimum compatible version '${overrideRaw}' is not a valid semantic version.`);
  }
  const minimumRaw = overrideRaw ?? readTrackedMinimum(readTrackedConfig());

  const workDir = mkdtempSync(join(tmpdir(), 'stamp-updater-compatibility-'));
  ghDownloadLatestJson(tag, workDir);

  const manifestPath = join(workDir, 'latest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Expected ${manifestPath} to exist after downloading the release assets.`);
  }

  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  const minimum = validateMinimumVersion(minimumRaw, manifest);
  const merged = mergeMinimumVersion(manifest, minimum);

  writeFileSync(manifestPath, JSON.stringify(merged, null, 2) + '\n');
  ghUpload(tag, manifestPath);

  console.log(`Stamped ${tag}'s latest.json with minimum_compatible_version ${minimum}.`);
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

export { main };
