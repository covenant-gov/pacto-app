import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import Ajv from 'ajv';

const directory = fileURLToPath(new URL('../whats-new/', import.meta.url));
const schema = JSON.parse(readFileSync(path.join(directory, 'schema.json'), 'utf8'));
const validate = new Ajv({ allErrors: true }).compile(schema);
/** Stable notes files are X.Y.Z only; package.json may carry a semver prerelease. */
const stableVersionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const packageVersionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[a-zA-Z0-9.-]+)?$/;

export function validateWhatsNew(notes, version) {
  if (!stableVersionPattern.test(version)) return ['Expected a release version in X.Y.Z form.'];
  const errors = validate(notes) ? [] : validate.errors.map(error => `${error.instancePath || '/'} ${error.message}`);
  if (notes?.version !== version) errors.push(`Notes must name version ${version}.`);
  return errors;
}

export function validateReleasePullRequest(pull, { notes, headVersion, baseVersion }) {
  if (typeof headVersion !== 'string' || !packageVersionPattern.test(headVersion)) {
    return ['Head package.json must contain a semver version (X.Y.Z or X.Y.Z-prerelease).'];
  }
  if (typeof baseVersion !== 'string' || !packageVersionPattern.test(baseVersion)) {
    return ['Base package.json must contain a semver version (X.Y.Z or X.Y.Z-prerelease).'];
  }
  const releaseBranch = pull.head.ref.startsWith('chore/release-');
  if (releaseBranch && pull.head.ref !== `chore/release-${headVersion}`) return ['Release branch suffix must match the head package.json version.'];
  // Commit statuses are SHA-scoped: a differently named PR for the same bump
  // must enforce the same notes requirements instead of publishing success.
  if (!releaseBranch && headVersion === baseVersion) return [];
  if (pull.head.repo?.full_name !== pull.base.repo.full_name) return ['Version-changing branches must belong to this repository.'];
  const labels = pull.labels.map(label => label.name);
  if (labels.includes('whats-new-skip')) return [];
  // In-app What's New is stable-only; beta cuts must skip notes.
  if (!stableVersionPattern.test(headVersion)) {
    return ['Prerelease versions must use whats-new-skip (user-facing notes are for stable releases).'];
  }
  const errors = validateWhatsNew(notes, headVersion);
  if (!labels.includes('whats-new-ready')) errors.push('Add whats-new-ready after reviewing the notes, or explicitly choose whats-new-skip.');
  return errors;
}

async function checkPullRequest() {
  const { GITHUB_REPOSITORY: repository, GH_TOKEN: token, PR_NUMBER: number, PR_HEAD_SHA: expectedSha } = process.env;
  if (!repository || !token || !/^\d+$/.test(number ?? '') || !expectedSha) throw new Error('Missing release guard environment.');
  const api = async (endpoint, source = repository) => {
    const response = await fetch(`https://api.github.com/repos/${source}/${endpoint}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status} while checking release notes.`);
    return response.json();
  };
  const pull = await api(`pulls/${number}`);
  if (pull.head.sha !== expectedSha) throw new Error('PR head changed; the new commit needs its own release notes check.');
  const headRepository = pull.head.repo?.full_name;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(headRepository ?? '')) throw new Error('PR head repository is unavailable.');
  // Read head content as JSON data only. The checker and schema come from the trusted base checkout.
  const readHeadJson = async filePath => {
    const file = await api(`contents/${filePath}?ref=${encodeURIComponent(pull.head.sha)}`, headRepository);
    if (file.type !== 'file' || file.encoding !== 'base64' || !Number.isInteger(file.size) || file.size < 0 || file.size > 64 * 1024 || typeof file.content !== 'string' || file.content.length > 96 * 1024) {
      throw new Error(`${filePath} must be a JSON file under 64 KiB.`);
    }
    const bytes = Buffer.from(file.content, 'base64');
    if (bytes.length > 64 * 1024) throw new Error(`${filePath} must be under 64 KiB.`);
    return JSON.parse(bytes.toString('utf8'));
  };
  const headPackage = await readHeadJson('package.json');
  const headVersion = headPackage?.version;
  const baseVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  const labels = pull.labels.map(label => label.name);
  let notes;
  if ((pull.head.ref.startsWith('chore/release-') || headVersion !== baseVersion) && typeof headVersion === 'string' && stableVersionPattern.test(headVersion) && !labels.includes('whats-new-skip')) {
    notes = await readHeadJson(`whats-new/${headVersion}.json`);
  }
  return validateReleasePullRequest(pull, { notes, headVersion, baseVersion });
}

async function main() {
  const argument = process.argv[2];
  if (argument === '--pr') return checkPullRequest();
  const versions = argument === '--all'
    ? readdirSync(directory).filter(name => name.endsWith('.json') && name !== 'schema.json').map(name => name.slice(0, -5))
    : [argument];
  const errors = [];
  for (const version of versions) {
    if (!stableVersionPattern.test(version ?? '')) throw new Error('Usage: pnpm whats-new:check <X.Y.Z | --all>');
    const notes = JSON.parse(readFileSync(path.join(directory, `${version}.json`), 'utf8'));
    errors.push(...validateWhatsNew(notes, version).map(error => `${version}: ${error}`));
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(errors => {
    if (errors.length) {
      console.error(errors.join('\n'));
      process.exitCode = 1;
    } else console.log('What’s new notes check passed.');
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
