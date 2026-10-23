#!/usr/bin/env node
// Renders the changelog with git-cliff, one entry per change that landed on the
// first-parent history (PR merges, squash merges, direct pushes). Commits from
// inside a PR branch are dropped; the PR entry stands for them. Each PR entry
// gets the issues it closes, which git-cliff cannot look up on its own, and a
// squash commit whose SHA GitHub no longer maps to its PR falls back to the
// `(#n)` in its subject.
//
// Usage: node scripts/changelog.mjs [git-cliff args...]
// Range and tag args (--latest, --tag vX.Y.Z, <range>) select the releases;
// --output/-o and --strip go to the render step.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RENDER_FLAGS = new Set(['--output', '-o', '--strip', '-s']);
const PR_BATCH = 50;

/** Splits CLI args into the context step (range/tag) and the render step (output). */
export function splitArgs(argv) {
  const context = [];
  const render = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const flag = arg.split('=')[0];
    if (RENDER_FLAGS.has(flag)) {
      render.push(arg);
      if (!arg.includes('=') && i + 1 < argv.length) render.push(argv[++i]);
    } else {
      context.push(arg);
    }
  }
  return { context, render };
}

/** Reads `[remote.github]` owner and repo from cliff.toml. */
export function readGithubRemote(toml) {
  const section = toml.split(/^\[remote\.github\]\s*$/m)[1]?.split(/^\[/m)[0] ?? '';
  const owner = section.match(/^owner\s*=\s*"([^"]+)"/m)?.[1];
  const repo = section.match(/^repo\s*=\s*"([^"]+)"/m)?.[1];
  if (!owner || !repo) throw new Error('cliff.toml is missing [remote.github] owner/repo');
  return { owner, repo };
}

/** Keeps only commits on the first-parent history, so each PR appears once. */
export function keepFirstParent(releases, firstParent) {
  for (const release of releases) {
    release.commits = release.commits.filter((commit) => firstParent.has(commit.id));
  }
  return releases;
}

/** Fills a missing PR number from a trailing `(#n)` in the first-parent subject. */
export function fillPrFromSubjects(releases, subjects) {
  for (const release of releases) {
    for (const commit of release.commits) {
      if (commit.remote?.pr_number) continue;
      const match = subjects.get(commit.id)?.match(/\(#(\d+)\)$/);
      if (!match) continue;
      commit.remote = { ...emptyRemote(), ...(commit.remote ?? {}), pr_number: Number(match[1]) };
    }
  }
  return releases;
}

function emptyRemote() {
  return {
    username: null,
    pr_author: null,
    pr_title: null,
    pr_number: null,
    pr_numbers: [],
    pr_labels: [],
    is_first_time: false,
  };
}

/** Collects the PR numbers git-cliff attached to the remaining commits. */
export function prNumbers(releases) {
  const numbers = new Set();
  for (const release of releases) {
    for (const commit of release.commits) {
      if (commit.remote?.pr_number) numbers.add(commit.remote.pr_number);
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

/** Formats a closing issue as `#n`, or `owner/repo#n` when it lives elsewhere. */
export function issueRef(issue, nameWithOwner) {
  return issue.repository.nameWithOwner === nameWithOwner
    ? `#${issue.number}`
    : `${issue.repository.nameWithOwner}#${issue.number}`;
}

/** Stores each PR's closing issues as `extra.closes` and fills a missing PR author. */
export function attachPrData(releases, prData) {
  for (const release of releases) {
    for (const commit of release.commits) {
      const pr = prData.get(commit.remote?.pr_number);
      if (!pr) continue;
      if (!commit.remote.pr_author && pr.author) commit.remote.pr_author = pr.author;
      if (pr.closes.length) commit.extra = { ...(commit.extra ?? {}), closes: pr.closes };
    }
  }
  return releases;
}

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

async function fetchPrData(numbers, { owner, repo }, token) {
  const nameWithOwner = `${owner}/${repo}`;
  const prData = new Map();
  for (let i = 0; i < numbers.length; i += PR_BATCH) {
    const batch = numbers.slice(i, i + PR_BATCH);
    const fields = batch
      .map(
        (n) =>
          `pr${n}: pullRequest(number: ${n}) { number author { login } closingIssuesReferences(first: 20) { nodes { number repository { nameWithOwner } } } }`,
      )
      .join('\n');
    const query = `query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { ${fields} } }`;
    const res = await fetch(process.env.GITHUB_GRAPHQL_URL || 'https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { owner, repo } }),
    });
    if (!res.ok) throw new Error(`GitHub GraphQL request failed: ${res.status} ${await res.text()}`);
    const { data, errors } = await res.json();
    // A `(#n)` subject can point at an issue rather than a PR; GitHub reports
    // that as NOT_FOUND with a null field, which is skipped below.
    const fatal = errors?.filter((error) => error.type !== 'NOT_FOUND') ?? [];
    if (fatal.length || !data?.repository) {
      throw new Error(`GitHub GraphQL errors: ${JSON.stringify(fatal.length ? fatal : errors)}`);
    }
    for (const pr of Object.values(data.repository)) {
      if (!pr) continue;
      prData.set(pr.number, {
        author: pr.author?.login ?? null,
        closes: pr.closingIssuesReferences.nodes.map((issue) => issueRef(issue, nameWithOwner)),
      });
    }
  }
  return prData;
}

async function main() {
  const token = githubToken();
  if (!token) {
    console.error('Error: set GITHUB_TOKEN or run `gh auth login`; release notes need GitHub PR data.');
    process.exit(1);
  }
  const env = { ...process.env, GITHUB_TOKEN: token };
  const { context, render } = splitArgs(process.argv.slice(2));
  const remote = readGithubRemote(readFileSync(join(ROOT, 'cliff.toml'), 'utf8'));

  const releases = JSON.parse(
    execFileSync('git-cliff', ['--context', ...context], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    }),
  );
  const subjects = new Map(
    execFileSync('git', ['log', '--first-parent', '--format=%H %s', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf(' ')), line.slice(line.indexOf(' ') + 1)]),
  );
  keepFirstParent(releases, subjects);
  fillPrFromSubjects(releases, subjects);
  attachPrData(releases, await fetchPrData(prNumbers(releases), remote, token));

  const dir = mkdtempSync(join(tmpdir(), 'changelog-'));
  try {
    const contextPath = join(dir, 'context.json');
    writeFileSync(contextPath, JSON.stringify(releases));
    execFileSync('git-cliff', ['--from-context', contextPath, ...render], {
      cwd: ROOT,
      env,
      stdio: 'inherit',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
