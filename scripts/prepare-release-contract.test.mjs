import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readRepo(path) {
  return readFileSync(join(root, path), 'utf8');
}

function jobBlock(yaml, jobName, nextJobName) {
  const start = yaml.indexOf(`\n  ${jobName}:`);
  assert.notEqual(start, -1, `missing job ${jobName}`);
  const end = nextJobName ? yaml.indexOf(`\n  ${nextJobName}:`, start + 1) : yaml.length;
  return yaml.slice(start, end === -1 ? yaml.length : end);
}

describe('prepare-release stays a bump PR opener', () => {
  const prepare = readRepo('.github/workflows/prepare-release.yaml');
  const ci = readRepo('.github/workflows/ci.yaml');
  const bump = readRepo('scripts/bump-version.sh');
  const handoff = readRepo('.github/release-pr-handoff.md');
  const operator = readRepo('docs/build/OPERATOR_UPDATES.md');
  const job = jobBlock(prepare, 'prepare-release');

  it('runs in the existing Linux CI image with a finite timeout', () => {
    assert.match(
      job,
      /\n {4}runs-on: ubuntu-latest\n {4}timeout-minutes: 20\n {4}container:\n {6}image: ghcr\.io\/covenant-gov\/pacto-app\/pacto-ci:latest\n {6}options: --user root\n/,
    );
    assert.doesNotMatch(prepare, /apt-get/);
    assert.doesNotMatch(prepare, /dtolnay\/rust-toolchain/);
    assert.doesNotMatch(prepare, /Swatinem\/rust-cache/);
    assert.doesNotMatch(prepare, /actions\/setup-node/);
    assert.doesNotMatch(prepare, /pnpm\/action-setup/);
  });

  it('installs git-cliff in the job instead of baking it into the image', () => {
    assert.match(job, /tool: git-cliff@2\.14\.2/);
    assert.doesNotMatch(readRepo('Dockerfile.ci'), /git-cliff/);
  });

  it('bumps with the CI fast path and still opens a signed release PR', () => {
    assert.match(
      job,
      /run: \.\/scripts\/bump-version\.sh "\$\{\{ inputs\.bump \}\}" --no-commit --skip-checks\n/,
    );
    assert.match(prepare, /options: \[patch, minor, major\]/);
    assert.match(job, /Ensure release notes labels exist/);
    assert.match(job, /whats-new-ready/);
    assert.match(job, /whats-new-skip/);
    assert.match(job, /peter-evans\/create-pull-request@[0-9a-f]{40}/);
    assert.match(job, /sign-commits: true/);
    assert.match(job, /branch: "chore\/release-\$\{\{ steps\.bumped\.outputs\.version \}\}"/);
    assert.match(job, /body-path:.*release-pr-body\.md/);
    assert.doesNotMatch(prepare, /gh workflow run ci\.yaml/);
  });

  it('keeps pull_request CI as the release PR merge gate', () => {
    assert.match(ci, /\non:\n {2}push:\n {4}branches:\n {6}- main\n {2}pull_request:\n/);
    assert.match(handoff, /Full CI on this PR.*`pull_request`/);
    assert.doesNotMatch(handoff, /pnpm check.*all passed in this run/);
    assert.match(operator, /does not rerun typecheck, lint, or the frontend\/Rust suites/);
  });

  it('keeps local bump-version checks unless --skip-checks is passed', () => {
    assert.match(bump, /pnpm install --lockfile-only --ignore-scripts/);
    assert.match(bump, /pnpm check\n {2}pnpm test/);
    assert.match(bump, /cargo check\n {2}cargo test/);
    const skipIdx = bump.indexOf('if [[ -n "$SKIP_CHECKS" ]]; then');
    const checkIdx = bump.indexOf('pnpm check');
    assert.ok(skipIdx !== -1 && checkIdx > skipIdx);
  });
});
