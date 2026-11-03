import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bumpBase, computeNextVersion, parseVersion } from './compute-next-version.mjs';

describe('parseVersion', () => {
  it('accepts stable and beta forms', () => {
    assert.deepEqual(parseVersion('0.7.5'), { base: '0.7.5', prerelease: null });
    assert.deepEqual(parseVersion('0.7.6-beta.1'), { base: '0.7.6', prerelease: 'beta.1' });
  });

  it('rejects malformed versions', () => {
    for (const value of ['', 'v0.7.5', '0.7', '01.2.3', '0.7.5;rm', null, undefined]) {
      assert.equal(parseVersion(value), null);
    }
  });
});

describe('bumpBase', () => {
  it('bumps patch, minor, and major', () => {
    assert.equal(bumpBase('0.7.5', 'patch'), '0.7.6');
    assert.equal(bumpBase('0.7.5', 'minor'), '0.8.0');
    assert.equal(bumpBase('0.7.5', 'major'), '1.0.0');
  });
});

describe('computeNextVersion', () => {
  it('keeps stable patch/minor/major behavior when prerelease is none', () => {
    assert.equal(computeNextVersion('0.7.5', 'patch', 'none'), '0.7.6');
    assert.equal(computeNextVersion('0.7.5', 'minor', 'none'), '0.8.0');
    assert.equal(computeNextVersion('0.7.5', 'major', 'none'), '1.0.0');
  });

  it('starts a beta train from a stable version', () => {
    assert.equal(computeNextVersion('0.7.5', 'patch', 'beta'), '0.7.6-beta.1');
    assert.equal(computeNextVersion('0.7.5', 'minor', 'beta'), '0.8.0-beta.1');
    assert.equal(computeNextVersion('0.7.5', 'major', 'beta'), '1.0.0-beta.1');
  });

  it('increments N on the same beta base when bump is patch', () => {
    assert.equal(computeNextVersion('0.7.6-beta.1', 'patch', 'beta'), '0.7.6-beta.2');
    assert.equal(computeNextVersion('0.5.0-beta.3', 'patch', 'beta'), '0.5.0-beta.4');
  });

  it('opens a new beta train from an existing beta with minor or major', () => {
    assert.equal(computeNextVersion('0.7.6-beta.2', 'minor', 'beta'), '0.8.0-beta.1');
    assert.equal(computeNextVersion('0.7.6-beta.2', 'major', 'beta'), '1.0.0-beta.1');
  });

  it('promotes a beta to its final base when prerelease is none', () => {
    assert.equal(computeNextVersion('0.5.0-beta.3', 'patch', 'none'), '0.5.0');
    assert.equal(computeNextVersion('0.5.0-beta.3', 'minor', 'none'), '0.5.0');
  });
});
