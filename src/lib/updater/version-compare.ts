/** SemVer 2.0.0 parsing and precedence, scoped to the update gate's needs. */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated pre-release identifiers; numeric ones parsed as numbers. */
  prerelease: Array<string | number>;
  /** Dot-separated build metadata identifiers; never affects precedence. */
  build: string[];
}

const VERSION_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-.]+))?(?:\+([0-9A-Za-z-.]+))?$/;

const IDENTIFIER_PATTERN = /^[0-9A-Za-z-]+$/;
const NUMERIC_IDENTIFIER_PATTERN = /^(?:0|[1-9]\d*)$/;

/** Parses a version string tolerating an optional leading `v`; null if unparseable. */
export function parseVersion(input: string): ParsedVersion | null {
  if (typeof input !== 'string') return null;

  const match = VERSION_PATTERN.exec(input.trim());
  if (!match) return null;

  const [, major, minor, patch, prereleaseRaw, buildRaw] = match;

  const prerelease = prereleaseRaw ? prereleaseRaw.split('.') : [];
  if (!prerelease.every((identifier) => IDENTIFIER_PATTERN.test(identifier))) {
    return null;
  }

  // Build metadata identifiers use the same non-empty charset as
  // pre-release ones per the SemVer 2.0.0 spec - unvalidated, a value like
  // '1.0.0+..' would parse with empty identifiers instead of being
  // rejected, and this comparator must treat malformed input as
  // unparseable rather than silently accepting it.
  const build = buildRaw ? buildRaw.split('.') : [];
  if (!build.every((identifier) => IDENTIFIER_PATTERN.test(identifier))) {
    return null;
  }

  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease.map((identifier) =>
      NUMERIC_IDENTIFIER_PATTERN.test(identifier) ? Number(identifier) : identifier
    ),
    build
  };
}

/** Compares two pre-release identifiers per SemVer 2.0.0 §11: numeric < alphanumeric, else same-kind ordering. */
function comparePrereleaseIdentifier(a: string | number, b: string | number): number {
  const aIsNumeric = typeof a === 'number';
  const bIsNumeric = typeof b === 'number';

  if (aIsNumeric && bIsNumeric) return a === b ? 0 : a < b ? -1 : 1;
  if (aIsNumeric) return -1;
  if (bIsNumeric) return 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/** Compares two parsed versions by SemVer 2.0.0 precedence; build metadata is ignored. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;

  const aHasPrerelease = a.prerelease.length > 0;
  const bHasPrerelease = b.prerelease.length > 0;
  if (aHasPrerelease !== bHasPrerelease) return aHasPrerelease ? -1 : 1;
  if (!aHasPrerelease) return 0;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i++) {
    if (i >= a.prerelease.length) return -1;
    if (i >= b.prerelease.length) return 1;
    const result = comparePrereleaseIdentifier(a.prerelease[i], b.prerelease[i]);
    if (result !== 0) return result;
  }
  return 0;
}

/** Answers whether the installed build is strictly below the minimum; fails open on either unparseable input. */
export function isInstalledBelowMinimum(installedVersion: string, minimumVersion: string): boolean {
  const installed = parseVersion(installedVersion);
  const minimum = parseVersion(minimumVersion);
  if (!installed || !minimum) return false;

  return compareVersions(installed, minimum) < 0;
}
