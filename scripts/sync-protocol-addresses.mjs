#!/usr/bin/env node
// Maps pacto-gov-system-tests Sepolia artifacts into the tracked protocol address book.
// Does not generate Alloy bindings. Operators full-restart Tauri after a book write
// (`include_str!` embed). Usage:
//   node scripts/sync-protocol-addresses.mjs --from-dir /path/to/pacto-gov-system-tests
//   node scripts/sync-protocol-addresses.mjs --from-github owner/repo@sha
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_BOOK_PATH = join(ROOT, 'src/lib/evm/pacto-protocol-addresses.json');
export const DEFAULT_NETWORK = 'sepolia';
export const DEFAULT_CHAIN_ID = 11155111;

/** September Sepolia pins that a cutover must not write back. */
export const RETIRED_SEPOLIA_PINS = {
  navePirataFactory: '0xd540B03A83d3Fc78922cAb9742e67B8B272bC2b9',
  navePirataRegistry: '0xb4e9349540ed00A7a76Da52e1BBe562D9587ba23',
  sponsorPolicyRegistry: '0x1350F096FA383e0D73C02fc13797F207295ef248',
};

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

const ARTIFACT_FILES = {
  stack: (chainId) => `deployments/${chainId}/stack.json`,
  govInfra: (chainId) => `deployments/pacto-gov/${chainId}/infra.json`,
  govFull: (chainId) => `deployments/pacto-gov/${chainId}/full-system.json`,
  govExternal: (chainId) => `deployments/pacto-gov/${chainId}/external.json`,
  username: (chainId) => `deployments/pacto-username-nft/${chainId}/full-system.json`,
  sponsor: (chainId) => `deployments/pacto-squad-sponsor/${chainId}/full-system.json`,
};

export function eqAddr(a, b) {
  return String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
}

export function requireAddr(obj, key, label) {
  const value = obj?.[key];
  if (typeof value !== 'string' || !ADDR_RE.test(value)) {
    throw new Error(`Missing or invalid address ${label}.${key}`);
  }
  return value;
}

export function parseGithubRef(spec) {
  const match = String(spec).match(/^([^/]+)\/([^@]+)@(.+)$/);
  if (!match) {
    throw new Error(`Expected --from-github owner/repo@ref, got ${spec}`);
  }
  return { owner: match[1], repo: match[2], ref: match[3] };
}

export function parseArgs(argv) {
  const out = {
    fromDir: null,
    fromGithub: null,
    book: DEFAULT_BOOK_PATH,
    network: DEFAULT_NETWORK,
    chainId: DEFAULT_CHAIN_ID,
    dryRun: false,
    help: false,
    sourceLabel: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const take = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`Missing value for ${arg}`);
      return next;
    };
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--from-dir') out.fromDir = take();
    else if (arg.startsWith('--from-dir=')) out.fromDir = arg.slice('--from-dir='.length);
    else if (arg === '--from-github') out.fromGithub = take();
    else if (arg.startsWith('--from-github=')) out.fromGithub = arg.slice('--from-github='.length);
    else if (arg === '--book') out.book = take();
    else if (arg.startsWith('--book=')) out.book = arg.slice('--book='.length);
    else if (arg === '--network') out.network = take();
    else if (arg.startsWith('--network=')) out.network = arg.slice('--network='.length);
    else if (arg === '--chain-id') out.chainId = Number(take());
    else if (arg.startsWith('--chain-id=')) out.chainId = Number(arg.slice('--chain-id='.length));
    else if (arg === '--source-label') out.sourceLabel = take();
    else if (arg.startsWith('--source-label=')) out.sourceLabel = arg.slice('--source-label='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(out.chainId) || out.chainId <= 0) {
    throw new Error(`Invalid --chain-id ${out.chainId}`);
  }
  if (!out.help && !out.fromDir && !out.fromGithub) {
    throw new Error('Pass --from-dir <path> or --from-github owner/repo@ref');
  }
  if (out.fromDir && out.fromGithub) {
    throw new Error('Pass only one of --from-dir or --from-github');
  }
  return out;
}

export function formatComment({ sourceLabel, pins }) {
  const pinBits = pins
    ? Object.entries(pins)
        .map(([name, sha]) => `${name} ${String(sha).slice(0, 8)}`)
        .join(', ')
    : null;
  const pinNote = pinBits ? ` pins: ${pinBits}.` : '';
  return (
    'Pacto protocol deploy infra per network. Rust Alloy UX reads this at compile time; ' +
    `optional PACTO_* env vars override for local experiments. Sepolia synced from ${sourceLabel}.${pinNote} ` +
    'navePirataRegistry is the gov registry (not the sponsor artifact). EIP-7702 accountImplementation ' +
    'must match the previous book pin unless pacto-aa is redeployed. Full Tauri restart after this write.'
  );
}

function assertChainId(obj, chainId, label) {
  if (obj?.chainId !== undefined && obj.chainId !== chainId) {
    throw new Error(`${label} chainId ${obj.chainId} !== ${chainId}`);
  }
}

function assertSameAddr(left, right, message) {
  if (!eqAddr(left, right)) {
    throw new Error(`${message}: ${left} !== ${right}`);
  }
}

function assertNotRetired(addr, retired, label) {
  if (eqAddr(addr, retired)) {
    throw new Error(`${label} is a retired September pin (${retired})`);
  }
}

export async function loadArtifactsFromDir(root, chainId) {
  const artifacts = {};
  for (const [key, rel] of Object.entries(ARTIFACT_FILES)) {
    artifacts[key] = await asyncReadJson(join(root, rel(chainId)), key);
  }
  return artifacts;
}

async function asyncReadJson(path, label) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new Error(`Missing ${label} artifact at ${path}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${label} artifact ${path}`);
  }
}

function loadGithubJsonViaGh(owner, repo, ref, path) {
  const apiPath = `repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
  let b64;
  try {
    b64 = execFileSync('gh', ['api', apiPath, '--jq', '.content'], { encoding: 'utf8' }).trim();
  } catch (err) {
    throw new Error(`gh api ${apiPath} failed: ${err.message}`);
  }
  if (!b64) throw new Error(`gh api ${apiPath} returned empty content`);
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

export async function loadArtifactsFromGithub(spec, chainId, fetchImpl = fetch) {
  const { owner, repo, ref } = parseGithubRef(spec);
  const artifacts = {};
  for (const [key, rel] of Object.entries(ARTIFACT_FILES)) {
    const path = rel(chainId);
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
    const res = await fetchImpl(url);
    if (res.ok) {
      artifacts[key] = await res.json();
      continue;
    }
    if (fetchImpl !== fetch) {
      throw new Error(`GET ${url} → ${res.status}`);
    }
    artifacts[key] = loadGithubJsonViaGh(owner, repo, ref, path);
  }
  return artifacts;
}

export function mapSepoliaCutover({ artifacts, currentBook, network = DEFAULT_NETWORK, chainId = DEFAULT_CHAIN_ID, sourceLabel }) {
  const current = currentBook?.networks?.[network];
  if (!current) {
    throw new Error(`Address book has no networks.${network} block`);
  }
  const fallbackHandler = current.safe?.fallbackHandler;
  if (typeof fallbackHandler !== 'string' || !ADDR_RE.test(fallbackHandler)) {
    throw new Error(`Book networks.${network}.safe.fallbackHandler is missing; system-tests artifacts do not supply it`);
  }
  const current7702 = current.erc4337?.accountImplementation;
  if (typeof current7702 !== 'string' || !ADDR_RE.test(current7702)) {
    throw new Error(`Book networks.${network}.erc4337.accountImplementation is missing`);
  }

  const { stack, govInfra, govFull, govExternal, username, sponsor } = artifacts;
  for (const [label, obj] of Object.entries(artifacts)) {
    assertChainId(obj, chainId, label);
  }

  const navePirataFactory = requireAddr(govInfra, 'navePirataFactory', 'govInfra');
  const navePirataRegistry = requireAddr(govInfra, 'navePirataRegistry', 'govInfra');
  const warGameRegistry = requireAddr(govInfra, 'warGameRegistry', 'govInfra');
  const roleHatClonesFactory = requireAddr(govInfra, 'roleHatClonesFactory', 'govInfra');
  const roleHatUpgrader = requireAddr(govInfra, 'roleHatUpgrader', 'govInfra');
  const policyFromInfra = requireAddr(govInfra, 'sponsorPolicyRegistry', 'govInfra');

  assertSameAddr(
    requireAddr(govFull, 'navePirataFactory', 'govFull'),
    navePirataFactory,
    'gov full-system factory must match infra',
  );
  assertSameAddr(
    requireAddr(govFull, 'navePirataRegistry', 'govFull'),
    navePirataRegistry,
    'gov full-system registry must match infra',
  );

  const sponsorRegistry = requireAddr(sponsor, 'navePirataRegistry', 'sponsor');
  assertSameAddr(navePirataRegistry, sponsorRegistry, 'gov registry must match sponsor navePirataRegistry');

  const squadSponsorFactory = requireAddr(sponsor, 'squadSponsorFactory', 'sponsor');
  const pactoSponsorPaymaster = requireAddr(sponsor, 'pactoSponsorPaymaster', 'sponsor');
  const entryPoint = requireAddr(sponsor, 'entryPoint', 'sponsor');

  const usernameFields = {
    protocolRegistry: requireAddr(username, 'protocolRegistry', 'username'),
    usernameSystemFactory: requireAddr(username, 'usernameSystemFactory', 'username'),
    pactoUsernameNft: requireAddr(username, 'pactoUsernameNft', 'username'),
    globalSponsorPool: requireAddr(username, 'globalSponsorPool', 'username'),
    bootstrapMintPool: requireAddr(username, 'bootstrapMintPool', 'username'),
    sponsorPolicyRegistry: requireAddr(username, 'sponsorPolicyRegistry', 'username'),
    bootstrapClaimPolicy: requireAddr(username, 'bootstrapClaimPolicy', 'username'),
    pactoGlobalPaymaster: requireAddr(username, 'pactoGlobalPaymaster', 'username'),
    nostrClaimLink: requireAddr(username, 'nostrClaimLink', 'username'),
    allowed7702Implementation: requireAddr(username, 'allowed7702Implementation', 'username'),
    entryPoint: requireAddr(username, 'entryPoint', 'username'),
  };
  assertSameAddr(usernameFields.sponsorPolicyRegistry, policyFromInfra, 'username policy registry must match gov infra');
  assertSameAddr(usernameFields.entryPoint, entryPoint, 'username entryPoint must match sponsor');

  const accountImplementation = requireAddr(stack.addresses ?? {}, 'pactoSimple7702Account', 'stack.addresses');
  if (!eqAddr(accountImplementation, current7702)) {
    throw new Error(
      `EIP-7702 implementation ${accountImplementation} !== book pin ${current7702} (pacto-aa is not part of this cutover)`,
    );
  }
  assertSameAddr(
    usernameFields.allowed7702Implementation,
    accountImplementation,
    'username allowed7702Implementation must match stack 7702 account',
  );

  const stackAddr = stack.addresses ?? {};
  const stackChecks = [
    ['navePirataFactory', navePirataFactory],
    ['navePirataRegistry', navePirataRegistry],
    ['warGameRegistry', warGameRegistry],
    ['roleHatClonesFactory', roleHatClonesFactory],
    ['roleHatUpgrader', roleHatUpgrader],
    ['sponsorPolicyRegistry', policyFromInfra],
    ['squadSponsorFactory', squadSponsorFactory],
    ['pactoSponsorPaymaster', pactoSponsorPaymaster],
    ['entryPoint', entryPoint],
    ['allowed7702Implementation', accountImplementation],
    ['protocolRegistry', usernameFields.protocolRegistry],
    ['usernameSystemFactory', usernameFields.usernameSystemFactory],
    ['pactoUsernameNft', usernameFields.pactoUsernameNft],
    ['pactoGlobalPaymaster', usernameFields.pactoGlobalPaymaster],
    ['globalSponsorPool', usernameFields.globalSponsorPool],
    ['bootstrapMintPool', usernameFields.bootstrapMintPool],
    ['bootstrapClaimPolicy', usernameFields.bootstrapClaimPolicy],
    ['nostrClaimLink', usernameFields.nostrClaimLink],
  ];
  for (const [key, expected] of stackChecks) {
    if (stackAddr[key] !== undefined) {
      assertSameAddr(requireAddr(stackAddr, key, 'stack.addresses'), expected, `stack.addresses.${key} mismatch`);
    }
  }

  const hats = requireAddr(govFull, 'hats', 'govFull');
  if (govExternal.hats !== undefined) {
    assertSameAddr(requireAddr(govExternal, 'hats', 'govExternal'), hats, 'external hats must match gov full-system');
  }

  assertNotRetired(navePirataFactory, RETIRED_SEPOLIA_PINS.navePirataFactory, 'navePirataFactory');
  assertNotRetired(navePirataRegistry, RETIRED_SEPOLIA_PINS.navePirataRegistry, 'navePirataRegistry');
  assertNotRetired(policyFromInfra, RETIRED_SEPOLIA_PINS.sponsorPolicyRegistry, 'sponsorPolicyRegistry');

  if (
    eqAddr(navePirataFactory, current.pactoGov?.navePirataFactory) &&
    eqAddr(navePirataRegistry, current.pactoGov?.navePirataRegistry) &&
    eqAddr(policyFromInfra, current.globalUsernameSponsor?.sponsorPolicyRegistry)
  ) {
    throw new Error('Refusing no-op cutover: factory, registry, and policy match the current book');
  }

  return {
    sourceLabel,
    pins: stack.pins ?? null,
    network: {
      chainId,
      meta: { deployer: requireAddr(govFull, 'deployer', 'govFull') },
      globalUsernameSponsor: usernameFields,
      squadSponsor: {
        factory: squadSponsorFactory,
        paymaster: pactoSponsorPaymaster,
        entryPoint,
        navePirataRegistry,
      },
      pactoGov: {
        navePirataFactory,
        navePirataRegistry,
        warGameRegistry,
        masterQuartermaster: requireAddr(govFull, 'masterQuartermaster', 'govFull'),
        masterMutiny: requireAddr(govFull, 'masterMutinyModule', 'govFull'),
        masterTreasuryAuthority: requireAddr(govFull, 'masterTreasuryAuthority', 'govFull'),
        masterSquadAdminImpl: requireAddr(govFull, 'masterSquadAdminImpl', 'govFull'),
        masterSquadAdminExtImpl: requireAddr(govFull, 'masterSquadAdminExtImpl', 'govFull'),
        hats,
        roleHatClonesFactory,
        roleHatUpgrader,
      },
      safe: {
        proxyFactory: requireAddr(govExternal, 'safeProxyFactory', 'govExternal'),
        singleton: requireAddr(govExternal, 'safeSingleton', 'govExternal'),
        fallbackHandler,
      },
      erc4337: { accountImplementation },
    },
  };
}

export function applySepoliaCutover(book, mapped) {
  return {
    ...book,
    $comment: formatComment({ sourceLabel: mapped.sourceLabel, pins: mapped.pins }),
    networks: {
      ...book.networks,
      sepolia: mapped.network,
    },
  };
}

export const HELP = `Map pacto-gov-system-tests Sepolia artifacts into src/lib/evm/pacto-protocol-addresses.json.

Usage:
  node scripts/sync-protocol-addresses.mjs --from-dir /path/to/pacto-gov-system-tests
  node scripts/sync-protocol-addresses.mjs --from-github covenant-gov/pacto-gov-system-tests@<sha>

Options:
  --book <path>     Address book JSON (default: src/lib/evm/pacto-protocol-addresses.json)
  --network sepolia
  --chain-id 11155111
  --source-label <text>  Override $comment source (default: github spec or dir path)
  --dry-run         Print the mapped book; do not write
`;

export async function run(argv, { fetchImpl = fetch, stdout = process.stdout } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    stdout.write(HELP);
    return { dryRun: true, book: null };
  }
  const bookRaw = await readFile(args.book, 'utf8');
  const currentBook = JSON.parse(bookRaw);
  const sourceLabel =
    args.sourceLabel ??
    (args.fromGithub
      ? `pacto-gov-system-tests ${args.fromGithub}`
      : `pacto-gov-system-tests dir ${resolve(args.fromDir)}`);
  const artifacts = args.fromGithub
    ? await loadArtifactsFromGithub(args.fromGithub, args.chainId, fetchImpl)
    : await loadArtifactsFromDir(resolve(args.fromDir), args.chainId);
  const mapped = mapSepoliaCutover({
    artifacts,
    currentBook,
    network: args.network,
    chainId: args.chainId,
    sourceLabel,
  });
  const next = applySepoliaCutover(currentBook, mapped);
  const rendered = `${JSON.stringify(next, null, 2)}\n`;
  if (args.dryRun) {
    stdout.write(rendered);
    return { dryRun: true, book: next };
  }
  await mkdir(dirname(args.book), { recursive: true });
  await writeFile(args.book, rendered);
  stdout.write(`Wrote ${args.book}\nRestart Tauri so the compile-time embed reloads.\n`);
  return { dryRun: false, book: next };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
