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

describe('tag-release dispatches publish', () => {
  const release = readRepo('.github/workflows/release.yaml');
  const tagRelease = readRepo('.github/workflows/tag-release.yaml');
  const prepare = readRepo('.github/workflows/prepare-release.yaml');
  const operator = readRepo('docs/build/OPERATOR_UPDATES.md');

  it('keeps the human v* tag push trigger and accepts workflow_dispatch', () => {
    assert.match(
      release,
      /on:\n {2}push:\n {4}tags:\n {6}- 'v\*'\n {2}workflow_dispatch:\n/,
    );
  });

  it('queues a second publish for the same ref instead of cancelling it', () => {
    assert.match(
      release,
      /concurrency:\n {2}group: publish-\$\{\{ github\.ref_name \}\}\n {2}cancel-in-progress: false\n/,
    );
  });

  it('fails a branch dispatch before checkout', () => {
    const notes = jobBlock(release, 'release-notes', 'publish-tauri');
    const steps = [...notes.matchAll(/- name: ([^\n]+)/g)].map((match) => match[1]);
    assert.equal(steps[0], 'Require a v* tag ref');
    assert.match(notes, /if: \$\{\{ !startsWith\(github\.ref, 'refs\/tags\/v'\) \}\}/);
    assert.match(notes, /echo "publish must run on a v\* tag ref, got \$GITHUB_REF"\n {10}exit 1/);
    assert.ok(notes.indexOf('- name: Require a v* tag ref') < notes.indexOf('actions/checkout'));
    const publish = jobBlock(release, 'publish-tauri', 'update-homebrew-tap');
    assert.match(publish, /\n {4}needs: release-notes\n/);
  });

  it('dispatches publish only when this run created the tag', () => {
    assert.match(tagRelease, /permissions:\n {2}contents: write\n {2}actions: write\n/);
    const pushStart = tagRelease.indexOf('- name: create and push tag');
    const dispatchStart = tagRelease.indexOf('- name: start publish for the new tag');
    assert.ok(pushStart !== -1 && dispatchStart > pushStart);
    const pushStep = tagRelease.slice(pushStart, dispatchStart);
    assert.match(pushStep, /id: push\n/);
    const skipped = pushStep.indexOf('echo "pushed=false" >> "$GITHUB_OUTPUT"');
    const skipExit = pushStep.indexOf('exit 0', skipped === -1 ? 0 : skipped);
    const tagCmd = pushStep.indexOf('git tag -a');
    const pushCmd = pushStep.indexOf('git push origin "$TAG"');
    assert.ok(skipped !== -1 && skipExit > skipped && tagCmd > skipExit && pushCmd > tagCmd);
    assert.match(pushStep, /git push origin "\$TAG"\n {10}echo "pushed=true" >> "\$GITHUB_OUTPUT"/);
    const dispatchStep = tagRelease.slice(dispatchStart);
    const gate = dispatchStep.indexOf("if: steps.push.outputs.pushed == 'true'");
    const run = dispatchStep.indexOf(
      'gh workflow run release.yaml --repo "$GITHUB_REPOSITORY" --ref "$TAG"',
    );
    assert.ok(gate !== -1 && run > gate);
    assert.doesNotMatch(tagRelease, /Pushing the tag is what triggers release\.yaml/);
  });

  it('describes the dispatch and the fallback that leaves the tag in place', () => {
    assert.match(prepare, /dispatches `release\.yaml`/);
    assert.match(operator, /gh workflow run release\.yaml --ref vX\.Y\.Z/);
    assert.match(operator, /Do not delete the tag and push it again/);
  });
});
