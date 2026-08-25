import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseJUnitTimings, parseTotalSeconds, formatSummary } from './nextest-slow-summary.mjs';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="nextest-run" tests="3" failures="0" errors="0" time="12.5">
    <testsuite name="pacto" tests="3" disabled="0" errors="0" failures="0">
        <testcase name="fast_test" classname="pacto" timestamp="2026-01-01T00:00:00Z" time="0.010">
        </testcase>
        <testcase name="slow::nested::test&lt;T&gt;" classname="pacto" timestamp="2026-01-01T00:00:00Z" time="9.874">
        </testcase>
        <testcase name="mid_test" classname="pacto" timestamp="2026-01-01T00:00:00Z" time="1.200">
        </testcase>
    </testsuite>
</testsuites>`;

describe('parseJUnitTimings', () => {
  it('extracts name and duration for every testcase, sorted slowest-first', () => {
    assert.deepEqual(parseJUnitTimings(SAMPLE_XML), [
      { name: 'slow::nested::test<T>', seconds: 9.874 },
      { name: 'mid_test', seconds: 1.2 },
      { name: 'fast_test', seconds: 0.01 },
    ]);
  });

  it('returns an empty array when no testcases are present', () => {
    assert.deepEqual(parseJUnitTimings('<testsuites></testsuites>'), []);
  });
});

describe('parseTotalSeconds', () => {
  it('reads the top-level testsuites time attribute', () => {
    assert.equal(parseTotalSeconds(SAMPLE_XML), 12.5);
  });

  it('returns null when the attribute is missing', () => {
    assert.equal(parseTotalSeconds('<testsuites></testsuites>'), null);
  });
});

describe('formatSummary', () => {
  it('renders a markdown table ordered slowest-first and respects the limit', () => {
    const timings = parseJUnitTimings(SAMPLE_XML);
    const summary = formatSummary(timings, { title: 'Slowest tests', totalSeconds: 12.5, limit: 2 });

    assert.match(summary, /^## Slowest tests$/m);
    assert.match(summary, /Suite: 3 tests, 12\.5s total\./);
    assert.match(summary, /\| `slow::nested::test<T>` \| 9\.87s \|/);
    assert.match(summary, /\| `mid_test` \| 1\.20s \|/);
    assert.doesNotMatch(summary, /fast_test/);
  });

  it('omits the suite line when no total is available', () => {
    const summary = formatSummary([{ name: 'a', seconds: 0.1 }], { title: 'X' });
    assert.doesNotMatch(summary, /Suite:/);
  });
});
