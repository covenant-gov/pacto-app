import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import {
  attachPrData,
  fillPrFromSubjects,
  issueRef,
  keepFirstParent,
  prNumbers,
  readGithubRemote,
  splitArgs,
} from './changelog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function sampleReleases() {
  return [
    {
      version: 'v1.1.0',
      commits: [
        { id: 'branch1', remote: { username: 'alice', pr_number: null } },
        { id: 'merge1', remote: { username: 'bob', pr_author: 'alice', pr_number: 12 } },
        { id: 'squash1', remote: { username: 'carol', pr_author: 'carol', pr_number: 9 } },
        { id: 'direct1', remote: { username: 'dave', pr_number: null } },
      ],
    },
  ];
}

describe('splitArgs', () => {
  it('sends output and strip flags to the render step and the rest to the context step', () => {
    assert.deepEqual(splitArgs(['--latest', '--output', 'out.md', '--tag', 'v1.0.0', '-s', 'header']), {
      context: ['--latest', '--tag', 'v1.0.0'],
      render: ['--output', 'out.md', '-s', 'header'],
    });
  });

  it('keeps an inline output value with its flag', () => {
    assert.deepEqual(splitArgs(['--output=CHANGELOG.md', 'v1.0.0..v1.1.0']), {
      context: ['v1.0.0..v1.1.0'],
      render: ['--output=CHANGELOG.md'],
    });
  });
});

describe('keepFirstParent', () => {
  it('drops commits that only exist inside a PR branch', () => {
    const releases = keepFirstParent(sampleReleases(), new Set(['merge1', 'squash1', 'direct1']));
    assert.deepEqual(
      releases[0].commits.map((c) => c.id),
      ['merge1', 'squash1', 'direct1'],
    );
  });
});

describe('prNumbers', () => {
  it('returns each PR once, sorted', () => {
    assert.deepEqual(prNumbers(sampleReleases()), [9, 12]);
  });
});

describe('issueRef', () => {
  it('uses a short ref for same-repo issues and a qualified ref otherwise', () => {
    assert.equal(issueRef({ number: 3, repository: { nameWithOwner: 'o/r' } }, 'o/r'), '#3');
    assert.equal(issueRef({ number: 3, repository: { nameWithOwner: 'x/y' } }, 'o/r'), 'x/y#3');
  });
});

describe('fillPrFromSubjects', () => {
  it('takes the PR number from a squash subject when GitHub did not map the commit', () => {
    const releases = [
      {
        commits: [
          { id: 'squash', remote: { username: 'carol', pr_number: null, pr_labels: [] } },
          { id: 'mapped', remote: { username: 'bob', pr_number: 12 } },
          { id: 'direct', remote: { username: 'dave', pr_number: null } },
        ],
      },
    ];
    const subjects = new Map([
      ['squash', 'fix: thing (#7)'],
      ['mapped', 'Merge pull request #12 from o/branch'],
      ['direct', 'fix: mention (#3) mid-subject'],
    ]);
    const [release] = fillPrFromSubjects(releases, subjects);
    assert.equal(release.commits[0].remote.pr_number, 7);
    assert.equal(release.commits[0].remote.username, 'carol');
    assert.equal(release.commits[1].remote.pr_number, 12);
    assert.equal(release.commits[2].remote.pr_number, null);
  });
});

describe('attachPrData', () => {
  it('sets extra.closes only on commits whose PR closes issues', () => {
    const prData = new Map([
      [12, { author: 'alice', closes: ['#5', '#6'] }],
      [9, { author: 'carol', closes: [] }],
    ]);
    const releases = attachPrData(sampleReleases(), prData);
    const byId = Object.fromEntries(releases[0].commits.map((c) => [c.id, c]));
    assert.deepEqual(byId.merge1.extra, { closes: ['#5', '#6'] });
    assert.equal(byId.squash1.extra, undefined);
    assert.equal(byId.direct1.extra, undefined);
  });

  it('fills a missing PR author without overriding the one git-cliff found', () => {
    const releases = [
      {
        commits: [
          { id: 'a', remote: { username: 'merger', pr_author: null, pr_number: 7 } },
          { id: 'b', remote: { username: 'merger', pr_author: 'alice', pr_number: 12 } },
        ],
      },
    ];
    const prData = new Map([
      [7, { author: 'carol', closes: [] }],
      [12, { author: 'someone-else', closes: [] }],
    ]);
    attachPrData(releases, prData);
    assert.equal(releases[0].commits[0].remote.pr_author, 'carol');
    assert.equal(releases[0].commits[1].remote.pr_author, 'alice');
  });
});

describe('cliff.toml', () => {
  const toml = readFileSync(join(root, 'cliff.toml'), 'utf8');

  it('points the GitHub remote at this repo', () => {
    assert.deepEqual(readGithubRemote(toml), { owner: 'covenant-gov', repo: 'pacto-app' });
  });

  it('renders only the subject line, with PR number, author, and closed issues', () => {
    assert.match(toml, /commit\.message \| split\(pat="\\n"\) \| first/);
    assert.match(toml, /commit\.remote\.pr_number/);
    assert.match(toml, /commit\.remote\.pr_author/);
    assert.match(toml, /commit\.extra\.closes/);
  });
});
