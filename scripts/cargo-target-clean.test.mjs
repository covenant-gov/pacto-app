import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repoRoot, 'scripts/cargo-target-clean.sh');
const targets = [];

function runScript(mode, extraArgs = [], env = {}) {
  return spawnSync('bash', [script, mode, ...extraArgs], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function makeTargetDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cargo-target-cap-'));
  targets.push(dir);
  return dir;
}

function runCheck(targetDir, env = {}) {
  return runScript('check', [], {
    CARGO_TARGET_DIR: targetDir,
    ...env,
  });
}

function runCap(targetDir, env = {}) {
  return runScript('cap', [], {
    CARGO_TARGET_DIR: targetDir,
    ...env,
  });
}

function mkOverCapFile(path) {
  // Sparse truncate does not inflate `du -sk`; need real blocks for the gate.
  const mkfile = spawnSync('mkfile', ['1100m', path], { encoding: 'utf8' });
  if (mkfile.status === 0) {
    return;
  }
  const dd = spawnSync(
    'dd',
    ['if=/dev/zero', `of=${path}`, 'bs=1m', 'count=1100', 'conv=sync'],
    { encoding: 'utf8' },
  );
  assert.equal(
    dd.status,
    0,
    `could not allocate over-cap fixture: ${mkfile.stderr || dd.stderr}`,
  );
}

after(() => {
  for (const dir of targets) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('cargo-target-clean.sh', () => {
  it('prints usage when mode is missing', () => {
    const result = runScript('');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /check/);
  });

  it('rejects invalid CARGO_TARGET_CAP_GB on check', () => {
    const targetDir = makeTargetDir();
    for (const cap of ['0', 'abc']) {
      const result = runCheck(targetDir, { CARGO_TARGET_CAP_GB: cap });
      assert.equal(result.status, 2, `cap=${cap}`);
      assert.match(result.stderr, /CARGO_TARGET_CAP_GB/);
    }
  });

  it('passes check when target dir is empty or small', () => {
    const targetDir = makeTargetDir();
    assert.equal(runCheck(targetDir).status, 0);
    writeFileSync(join(targetDir, 'stub'), 'x');
    assert.equal(runCheck(targetDir, { CARGO_TARGET_CAP_GB: '25' }).status, 0);
  });

  it('cap exits cleanly with install hint when cargo-sweep is missing', () => {
    const targetDir = makeTargetDir();
    const env = { CARGO_TARGET_DIR: targetDir };
    const probe = spawnSync('cargo', ['sweep', '--version'], {
      encoding: 'utf8',
      env,
    });
    if (probe.status === 0) {
      return;
    }
    const result = runCap(targetDir);
    assert.equal(result.status, 0);
    const out = `${result.stdout}\n${result.stderr}`;
    assert.match(out, /cargo-sweep is not installed/);
  });
});

describe('make check-cargo-cap', () => {
  it('delegates to the script for an empty redirected target', () => {
    const targetDir = makeTargetDir();
    const result = spawnSync('make', ['check-cargo-cap'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, CARGO_TARGET_DIR: targetDir },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});

describe('cargo-target-clean.sh over cap', { skip: !!process.env.CI }, () => {
  it('refuses when target exceeds CARGO_TARGET_CAP_GB', () => {
    const targetDir = makeTargetDir();
    // Slightly over 1 GiB binary cap.
    mkOverCapFile(join(targetDir, 'bulk.bin'));
    const result = runCheck(targetDir, { CARGO_TARGET_CAP_GB: '1' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /over cap/);
    assert.match(result.stderr, /sweep-cargo/);
  });

  it('continues when PACTO_ALLOW_LARGE_CARGO_TARGET is set', () => {
    const targetDir = makeTargetDir();
    mkOverCapFile(join(targetDir, 'bulk.bin'));
    const result = runCheck(targetDir, {
      CARGO_TARGET_CAP_GB: '1',
      PACTO_ALLOW_LARGE_CARGO_TARGET: '1',
    });
    assert.equal(result.status, 0);
    assert.match(result.stderr, /continuing/);
  });
});
