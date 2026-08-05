import { describe, it, expect } from 'vitest';
import { parseVersion, compareVersions, isInstalledBelowMinimum } from './version-compare';

describe('parseVersion', () => {
  it('parses a bare major.minor.patch', () => {
    expect(parseVersion('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
      build: []
    });
  });

  it('tolerates an optional leading v', () => {
    expect(parseVersion('v1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
      build: []
    });
  });

  it('parses pre-release identifiers', () => {
    expect(parseVersion('1.0.0-beta.1')).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ['beta', 1],
      build: []
    });
  });

  it('parses build metadata', () => {
    expect(parseVersion('1.0.0+abc')).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: [],
      build: ['abc']
    });
  });

  it('parses pre-release and build metadata together', () => {
    expect(parseVersion('1.0.0-beta.1+abc')).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ['beta', 1],
      build: ['abc']
    });
  });

  it('returns null for an empty string', () => {
    expect(parseVersion('')).toBeNull();
  });

  it('returns null for "latest"', () => {
    expect(parseVersion('latest')).toBeNull();
  });

  it('returns null for a missing patch component', () => {
    expect(parseVersion('1.0')).toBeNull();
  });

  it('returns null for null-ish input', () => {
    expect(parseVersion(null as unknown as string)).toBeNull();
    expect(parseVersion(undefined as unknown as string)).toBeNull();
  });

  it('returns null for malformed build metadata (empty identifiers)', () => {
    expect(parseVersion('1.0.0+..')).toBeNull();
    expect(parseVersion('1.0.0+abc..def')).toBeNull();
    expect(parseVersion('1.0.0+')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('treats equal versions as equal', () => {
    expect(compareVersions(parseVersion('0.3.0')!, parseVersion('0.3.0')!)).toBe(0);
  });

  it('orders by major, minor, then patch', () => {
    expect(compareVersions(parseVersion('0.2.9')!, parseVersion('0.3.0')!)).toBeLessThan(0);
    expect(compareVersions(parseVersion('0.3.0')!, parseVersion('1.0.0')!)).toBeLessThan(0);
    expect(compareVersions(parseVersion('1.2.3')!, parseVersion('1.2.4')!)).toBeLessThan(0);
  });

  it('is numeric, not lexical, per component', () => {
    expect(compareVersions(parseVersion('0.10.0')!, parseVersion('0.9.0')!)).toBeGreaterThan(0);
  });

  it('sorts a pre-release before its release', () => {
    expect(compareVersions(parseVersion('1.0.0-beta.1')!, parseVersion('1.0.0')!)).toBeLessThan(0);
    expect(compareVersions(parseVersion('1.0.0')!, parseVersion('1.0.0-beta.1')!)).toBeGreaterThan(0);
  });

  it('compares pre-release identifiers alphanumerically when both are alpha', () => {
    expect(compareVersions(parseVersion('1.0.0-alpha')!, parseVersion('1.0.0-beta')!)).toBeLessThan(0);
  });

  it('compares numeric pre-release identifiers numerically', () => {
    expect(compareVersions(parseVersion('1.0.0-beta.2')!, parseVersion('1.0.0-beta.10')!)).toBeLessThan(0);
  });

  it('ranks numeric pre-release identifiers below alphanumeric ones', () => {
    expect(compareVersions(parseVersion('1.0.0-1')!, parseVersion('1.0.0-alpha')!)).toBeLessThan(0);
  });

  it('ignores build metadata entirely', () => {
    expect(compareVersions(parseVersion('1.0.0+abc')!, parseVersion('1.0.0')!)).toBe(0);
  });
});

describe('isInstalledBelowMinimum', () => {
  it('is not below when versions are equal', () => {
    expect(isInstalledBelowMinimum('0.3.0', '0.3.0')).toBe(false);
  });

  it('is below across each component', () => {
    expect(isInstalledBelowMinimum('0.2.9', '0.3.0')).toBe(true);
    expect(isInstalledBelowMinimum('0.3.0', '1.0.0')).toBe(true);
    expect(isInstalledBelowMinimum('1.2.3', '1.2.4')).toBe(true);
  });

  it('is not below when installed is above minimum', () => {
    expect(isInstalledBelowMinimum('1.0.0', '0.9.9')).toBe(false);
  });

  it('tolerates a leading v on either side and on both', () => {
    expect(isInstalledBelowMinimum('v0.2.0', '0.3.0')).toBe(true);
    expect(isInstalledBelowMinimum('0.2.0', 'v0.3.0')).toBe(true);
    expect(isInstalledBelowMinimum('v0.2.0', 'v0.3.0')).toBe(true);
  });

  it('compares numerically, not lexically', () => {
    expect(isInstalledBelowMinimum('0.10.0', '0.9.0')).toBe(false);
  });

  it('treats a pre-release as below its release', () => {
    expect(isInstalledBelowMinimum('1.0.0-beta.1', '1.0.0')).toBe(true);
    expect(isInstalledBelowMinimum('1.0.0', '1.0.0-beta.1')).toBe(false);
  });

  it('orders pre-release identifiers per spec', () => {
    expect(isInstalledBelowMinimum('1.0.0-alpha', '1.0.0-beta')).toBe(true);
  });

  it('ignores build metadata', () => {
    expect(isInstalledBelowMinimum('1.0.0+abc', '1.0.0')).toBe(false);
  });

  it('answers not-below for an unparseable minimum', () => {
    expect(isInstalledBelowMinimum('1.0.0', '')).toBe(false);
    expect(isInstalledBelowMinimum('1.0.0', 'latest')).toBe(false);
    expect(isInstalledBelowMinimum('1.0.0', '1.0')).toBe(false);
    expect(isInstalledBelowMinimum('1.0.0', null as unknown as string)).toBe(false);
  });

  it('answers not-below for an unparseable installed version', () => {
    expect(isInstalledBelowMinimum('not-a-version', '1.0.0')).toBe(false);
  });
});
