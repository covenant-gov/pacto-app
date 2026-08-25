#!/usr/bin/env node
// Parses a cargo-nextest JUnit report and renders a "slowest tests" table.
// Used in CI (see .github/workflows/ci.yaml) to make backend test-suite
// performance visible per run without a separate analytics service.
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Extract per-test durations from a nextest JUnit XML report.
 * Returns [{ name, seconds }], sorted slowest-first.
 */
export function parseJUnitTimings(xml) {
  const timings = [];
  const testcaseRe = /<testcase\b[^>]*\bname="([^"]*)"[^>]*\btime="([^"]*)"/g;
  for (const match of xml.matchAll(testcaseRe)) {
    const [, rawName, rawTime] = match;
    const seconds = Number(rawTime);
    if (!Number.isFinite(seconds)) continue;
    timings.push({ name: decodeXmlEntities(rawName), seconds });
  }
  return timings.sort((a, b) => b.seconds - a.seconds);
}

/** Read the `<testsuites time="…">` total, or null if absent/unparseable. */
export function parseTotalSeconds(xml) {
  const match = xml.match(/<testsuites\b[^>]*\btime="([^"]*)"/);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

function decodeXmlEntities(text) {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

/** Render a markdown "slowest tests" section for a CI step summary. */
export function formatSummary(timings, { title, totalSeconds, limit = 15 } = {}) {
  const lines = [`## ${title ?? 'Slowest tests'}`, ''];
  if (totalSeconds != null) {
    lines.push(`Suite: ${timings.length} tests, ${totalSeconds.toFixed(1)}s total.`, '');
  }
  lines.push('| Test | Time |', '| --- | ---: |');
  for (const { name, seconds } of timings.slice(0, limit)) {
    lines.push(`| \`${name}\` | ${seconds.toFixed(2)}s |`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const junitPath = process.argv[2];
  const title = process.argv[3];
  if (!junitPath) {
    console.error('usage: nextest-slow-summary.mjs <junit.xml> [title]');
    process.exit(1);
  }

  const xml = readFileSync(junitPath, 'utf8');
  const timings = parseJUnitTimings(xml);
  const totalSeconds = parseTotalSeconds(xml);
  const summary = formatSummary(timings, { title, totalSeconds });

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, summary + '\n');
  } else {
    console.log(summary);
  }
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
