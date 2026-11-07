import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repoRoot, 'scripts/trust-git-workspace.sh');
const fixtures = [];
const rootOwned = [];

function sh(cwd, args, env = {}) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', ...env },
  });
  if (result.status !== 0) {
    throw new Error(
      `${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  return result;
}

function runTrust(workspace, home, extraArgs = []) {
  return spawnSync('bash', [script, workspace, ...extraArgs], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
    },
  });
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'trust-git-'));
  fixtures.push(root);
  sh(root, ['git', 'init', '-q']);
  sh(root, ['git', 'config', 'user.email', 'trust-git-test@example.com']);
  sh(root, ['git', 'config', 'user.name', 'Trust Git Test']);
  sh(root, ['git', 'commit', '--allow-empty', '-qm', 'init']);
  return root;
}

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'trust-git-home-'));
  fixtures.push(home);
  return home;
}

function sudo(args) {
  return spawnSync('sudo', ['-n', ...args], { encoding: 'utf8' });
}

function requireSudoChown() {
  const probe = sudo(['true']);
  assert.equal(
    probe.status,
    0,
    `passwordless sudo is required to reproduce git ownership mismatch: ${probe.stderr}`,
  );
}

function chownNobody(dir) {
  requireSudoChown();
  const chown = sudo(['chown', '-R', 'nobody:nogroup', dir]);
  assert.equal(chown.status, 0, chown.stderr);
  const chmod = sudo(['chmod', '-R', 'a+rwX', dir]);
  assert.equal(chmod.status, 0, chmod.stderr);
  rootOwned.push(dir);
}

function gitIn(dir, args, home) {
  return spawnSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
    },
  });
}

after(() => {
  for (const dir of rootOwned) {
    sudo(['rm', '-rf', dir]);
  }
  for (const dir of fixtures) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('trust-git-workspace.sh', () => {
  it('refuses wildcard safe.directory', () => {
    const home = makeHome();
    for (const value of ['*', '/tmp/*', '/*']) {
      const result = runTrust(value, home);
      assert.notEqual(result.status, 0, value);
      assert.match(result.stderr, /refusing wildcard git safe\.directory/);
    }
    assert.equal(existsSync(join(home, '.gitconfig')), false);
  });

  it('persists only the exact workspace path in HOME/.gitconfig', () => {
    const repo = makeRepo();
    const home = makeHome();
    const result = runTrust(repo, home);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const gitconfig = readFileSync(join(home, '.gitconfig'), 'utf8');
    assert.match(gitconfig, new RegExp(`directory = ${escapeRegex(repo)}`));
    assert.doesNotMatch(gitconfig, /^\s*directory = \*$/m);
    assert.doesNotMatch(gitconfig, /directory = \*/);
    const listed = sh(home, ['git', 'config', '--global', '--get-all', 'safe.directory'], {
      HOME: home,
    }).stdout.trim().split('\n');
    assert.ok(listed.includes(repo));
    assert.ok(!listed.includes('*'));
    assert.match(result.stdout, new RegExp(`Trusted git directory ${escapeRegex(repo)} in ${escapeRegex(join(home, '.gitconfig'))}`));
  });

  it('trusts an ownership-mismatched checkout by exact path only', () => {
    const trusted = makeRepo();
    const untrusted = makeRepo();
    chownNobody(trusted);
    chownNobody(untrusted);

    const blankHome = makeHome();
    const before = gitIn(trusted, ['rev-parse', '--is-inside-work-tree'], blankHome);
    assert.notEqual(before.status, 0);
    assert.match(before.stderr, /detected dubious ownership/);

    const home = makeHome();
    const trustedResult = runTrust(trusted, home);
    assert.equal(trustedResult.status, 0, trustedResult.stderr || trustedResult.stdout);

    const afterTrusted = gitIn(trusted, ['rev-parse', '--is-inside-work-tree'], home);
    assert.equal(afterTrusted.status, 0, afterTrusted.stderr);
    assert.equal(afterTrusted.stdout.trim(), 'true');

    const afterUntrusted = gitIn(untrusted, ['rev-parse', '--is-inside-work-tree'], home);
    assert.notEqual(afterUntrusted.status, 0);
    assert.match(afterUntrusted.stderr, /detected dubious ownership/);

    const gitconfig = readFileSync(join(home, '.gitconfig'), 'utf8');
    assert.doesNotMatch(gitconfig, /directory = \*/);
    assert.match(gitconfig, new RegExp(`directory = ${escapeRegex(trusted)}`));
    assert.doesNotMatch(gitconfig, new RegExp(`directory = ${escapeRegex(untrusted)}`));
  });
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
