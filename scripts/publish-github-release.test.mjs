import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_UPDATER_PLATFORMS,
  assertManifestReadyToPublish,
} from './publish-github-release.mjs';

function completeManifest(overrides = {}) {
  const platforms = Object.fromEntries(
    REQUIRED_UPDATER_PLATFORMS.map((id) => [id, { signature: `sig-${id}`, url: `https://example.com/${id}` }]),
  );
  return {
    version: '0.8.0',
    notes: 'notes',
    pub_date: '2026-11-06T00:00:00Z',
    platforms,
    minimum_compatible_version: '0.6.1',
    ...overrides,
  };
}

describe('REQUIRED_UPDATER_PLATFORMS', () => {
  it('lists the five publish-tauri matrix targets', () => {
    assert.deepEqual(REQUIRED_UPDATER_PLATFORMS, [
      'darwin-aarch64',
      'darwin-x86_64',
      'linux-x86_64',
      'linux-aarch64',
      'windows-x86_64',
    ]);
  });
});

describe('assertManifestReadyToPublish', () => {
  it('accepts a complete stamped manifest', () => {
    assert.equal(assertManifestReadyToPublish(completeManifest()), true);
  });

  it('rejects a missing platforms object', () => {
    assert.throws(
      () => assertManifestReadyToPublish({ version: '0.8.0' }),
      /missing a platforms object/,
    );
  });

  it('rejects when a matrix platform is absent', () => {
    const manifest = completeManifest();
    delete manifest.platforms['darwin-aarch64'];
    assert.throws(
      () => assertManifestReadyToPublish(manifest),
      /missing required updater platforms: darwin-aarch64/,
    );
  });

  it('rejects a platform entry without a url', () => {
    const manifest = completeManifest();
    manifest.platforms['windows-x86_64'] = { signature: 'sig' };
    assert.throws(
      () => assertManifestReadyToPublish(manifest),
      /missing required updater platforms: windows-x86_64/,
    );
  });

  it('rejects a stable manifest without minimum_compatible_version', () => {
    const manifest = completeManifest();
    delete manifest.minimum_compatible_version;
    assert.throws(
      () => assertManifestReadyToPublish(manifest),
      /missing minimum_compatible_version/,
    );
  });

  it('allows skipping the compatibility floor when requireMinimumCompatible is false', () => {
    const manifest = completeManifest();
    delete manifest.minimum_compatible_version;
    assert.equal(
      assertManifestReadyToPublish(manifest, { requireMinimumCompatible: false }),
      true,
    );
  });
});
