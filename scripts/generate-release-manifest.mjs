#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OWNER = 'covenant-gov';
const REPO = 'pacto-app';

/**
 * Map a GitHub release asset filename to platform, architecture, and a human label.
 * Returns null for non-installer artifacts (e.g., signatures, latest.json).
 */
export function parseAsset(name) {
  const lower = name.toLowerCase();

  if (lower.endsWith('.sig') || lower === 'latest.json') return null;

  let platform = null;
  if (lower.endsWith('.dmg')) platform = 'macos';
  else if (lower.endsWith('.appimage')) platform = 'linux';
  else if (lower.endsWith('.msi') || lower.endsWith('.exe')) platform = 'windows';
  else if (lower.endsWith('.deb')) platform = 'linux';

  if (!platform) return null;

  let arch = 'unknown';
  if (lower.includes('aarch64') || lower.includes('arm64')) arch = 'aarch64';
  else if (lower.includes('x64') || lower.includes('x86_64') || lower.includes('amd64') || lower.includes('intel')) arch = 'x86_64';
  else if (lower.includes('arm')) arch = 'aarch64';

  let label = 'Unknown';
  if (platform === 'macos') {
    label = arch === 'aarch64' ? 'macOS Apple Silicon' : arch === 'x86_64' ? 'macOS Intel' : 'macOS';
  } else if (platform === 'windows') {
    if (lower.endsWith('.msi')) label = 'Windows Installer (MSI)';
    else if (lower.endsWith('.exe')) label = 'Windows Installer (.exe)';
    else label = 'Windows';
  } else if (platform === 'linux') {
    if (lower.endsWith('.appimage')) label = arch === 'aarch64' ? 'Linux AppImage (arm64)' : 'Linux AppImage (x64)';
    else if (lower.endsWith('.deb')) label = arch === 'aarch64' ? 'Linux Debian/Ubuntu (arm64)' : 'Linux Debian/Ubuntu (x64)';
    else label = 'Linux';
  }

  return { platform, arch, label };
}

/**
 * Find the matching .sig file for an installer asset, if one exists.
 */
export function findSignatureAsset(name, allAssets) {
  const sigName = `${name}.sig`;
  return allAssets.find(a => a.name === sigName) || null;
}

/**
 * Build the release manifest from GitHub release data.
 */
export function buildManifest(tag, publishedAt, releaseUrl, assets) {
  const entries = [];

  for (const asset of assets) {
    const parsed = parseAsset(asset.name);
    if (!parsed) continue;

    const sigAsset = findSignatureAsset(asset.name, assets);
    entries.push({
      name: asset.name,
      platform: parsed.platform,
      arch: parsed.arch,
      label: parsed.label,
      url: asset.browser_download_url || asset.url,
      size: asset.size,
      ...(sigAsset ? { signatureUrl: sigAsset.browser_download_url || sigAsset.url } : {}),
    });
  }

  if (entries.length === 0) {
    throw new Error(`Release ${tag} has no installer assets.`);
  }

  return {
    tag,
    publishedAt,
    releaseUrl,
    assets: entries,
  };
}

async function fetchRelease(tag, token) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${tag}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchLatestRelease(token) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function getReleaseTag() {
  const fromArg = process.argv[2];
  if (fromArg) return fromArg;

  const fromEnv = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME;
  if (fromEnv) return fromEnv;

  return null;
}

async function main() {
  const tag = getReleaseTag();
  const release = tag
    ? await fetchRelease(tag, process.env.GITHUB_TOKEN)
    : await fetchLatestRelease(process.env.GITHUB_TOKEN);
  const manifest = buildManifest(release.tag_name, release.published_at, release.html_url, release.assets);

  const outputPath = resolve(__dirname, '..', 'landing', 'public', 'pacto-release.json');
  writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Wrote manifest for ${manifest.tag} with ${manifest.assets.length} installer(s) to ${outputPath}`);
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

export { main };
