#!/usr/bin/env node
/**
 * Verify the draft release's latest.json is complete, then undraft it.
 * Called from release.yaml after stamp-updater-compatibility so
 * releases/latest never points at a half-built manifest.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseManifest } from './stamp-updater-compatibility.mjs';

const OWNER = 'covenant-gov';
const REPO = 'pacto-app';

/** Core updater keys each publish-tauri matrix leg must contribute. */
export const REQUIRED_UPDATER_PLATFORMS = [
  'darwin-aarch64',
  'darwin-x86_64',
  'linux-x86_64',
  'linux-aarch64',
  'windows-x86_64',
];

/**
 * Reject a manifest that is missing a matrix platform entry or (for stable
 * releases) the stamped minimum_compatible_version floor.
 */
export function assertManifestReadyToPublish(manifest, { requireMinimumCompatible = true } = {}) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Manifest is missing or not an object.');
  }

  const platforms = manifest.platforms;
  if (!platforms || typeof platforms !== 'object') {
    throw new Error('Manifest is missing a platforms object.');
  }

  const missing = REQUIRED_UPDATER_PLATFORMS.filter((id) => {
    const entry = platforms[id];
    return !entry || typeof entry !== 'object' || typeof entry.url !== 'string' || !entry.url;
  });
  if (missing.length > 0) {
    throw new Error(`Manifest is missing required updater platforms: ${missing.join(', ')}.`);
  }

  if (requireMinimumCompatible) {
    const floor = manifest.minimum_compatible_version;
    if (typeof floor !== 'string' || !floor.trim()) {
      throw new Error('Manifest is missing minimum_compatible_version.');
    }
  }

  return true;
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

function ghPublishRelease(tag) {
  execFileSync('gh', ['release', 'edit', tag, '--repo', `${OWNER}/${REPO}`, '--draft=false'], {
    stdio: 'inherit',
    env: process.env,
  });
}

async function main() {
  const tag = getTag();
  if (!tag) {
    throw new Error('No release tag provided (pass it as an argument, RELEASE_TAG, or a tag GITHUB_REF).');
  }

  const workDir = mkdtempSync(join(tmpdir(), 'publish-github-release-'));
  ghDownloadLatestJson(tag, workDir);

  const manifestPath = join(workDir, 'latest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Expected ${manifestPath} to exist after downloading the release assets.`);
  }

  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  assertManifestReadyToPublish(manifest, { requireMinimumCompatible: true });

  ghPublishRelease(tag);
  console.log(`Published ${tag}: latest.json verified and release undrafted.`);
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

export { main };
