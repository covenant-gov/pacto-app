import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const scripts = dirname(fileURLToPath(import.meta.url));

let sandbox;

/**
 * Installs a fake `gh` ahead of the real one. The stub appends every argv to
 * calls.log and answers `pr view --json state` from state.txt, where each line
 * is the state of one successive poll (the last line repeats).
 */
function stubGh({ states = ['MERGED'], prList = '', failViewTimes = 0 } = {}) {
  const bin = join(sandbox, 'bin');
  spawnSync('mkdir', ['-p', bin]);
  writeFileSync(join(sandbox, 'state.txt'), states.join('\n'));
  writeFileSync(join(sandbox, 'pr-list.txt'), prList);
  writeFileSync(join(sandbox, 'view-failures.txt'), String(failViewTimes));
  const gh = `#!/usr/bin/env bash
sandbox="${sandbox}"
printf '%s\\n' "$*" >> "$sandbox/calls.log"
case "$1 $2" in
  "pr view")
    failures=$(cat "$sandbox/view-failures.txt")
    if [ "$failures" -gt 0 ]; then
      echo $((failures - 1)) > "$sandbox/view-failures.txt"
      echo "gh: transient failure" >&2
      exit 1
    fi
    polls=$(cat "$sandbox/polls.txt" 2>/dev/null || echo 0)
    echo $((polls + 1)) > "$sandbox/polls.txt"
    line=$(sed -n "$((polls + 1))p" "$sandbox/state.txt")
    [ -n "$line" ] && printf '%s\\n' "$line" && exit 0
    tail -n 1 "$sandbox/state.txt"
    ;;
  "pr list") cat "$sandbox/pr-list.txt" ;;
  "run list") echo "https://example.invalid/run/1" ;;
  "pr close") ;;
  *) echo "unexpected gh call: $*" >&2; exit 90 ;;
esac
`;
  writeFileSync(join(bin, 'gh'), gh);
  chmodSync(join(bin, 'gh'), 0o755);
  return bin;
}

function run(script, args, { env = {}, bin } = {}) {
  return spawnSync(join(scripts, script), args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_OUTPUT: join(sandbox, 'github-output.txt'),
      ...env,
    },
  });
}

function ghCalls() {
  const log = join(sandbox, 'calls.log');
  return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
}

function outputs() {
  const file = join(sandbox, 'github-output.txt');
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'tap-merge-'));
});

describe('wait-for-tap-pr-merge.sh', () => {
  it('succeeds as soon as the tap PR reports MERGED', () => {
    const bin = stubGh({ states: ['OPEN', 'OPEN', 'MERGED'] });
    const result = run('wait-for-tap-pr-merge.sh', ['12'], {
      bin,
      env: { POLL_SECONDS: '0', TIMEOUT_SECONDS: '60' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /merged/);
    assert.equal(ghCalls().filter((call) => call.startsWith('pr view')).length, 3);
  });

  it('fails immediately when the tap PR is closed unmerged', () => {
    const bin = stubGh({ states: ['CLOSED'] });
    const result = run('wait-for-tap-pr-merge.sh', ['12'], {
      bin,
      env: { POLL_SECONDS: '0', TIMEOUT_SECONDS: '600' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /closed without merging/);
    assert.equal(outputs().reason, 'Tap PR #12 was closed without merging: https://github.com/covenant-gov/homebrew-pacto/pull/12');
    assert.equal(outputs().run_url, 'https://example.invalid/run/1');
  });

  it('fails when the PR never merges inside the timeout', () => {
    const bin = stubGh({ states: ['OPEN'] });
    const result = run('wait-for-tap-pr-merge.sh', ['12'], {
      bin,
      env: { POLL_SECONDS: '0', TIMEOUT_SECONDS: '0' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /was not merged within 0s/);
    assert.equal(outputs().pr_url, 'https://github.com/covenant-gov/homebrew-pacto/pull/12');
  });

  it('keeps polling through a transient gh failure', () => {
    const bin = stubGh({ states: ['MERGED'], failViewTimes: 2 });
    const result = run('wait-for-tap-pr-merge.sh', ['12'], {
      bin,
      env: { POLL_SECONDS: '0', TIMEOUT_SECONDS: '60' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Could not read the state/);
  });

  it('rejects a missing PR number', () => {
    const bin = stubGh();
    const result = run('wait-for-tap-pr-merge.sh', [], { bin });
    assert.equal(result.status, 2);
  });
});

describe('close-stale-tap-bump-prs.sh', () => {
  it('closes only older bump PRs and deletes their branches', () => {
    const bin = stubGh({
      prList: ['7\tchore/bump-v0.7.1', '9\tchore/bump-v0.10.0', '11\tchore/bump-v0.8.0'].join('\n'),
    });
    const result = run('close-stale-tap-bump-prs.sh', ['v0.8.0'], { bin });
    assert.equal(result.status, 0, result.stderr);
    const closes = ghCalls().filter((call) => call.startsWith('pr close'));
    assert.equal(closes.length, 1);
    assert.match(closes[0], /^pr close 7 /);
    assert.match(closes[0], /--delete-branch/);
    assert.match(closes[0], /Superseded by the cask bump for v0\.8\.0/);
  });

  it('orders versions numerically, not lexically', () => {
    const bin = stubGh({
      prList: ['3\tchore/bump-v0.9.0', '4\tchore/bump-v0.10.1'].join('\n'),
    });
    const result = run('close-stale-tap-bump-prs.sh', ['v0.10.0'], { bin });
    assert.equal(result.status, 0, result.stderr);
    const closes = ghCalls().filter((call) => call.startsWith('pr close'));
    assert.deepEqual(
      closes.map((call) => call.split(' ')[2]),
      ['3'],
    );
  });

  it('ignores branches that are not cask bumps', () => {
    const bin = stubGh({ prList: ['5\tfeature/readme', '6\tchore/bump-deps'].join('\n') });
    const result = run('close-stale-tap-bump-prs.sh', ['v0.8.0'], { bin });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(ghCalls().filter((call) => call.startsWith('pr close')).length, 0);
  });
});
