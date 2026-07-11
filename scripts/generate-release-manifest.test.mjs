import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAsset, findSignatureAsset, buildManifest } from './generate-release-manifest.mjs';

describe('parseAsset', () => {
  it('maps macOS DMG assets by architecture', () => {
    assert.deepEqual(parseAsset('pacto_0.2.0_aarch64.dmg'), {
      platform: 'macos',
      arch: 'aarch64',
      label: 'macOS Apple Silicon',
    });
    assert.deepEqual(parseAsset('pacto_0.2.0_x64.dmg'), {
      platform: 'macos',
      arch: 'x86_64',
      label: 'macOS Intel',
    });
  });

  it('maps Linux AppImage assets by architecture', () => {
    assert.deepEqual(parseAsset('pacto_0.2.0_amd64.AppImage'), {
      platform: 'linux',
      arch: 'x86_64',
      label: 'Linux AppImage (x64)',
    });
    assert.deepEqual(parseAsset('pacto_0.2.0_arm64.AppImage'), {
      platform: 'linux',
      arch: 'aarch64',
      label: 'Linux AppImage (arm64)',
    });
  });

  it('maps Windows installer assets', () => {
    assert.deepEqual(parseAsset('pacto_0.2.0_x64-setup.exe'), {
      platform: 'windows',
      arch: 'x86_64',
      label: 'Windows Installer (.exe)',
    });
    assert.deepEqual(parseAsset('pacto_0.2.0_x64_en-US.msi'), {
      platform: 'windows',
      arch: 'x86_64',
      label: 'Windows Installer (MSI)',
    });
  });

  it('excludes signatures and latest.json', () => {
    assert.equal(parseAsset('pacto_0.2.0_aarch64.dmg.sig'), null);
    assert.equal(parseAsset('latest.json'), null);
  });

  it('returns null for unknown artifacts', () => {
    assert.equal(parseAsset('pacto_0.2.0_source.zip'), null);
    assert.equal(parseAsset('checksums.txt'), null);
  });
});

describe('findSignatureAsset', () => {
  it('returns the matching signature asset when present', () => {
    const assets = [
      { name: 'pacto_0.2.0_aarch64.dmg', browser_download_url: 'https://example.com/dmg' },
      { name: 'pacto_0.2.0_aarch64.dmg.sig', browser_download_url: 'https://example.com/sig' },
    ];
    const sig = findSignatureAsset('pacto_0.2.0_aarch64.dmg', assets);
    assert.equal(sig.name, 'pacto_0.2.0_aarch64.dmg.sig');
    assert.equal(sig.browser_download_url, 'https://example.com/sig');
  });

  it('returns null when no signature exists', () => {
    const assets = [{ name: 'pacto_0.2.0_x64.dmg', browser_download_url: 'https://example.com/dmg' }];
    assert.equal(findSignatureAsset('pacto_0.2.0_x64.dmg', assets), null);
  });
});

describe('buildManifest', () => {
  const baseAssets = [
    { name: 'pacto_0.2.0_aarch64.dmg', browser_download_url: 'https://example.com/dmg', size: 100 },
    { name: 'pacto_0.2.0_aarch64.dmg.sig', browser_download_url: 'https://example.com/sig', size: 10 },
    { name: 'latest.json', browser_download_url: 'https://example.com/latest', size: 1 },
  ];

  it('includes required fields on every entry', () => {
    const manifest = buildManifest('v0.2.0', '2026-07-11T00:00:00Z', 'https://example.com/release', baseAssets);
    assert.equal(manifest.tag, 'v0.2.0');
    assert.equal(manifest.publishedAt, '2026-07-11T00:00:00Z');
    assert.equal(manifest.releaseUrl, 'https://example.com/release');
    assert.equal(manifest.assets.length, 1);

    const entry = manifest.assets[0];
    assert.equal(entry.name, 'pacto_0.2.0_aarch64.dmg');
    assert.equal(entry.platform, 'macos');
    assert.equal(entry.arch, 'aarch64');
    assert.equal(entry.label, 'macOS Apple Silicon');
    assert.equal(entry.url, 'https://example.com/dmg');
    assert.equal(entry.size, 100);
    assert.equal(entry.signatureUrl, 'https://example.com/sig');
  });

  it('excludes signatures and latest.json from the installer list', () => {
    const manifest = buildManifest('v0.2.0', '2026-07-11T00:00:00Z', 'https://example.com/release', baseAssets);
    const names = manifest.assets.map(a => a.name);
    assert.deepEqual(names, ['pacto_0.2.0_aarch64.dmg']);
  });

  it('throws when there are no installer assets', () => {
    assert.throws(
      () => buildManifest('v0.2.0', '2026-07-11T00:00:00Z', 'https://example.com/release', [{ name: 'latest.json', size: 1 }]),
      /Release v0.2.0 has no installer assets/
    );
  });
});
