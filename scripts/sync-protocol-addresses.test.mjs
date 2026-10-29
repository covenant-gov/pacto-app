import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RETIRED_OCT_2026_SEPOLIA,
  RETIRED_SEPOLIA_PINS,
  applySepoliaCutover,
  eqAddr,
  formatComment,
  loadArtifactsFromDir,
  mapSepoliaCutover,
  parseArgs,
  parseGithubRef,
  requireAddr,
  run,
} from './sync-protocol-addresses.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const liveBook = JSON.parse(
  readFileSync(join(root, 'src/lib/evm/pacto-protocol-addresses.json'), 'utf8'),
);

const A = (n) => `0x${n.toString(16).padStart(40, '0')}`;

function cutoverAddrs() {
  return {
    factory: A(0x11),
    registry: A(0x12),
    policy: A(0x13),
    warGame: A(0x14),
    roleHatFactory: A(0x15),
    roleHatUpgrader: A(0x16),
    qm: A(0x21),
    mutiny: A(0x22),
    treasury: A(0x23),
    squadAdmin: A(0x24),
    squadAdminExt: A(0x25),
    hats: A(0x26),
    deployer: A(0x27),
    safeFactory: A(0x31),
    safeSingleton: A(0x32),
    fallback: liveBook.networks.sepolia.safe.fallbackHandler,
    sponsorFactory: A(0x41),
    sponsorPaymaster: A(0x42),
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    protocolRegistry: A(0x51),
    usernameFactory: A(0x52),
    usernameNft: A(0x53),
    globalPool: A(0x54),
    bootstrapPool: A(0x55),
    bootstrapPolicy: A(0x56),
    globalPaymaster: A(0x57),
    nostrClaim: A(0x58),
    account7702: liveBook.networks.sepolia.erc4337.accountImplementation,
  };
}

function stackFrom(addrs) {
  const chainId = 11155111;
  return {
    chainId,
    broadcast: true,
    pins: {
      'pacto-aa': 'aaaaaaaa',
      'pacto-gov': 'bbbbbbbb',
      'pacto-username-nft': 'cccccccc',
      'pacto-squad-sponsor': 'dddddddd',
    },
    meta: { deployer: addrs.deployer },
    addresses: {
      pactoSimple7702Account: addrs.account7702,
      allowed7702Implementation: addrs.account7702,
      sponsorPolicyRegistry: addrs.policy,
      protocolRegistry: addrs.protocolRegistry,
      usernameSystemFactory: addrs.usernameFactory,
      pactoUsernameNft: addrs.usernameNft,
      pactoGlobalPaymaster: addrs.globalPaymaster,
      navePirataFactory: addrs.factory,
      navePirataRegistry: addrs.registry,
      roleHatUpgrader: addrs.roleHatUpgrader,
      warGameRegistry: addrs.warGame,
      roleHatClonesFactory: addrs.roleHatFactory,
      globalSponsorPool: addrs.globalPool,
      bootstrapMintPool: addrs.bootstrapPool,
      bootstrapClaimPolicy: addrs.bootstrapPolicy,
      nostrClaimLink: addrs.nostrClaim,
      entryPoint: addrs.entryPoint,
      squadSponsorFactory: addrs.sponsorFactory,
      pactoSponsorPaymaster: addrs.sponsorPaymaster,
      masterQuartermaster: addrs.qm,
      masterMutinyModule: addrs.mutiny,
      masterTreasuryAuthority: addrs.treasury,
      masterSquadAdminImpl: addrs.squadAdmin,
      masterSquadAdminExtImpl: addrs.squadAdminExt,
      hats: addrs.hats,
      safeProxyFactory: addrs.safeFactory,
      safeSingleton: addrs.safeSingleton,
    },
  };
}

function artifactsFrom(addrs) {
  return { stack: stackFrom(addrs) };
}

function writeStack(dir, stack) {
  const path = join(dir, 'deployments/11155111/stack.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(stack, null, 2));
}

describe('parseArgs', () => {
  it('requires a source', () => {
    assert.throws(() => parseArgs([]), /--from-dir/);
  });

  it('rejects both sources', () => {
    assert.throws(() => parseArgs(['--from-dir', 'x', '--from-github', 'o/r@s']), /only one/);
  });

  it('parses dir, github, dry-run, and book', () => {
    assert.deepEqual(parseArgs(['--from-dir', '/tmp/st', '--dry-run', '--book', 'book.json']), {
      fromDir: '/tmp/st',
      fromGithub: null,
      book: 'book.json',
      network: 'sepolia',
      chainId: 11155111,
      dryRun: true,
      help: false,
      sourceLabel: null,
    });
    const gh = parseArgs(['--from-github=covenant-gov/pacto-onchain-orchestrator@abc1234']);
    assert.equal(gh.fromGithub, 'covenant-gov/pacto-onchain-orchestrator@abc1234');
  });
});

describe('parseGithubRef', () => {
  it('splits owner/repo@ref', () => {
    assert.deepEqual(parseGithubRef('covenant-gov/pacto-onchain-orchestrator@deadbeef'), {
      owner: 'covenant-gov',
      repo: 'pacto-onchain-orchestrator',
      ref: 'deadbeef',
    });
  });
});

describe('mapSepoliaCutover', () => {
  it('maps stack.json onto the book shape and keeps Safe fallback + 7702', () => {
    const addrs = cutoverAddrs();
    const mapped = mapSepoliaCutover({
      artifacts: artifactsFrom(addrs),
      currentBook: liveBook,
      sourceLabel: 'fixture',
    });
    assert.equal(mapped.network.pactoGov.navePirataFactory, addrs.factory);
    assert.equal(mapped.network.pactoGov.navePirataRegistry, addrs.registry);
    assert.equal(mapped.network.pactoGov.masterMutiny, addrs.mutiny);
    assert.equal(mapped.network.squadSponsor.navePirataRegistry, addrs.registry);
    assert.equal(mapped.network.squadSponsor.factory, addrs.sponsorFactory);
    assert.equal(mapped.network.globalUsernameSponsor.pactoUsernameNft, addrs.usernameNft);
    assert.equal(mapped.network.safe.fallbackHandler, addrs.fallback);
    assert.equal(
      mapped.network.erc4337.accountImplementation,
      liveBook.networks.sepolia.erc4337.accountImplementation,
    );
    assert.equal(mapped.network.meta.deployer, addrs.deployer);
  });

  it('refuses retired September factory/registry/policy', () => {
    const addrs = cutoverAddrs();
    addrs.factory = RETIRED_SEPOLIA_PINS.navePirataFactory;
    assert.throws(
      () =>
        mapSepoliaCutover({
          artifacts: artifactsFrom(addrs),
          currentBook: liveBook,
          sourceLabel: 'fixture',
        }),
      /retired pin/,
    );
  });

  it('refuses retired Oct 2026 archive factory', () => {
    const addrs = cutoverAddrs();
    addrs.factory = RETIRED_OCT_2026_SEPOLIA.navePirataFactory;
    assert.throws(
      () =>
        mapSepoliaCutover({
          artifacts: artifactsFrom(addrs),
          currentBook: liveBook,
          sourceLabel: 'fixture',
        }),
      /retired navePirataFactory pin/,
    );
  });

  it('refuses a no-op cutover that rewrites the current book pins', () => {
    const addrs = cutoverAddrs();
    const alreadyCutOver = applySepoliaCutover(
      liveBook,
      mapSepoliaCutover({
        artifacts: artifactsFrom(addrs),
        currentBook: liveBook,
        sourceLabel: 'fixture',
      }),
    );
    assert.throws(
      () =>
        mapSepoliaCutover({
          artifacts: artifactsFrom(addrs),
          currentBook: alreadyCutOver,
          sourceLabel: 'fixture',
        }),
      /no-op cutover/,
    );
  });

  it('refuses a 7702 pin that does not match the current book', () => {
    const addrs = cutoverAddrs();
    addrs.account7702 = A(0x77);
    assert.throws(
      () =>
        mapSepoliaCutover({
          artifacts: artifactsFrom(addrs),
          currentBook: liveBook,
          sourceLabel: 'fixture',
        }),
      /EIP-7702 implementation/,
    );
  });

  it('refuses allowed7702Implementation drift from pactoSimple7702Account', () => {
    const addrs = cutoverAddrs();
    const stack = stackFrom(addrs);
    stack.addresses.allowed7702Implementation = A(0x99);
    assert.throws(
      () =>
        mapSepoliaCutover({
          artifacts: { stack },
          currentBook: liveBook,
          sourceLabel: 'fixture',
        }),
      /allowed7702Implementation must match pactoSimple7702Account/,
    );
  });
});

describe('applySepoliaCutover', () => {
  it('writes $comment and replaces only the sepolia network', () => {
    const addrs = cutoverAddrs();
    const mapped = mapSepoliaCutover({
      artifacts: artifactsFrom(addrs),
      currentBook: liveBook,
      sourceLabel: 'pacto-onchain-orchestrator fixture@1',
    });
    const next = applySepoliaCutover({ ...liveBook, networks: { ...liveBook.networks, mainnet: {} } }, mapped);
    assert.match(next.$comment, /synced from pacto-onchain-orchestrator fixture@1/);
    assert.equal(next.networks.sepolia.pactoGov.navePirataFactory, addrs.factory);
    assert.deepEqual(next.networks.mainnet, {});
    assert.equal(next.version, liveBook.version);
  });
});

describe('formatComment', () => {
  it('includes short pin SHAs', () => {
    const comment = formatComment({
      sourceLabel: 'dir /tmp/st',
      pins: { 'pacto-gov': '9de626fb35791ea057663acd77d57c798ce2cfcb' },
    });
    assert.match(comment, /pacto-gov 9de626fb/);
  });
});

describe('requireAddr / eqAddr', () => {
  it('accepts mixed-case hex and compares case-insensitively', () => {
    assert.equal(requireAddr({ a: '0xAbcDef0000000000000000000000000000000001' }, 'a', 't'), '0xAbcDef0000000000000000000000000000000001');
    assert.equal(eqAddr('0xAA', '0xaa'), true);
    assert.throws(() => requireAddr({}, 'a', 't'), /t.a/);
  });
});

describe('loadArtifactsFromDir + run', () => {
  it('loads stack.json and dry-runs a mapped book without writing the live file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacto-sync-addr-'));
    const outBook = join(dir, 'book.json');
    const addrs = cutoverAddrs();
    try {
      writeStack(dir, stackFrom(addrs));
      writeFileSync(outBook, JSON.stringify(liveBook, null, 2));
      const loaded = await loadArtifactsFromDir(dir, 11155111);
      assert.equal(loaded.stack.addresses.navePirataFactory, addrs.factory);

      const chunks = [];
      const result = await run(['--from-dir', dir, '--book', outBook, '--dry-run'], {
        stdout: { write: (s) => chunks.push(s) },
      });
      assert.equal(result.dryRun, true);
      assert.equal(JSON.parse(readFileSync(outBook, 'utf8')).networks.sepolia.pactoGov.navePirataFactory, liveBook.networks.sepolia.pactoGov.navePirataFactory);
      const printed = JSON.parse(chunks.join(''));
      assert.equal(printed.networks.sepolia.pactoGov.navePirataFactory, addrs.factory);

      await run(['--from-dir', dir, '--book', outBook], {
        stdout: { write: () => {} },
      });
      const written = JSON.parse(readFileSync(outBook, 'utf8'));
      assert.equal(written.networks.sepolia.squadSponsor.factory, addrs.sponsorFactory);
      assert.equal(
        JSON.parse(readFileSync(join(root, 'src/lib/evm/pacto-protocol-addresses.json'), 'utf8')).networks
          .sepolia.pactoGov.navePirataFactory,
        liveBook.networks.sepolia.pactoGov.navePirataFactory,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads GitHub stack.json through fetchImpl', async () => {
    const addrs = cutoverAddrs();
    const stack = stackFrom(addrs);
    const dir = mkdtempSync(join(tmpdir(), 'pacto-sync-gh-'));
    const outBook = join(dir, 'book.json');
    writeFileSync(outBook, JSON.stringify(liveBook, null, 2));
    try {
      const result = await run(
        ['--from-github', 'covenant-gov/pacto-onchain-orchestrator@abc1234', '--book', outBook, '--dry-run'],
        {
          fetchImpl: async (url) => {
            if (url.endsWith('/deployments/11155111/stack.json')) {
              return { ok: true, json: async () => stack };
            }
            return { ok: false, status: 404 };
          },
          stdout: { write: () => {} },
        },
      );
      assert.equal(result.book.networks.sepolia.pactoGov.navePirataFactory, addrs.factory);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
