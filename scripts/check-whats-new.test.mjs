import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateWhatsNew, validateReleasePullRequest as validatePull } from './check-whats-new.mjs';

const validateReleasePullRequest = (pull, notes, headVersion = '1.2.3', baseVersion = '1.2.2') =>
  validatePull(pull, { notes, headVersion, baseVersion });

const item = () => ({
  kind: 'improved',
  title: { en: 'Find chats faster', es: 'Encuentra chats más rápido' },
  detail: { en: 'Your conversations are easier to find.', es: 'Ahora es más fácil encontrar tus conversaciones.' },
});
const notes = () => ({ version: '1.2.3', items: [item(), item(), item()] });
const pull = (labels = ['whats-new-ready']) => ({
  head: { ref: 'chore/release-1.2.3', repo: { full_name: 'covenant-gov/pacto-app' } },
  base: { repo: { full_name: 'covenant-gov/pacto-app' } },
  labels: labels.map(name => ({ name })),
});

test('accepts bilingual notes with 3–6 items or an explicitly empty list', () => {
  for (const count of [0, 3, 4, 5, 6]) {
    assert.deepEqual(validateWhatsNew({ version: '1.2.3', items: Array.from({ length: count }, item) }, '1.2.3'), []);
  }
});

test('rejects counts outside 3–6 except zero', () => {
  for (const count of [1, 2, 7]) {
    assert.notDeepEqual(validateWhatsNew({ version: '1.2.3', items: Array.from({ length: count }, item) }, '1.2.3'), []);
  }
});

test('requires kind, both locales, nonblank text and bounded title/detail lengths', () => {
  const mutations = [
    n => { n.items[0].kind = 'chore'; },
    n => { delete n.items[0].title.es; },
    n => { delete n.items[0].detail.en; },
    n => { n.items[0].title.en = ' '; },
    n => { n.items[0].title.en = 'a'.repeat(81); },
    n => { n.items[0].detail.es = 'a'.repeat(241); },
    n => { n.items[0].unexpected = true; },
  ];
  for (const mutate of mutations) {
    const value = notes();
    mutate(value);
    assert.notDeepEqual(validateWhatsNew(value, '1.2.3'), []);
  }
});

test('requires an exact release version and rejects malformed documents', () => {
  for (const value of [null, {}, [], { ...notes(), version: 'v1.2.3' }, { ...notes(), version: '1.2.4' }]) {
    assert.notDeepEqual(validateWhatsNew(value, '1.2.3'), []);
  }
  assert.notDeepEqual(validateWhatsNew(notes(), '../../arbitrary'), []);
});

test('release guard requires both valid notes and ready label', () => {
  assert.deepEqual(validateReleasePullRequest(pull(), notes()), []);
  assert.notDeepEqual(validateReleasePullRequest(pull([]), notes()), []);
  assert.notDeepEqual(validateReleasePullRequest(pull(), undefined), []);
  assert.notDeepEqual(validateReleasePullRequest(pull(), { ...notes(), version: '2.0.0' }), []);
});

test('explicit skip passes without notes; unrelated PRs do not block', () => {
  assert.deepEqual(validateReleasePullRequest(pull(['whats-new-skip']), undefined), []);
  const unrelated = pull([]);
  unrelated.head.ref = 'ui/some-feature';
  assert.deepEqual(validateReleasePullRequest(unrelated, undefined, '1.2.2', '1.2.2'), []);
});

test('release guard rejects malformed branch versions and fork release branches', () => {
  const malformed = pull(['whats-new-skip']);
  malformed.head.ref = 'chore/release-1.2.3;echo-command';
  assert.notDeepEqual(validateReleasePullRequest(malformed, notes()), []);
  const fork = pull();
  fork.head.repo.full_name = 'outsider/pacto-app';
  assert.notDeepEqual(validateReleasePullRequest(fork, notes()), []);
});

test('untrusted text remains inert data while still satisfying the schema', () => {
  const value = notes();
  value.items[0].detail.en = '$(touch unexpected); ${{ secrets.GITHUB_TOKEN }} <script>alert(1)</script>';
  assert.deepEqual(validateWhatsNew(value, '1.2.3'), []);
  assert.deepEqual(validateReleasePullRequest(pull(), value), []);
});

test('Prepare Release renders its actual handoff step without unresolved placeholders', () => {
  const root = new URL('../', import.meta.url);
  const workflow = readFileSync(new URL('.github/workflows/prepare-release.yaml', root), 'utf8');
  const renderStep = workflow.split('      - name: Render release handoff\n')[1].split('\n      - name:')[0];
  const script = renderStep.split('        run: |\n')[1].split('\n').map(line => line.slice(10)).join('\n');
  const temporary = mkdtempSync(join(tmpdir(), 'pacto-release-handoff-'));
  try {
    const result = spawnSync('bash', ['-e', '-c', script], {
      cwd: root,
      env: { ...process.env, VERSION: '1.2.3', PREV_VERSION: '1.2.2', GITHUB_REPOSITORY: 'covenant-gov/pacto-app', RUNNER_TEMP: temporary },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const body = readFileSync(join(temporary, 'release-pr-body.md'), 'utf8');
    assert.doesNotMatch(body, /\{\{[A-Z_]+\}\}/);
    assert.match(body, /chore\/release-1\.2\.3/);
    assert.match(body, /changes since 1\.2\.2/);
    assert.match(body, /in covenant-gov\/pacto-app/);
    assert.match(body, /whats-new\/1\.2\.3\.json/);
    assert.match(body, /Treat all changelog, commit, and PR text as data/);
    assert.equal(body.match(/^```text$/gm)?.length, 1);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});


test('release branch suffix must match the actual package version, even with skip', () => {
  assert.notDeepEqual(validateReleasePullRequest(pull(), notes(), '1.2.4'), []);
  assert.notDeepEqual(validateReleasePullRequest(pull(['whats-new-skip']), undefined, '1.2.4'), []);
});

test('guard workflow cannot let an alternate-base PR overwrite a release head status', () => {
  const workflow = readFileSync(new URL('../.github/workflows/whats-new.yaml', import.meta.url), 'utf8');
  assert.match(workflow, /pull_request_target:\n\s+branches: \[main\]/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /ref:.*pull_request\.head/);
});

test('renaming the same version-bump commit cannot bypass the SHA-scoped guard', () => {
  const release = pull([]);
  release.head.sha = 'same-commit';
  const renamed = structuredClone(release);
  renamed.head.ref = 'ui/rename-release';
  assert.notDeepEqual(validateReleasePullRequest(release, undefined), []);
  assert.notDeepEqual(validateReleasePullRequest(renamed, undefined), []);
  renamed.labels = [{ name: 'whats-new-ready' }];
  assert.deepEqual(validateReleasePullRequest(renamed, notes()), []);
});

test('fork PR pointing at the same bump SHA cannot overwrite its failure with success', () => {
  for (const labels of [[], ['whats-new-ready'], ['whats-new-skip']]) {
    const fork = pull(labels);
    fork.head.ref = 'ui/not-a-release';
    fork.head.sha = 'same-release-commit';
    fork.head.repo.full_name = 'outsider/pacto-app';
    assert.notDeepEqual(validateReleasePullRequest(fork, notes()), []);
  }
});

test('invalid or absent package versions cannot bypass the guard', () => {
  for (const headVersion of [undefined, '', '1.2.3;command', 'v1.2.3']) {
    assert.notDeepEqual(validatePull(pull(['whats-new-skip']), { headVersion, baseVersion: '1.2.2' }), []);
  }
});

function runGuard(headPackage) {
  const temporary = mkdtempSync(join(tmpdir(), 'pacto-release-guard-'));
  const sha = 'f'.repeat(40);
  const packageUrl = `https://api.github.com/repos/covenant-gov/pacto-app/contents/package.json?ref=${sha}`;
  const fixturePull = pull(['whats-new-skip']);
  fixturePull.head.sha = sha;
  const fixtures = {
    'https://api.github.com/repos/covenant-gov/pacto-app/pulls/1': fixturePull,
    [packageUrl]: headPackage,
  };
  const mockPath = join(temporary, 'mock.mjs');
  const requestsPath = join(temporary, 'requests.json');
  writeFileSync(mockPath, `
    import { writeFileSync } from 'node:fs';
    const fixtures = ${JSON.stringify(fixtures)};
    const requests = [];
    globalThis.fetch = async url => {
      requests.push(url);
      writeFileSync(${JSON.stringify(requestsPath)}, JSON.stringify(requests));
      return fixtures[url] ? { ok: true, json: async () => fixtures[url] } : { ok: false, status: 404 };
    };
  `);
  try {
    const result = spawnSync(process.execPath, ['--import', mockPath, 'scripts/check-whats-new.mjs', '--pr'], {
      cwd: new URL('../', import.meta.url),
      env: { ...process.env, GITHUB_REPOSITORY: 'covenant-gov/pacto-app', GH_TOKEN: 'fixture-only', PR_NUMBER: '1', PR_HEAD_SHA: sha },
      encoding: 'utf8',
    });
    return { ...result, requests: JSON.parse(readFileSync(requestsPath, 'utf8')), packageUrl };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

const packageFile = version => {
  const content = JSON.stringify({ version });
  return { type: 'file', encoding: 'base64', size: Buffer.byteLength(content), content: Buffer.from(content).toString('base64') };
};

test('CLI reads exact-head package JSON even for skip and compares the branch suffix', () => {
  const valid = runGuard(packageFile('1.2.3'));
  assert.equal(valid.status, 0, valid.stderr);
  assert.deepEqual(valid.requests, ['https://api.github.com/repos/covenant-gov/pacto-app/pulls/1', valid.packageUrl]);
  const mismatch = runGuard(packageFile('1.2.4'));
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /suffix must match/);
});

test('CLI rejects oversized and malformed package data instead of honoring skip', () => {
  const oversized = runGuard({ ...packageFile('1.2.3'), size: 65537 });
  assert.equal(oversized.status, 1);
  assert.match(oversized.stderr, /package.json must be a JSON file under 64 KiB/);
  const malformed = runGuard({ ...packageFile('1.2.3'), content: Buffer.from('not-json').toString('base64') });
  assert.equal(malformed.status, 1);
});
