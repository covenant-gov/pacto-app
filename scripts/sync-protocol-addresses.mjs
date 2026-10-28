#!/usr/bin/env node
// Maps pacto-onchain-orchestrator Sepolia stack.json into the tracked protocol address book.
// Does not generate Alloy bindings. Operators full-restart Tauri after a book write
// (`include_str!` embed). Usage:
//   node scripts/sync-protocol-addresses.mjs --from-dir /path/to/pacto-onchain-orchestrator
//   node scripts/sync-protocol-addresses.mjs --from-github owner/repo@sha
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_BOOK_PATH = join(ROOT, 'src/lib/evm/pacto-protocol-addresses.json');
export const DEFAULT_NETWORK = 'sepolia';
export const DEFAULT_CHAIN_ID = 11155111;

/** Superseded Sepolia pins a cutover must not write back. */
export const RETIRED_SEPOLIA_PINS = {
  navePirataFactory: '0xd540B03A83d3Fc78922cAb9742e67B8B272bC2b9',
  navePirataRegistry: '0xb4e9349540ed00A7a76Da52e1BBe562D9587ba23',
  sponsorPolicyRegistry: '0x1350F096FA383e0D73C02fc13797F207295ef248',
};

export const RETIRED_OCT_2026_SEPOLIA = {
  navePirataFactory: '0x97d2dbA09FCA62f3E634d850aB7d8fd7AdC7d9E4',
  navePirataRegistry: '0xEDe67E7f75cD12F3517AaFD15D711956F3d95850',
  sponsorPolicyRegistry: '0xa70590C06fEab74a2df569290d8CD8392b699ae4',
  squadSponsorFactory: '0x280755769367DDD108020eEF353A6dF0f8355f36',
  pactoSponsorPaymaster: '0x86480317e27CF7019E966b098AF10588e021DA8f',
  pactoGlobalPaymaster: '0x7F628e9F5874c7d777bA7889951A13C996407E49',
};

const STACK_PATH = (chainId) => `deployments/${chainId}/stack.json`;

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

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

function assertNotRetired(addr, retired, label) {
  if (eqAddr(addr, retired)) {
    throw new Error(`${label} is a retired pin (${retired})`);
  }
}

function assertNotRetiredSet(addr, retiredMap, label) {
  for (const [name, pin] of Object.entries(retiredMap)) {
    if (eqAddr(addr, pin)) {
      throw new Error(`${label} is a retired ${name} pin (${pin})`);
    }
  }
}

function assertSameAddr(left, right, message) {
  if (!eqAddr(left, right)) {
    throw new Error(`${message}: ${left} !== ${right}`);
  }
}

export async function loadArtifactsFromDir(root, chainId) {
  const stack = await asyncReadJson(join(root, STACK_PATH(chainId)), 'stack');
  return { stack };
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
    throw new Error(`gh api ${apiPath} failed: ${err.message}`, { cause: err });
  }
  if (!b64) throw new Error(`gh api ${apiPath} returned empty content`);
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

export async function loadArtifactsFromGithub(spec, chainId, fetchImpl = fetch) {
  const { owner, repo, ref } = parseGithubRef(spec);
  const path = STACK_PATH(chainId);
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
  const res = await fetchImpl(url);
  if (res.ok) {
    return { stack: await res.json() };
  }
  if (fetchImpl !== fetch) {
    throw new Error(`GET ${url} → ${res.status}`);
  }
  return { stack: loadGithubJsonViaGh(owner, repo, ref, path) };
}

export function mapSepoliaCutover({ artifacts, currentBook, network = DEFAULT_NETWORK, chainId = DEFAULT_CHAIN_ID, sourceLabel }) {
  const current = currentBook?.networks?.[network];
  if (!current) {
    throw new Error(`Address book has no networks.${network} block`);
  }
  const fallbackHandler = current.safe?.fallbackHandler;
  if (typeof fallbackHandler !== 'string' || !ADDR_RE.test(fallbackHandler)) {
    throw new Error(`Book networks.${network}.safe.fallbackHandler is missing; orchestrator stack.json does not supply it`);
  }
  const current7702 = current.erc4337?.accountImplementation;
  if (typeof current7702 !== 'string' || !ADDR_RE.test(current7702)) {
    throw new Error(`Book networks.${network}.erc4337.accountImplementation is missing`);
  }

  const { stack } = artifacts;
  assertChainId(stack, chainId, 'stack');

  const addr = stack.addresses ?? {};
  const navePirataFactory = requireAddr(addr, 'navePirataFactory', 'stack.addresses');
  const navePirataRegistry = requireAddr(addr, 'navePirataRegistry', 'stack.addresses');
  const policyFromStack = requireAddr(addr, 'sponsorPolicyRegistry', 'stack.addresses');
  const squadSponsorFactory = requireAddr(addr, 'squadSponsorFactory', 'stack.addresses');
  const pactoSponsorPaymaster = requireAddr(addr, 'pactoSponsorPaymaster', 'stack.addresses');
  const entryPoint = requireAddr(addr, 'entryPoint', 'stack.addresses');

  const usernameFields = {
    protocolRegistry: requireAddr(addr, 'protocolRegistry', 'stack.addresses'),
    usernameSystemFactory: requireAddr(addr, 'usernameSystemFactory', 'stack.addresses'),
    pactoUsernameNft: requireAddr(addr, 'pactoUsernameNft', 'stack.addresses'),
    globalSponsorPool: requireAddr(addr, 'globalSponsorPool', 'stack.addresses'),
    bootstrapMintPool: requireAddr(addr, 'bootstrapMintPool', 'stack.addresses'),
    sponsorPolicyRegistry: policyFromStack,
    bootstrapClaimPolicy: requireAddr(addr, 'bootstrapClaimPolicy', 'stack.addresses'),
    pactoGlobalPaymaster: requireAddr(addr, 'pactoGlobalPaymaster', 'stack.addresses'),
    nostrClaimLink: requireAddr(addr, 'nostrClaimLink', 'stack.addresses'),
    allowed7702Implementation: requireAddr(addr, 'allowed7702Implementation', 'stack.addresses'),
    entryPoint,
  };

  const accountImplementation = requireAddr(addr, 'pactoSimple7702Account', 'stack.addresses');
  if (!eqAddr(accountImplementation, current7702)) {
    throw new Error(
      `EIP-7702 implementation ${accountImplementation} !== book pin ${current7702} (pacto-aa is not part of this cutover)`,
    );
  }
  assertSameAddr(
    usernameFields.allowed7702Implementation,
    accountImplementation,
    'stack allowed7702Implementation must match pactoSimple7702Account',
  );

  assertNotRetired(navePirataFactory, RETIRED_SEPOLIA_PINS.navePirataFactory, 'navePirataFactory');
  assertNotRetired(navePirataRegistry, RETIRED_SEPOLIA_PINS.navePirataRegistry, 'navePirataRegistry');
  assertNotRetired(policyFromStack, RETIRED_SEPOLIA_PINS.sponsorPolicyRegistry, 'sponsorPolicyRegistry');
  assertNotRetiredSet(navePirataFactory, RETIRED_OCT_2026_SEPOLIA, 'navePirataFactory');
  assertNotRetiredSet(navePirataRegistry, { navePirataRegistry: RETIRED_OCT_2026_SEPOLIA.navePirataRegistry }, 'navePirataRegistry');
  assertNotRetiredSet(policyFromStack, { sponsorPolicyRegistry: RETIRED_OCT_2026_SEPOLIA.sponsorPolicyRegistry }, 'sponsorPolicyRegistry');
  assertNotRetiredSet(squadSponsorFactory, { squadSponsorFactory: RETIRED_OCT_2026_SEPOLIA.squadSponsorFactory }, 'squadSponsorFactory');
  assertNotRetiredSet(pactoSponsorPaymaster, { pactoSponsorPaymaster: RETIRED_OCT_2026_SEPOLIA.pactoSponsorPaymaster }, 'pactoSponsorPaymaster');
  assertNotRetiredSet(
    usernameFields.pactoGlobalPaymaster,
    { pactoGlobalPaymaster: RETIRED_OCT_2026_SEPOLIA.pactoGlobalPaymaster },
    'pactoGlobalPaymaster',
  );

  if (
    eqAddr(navePirataFactory, current.pactoGov?.navePirataFactory) &&
    eqAddr(navePirataRegistry, current.pactoGov?.navePirataRegistry) &&
    eqAddr(policyFromStack, current.globalUsernameSponsor?.sponsorPolicyRegistry)
  ) {
    throw new Error('Refusing no-op cutover: factory, registry, and policy match the current book');
  }

  const deployer = requireAddr(stack.meta ?? {}, 'deployer', 'stack.meta');

  return {
    sourceLabel,
    pins: stack.pins ?? null,
    network: {
      chainId,
      meta: { deployer },
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
        warGameRegistry: requireAddr(addr, 'warGameRegistry', 'stack.addresses'),
        masterQuartermaster: requireAddr(addr, 'masterQuartermaster', 'stack.addresses'),
        masterMutiny: requireAddr(addr, 'masterMutinyModule', 'stack.addresses'),
        masterTreasuryAuthority: requireAddr(addr, 'masterTreasuryAuthority', 'stack.addresses'),
        masterSquadAdminImpl: requireAddr(addr, 'masterSquadAdminImpl', 'stack.addresses'),
        masterSquadAdminExtImpl: requireAddr(addr, 'masterSquadAdminExtImpl', 'stack.addresses'),
        hats: requireAddr(addr, 'hats', 'stack.addresses'),
        roleHatClonesFactory: requireAddr(addr, 'roleHatClonesFactory', 'stack.addresses'),
        roleHatUpgrader: requireAddr(addr, 'roleHatUpgrader', 'stack.addresses'),
      },
      safe: {
        proxyFactory: requireAddr(addr, 'safeProxyFactory', 'stack.addresses'),
        singleton: requireAddr(addr, 'safeSingleton', 'stack.addresses'),
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

export const HELP = `Map pacto-onchain-orchestrator Sepolia stack.json into src/lib/evm/pacto-protocol-addresses.json.

Usage:
  node scripts/sync-protocol-addresses.mjs --from-dir /path/to/pacto-onchain-orchestrator
  node scripts/sync-protocol-addresses.mjs --from-github covenant-gov/pacto-onchain-orchestrator@<sha>

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
      ? `pacto-onchain-orchestrator ${args.fromGithub}`
      : `pacto-onchain-orchestrator dir ${resolve(args.fromDir)}`);
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
