import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
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

function artifactsFrom(addrs, { sponsorRegistry, stackFactory } = {}) {
  const registry = addrs.registry;
  const chainId = 11155111;
  return {
    stack: {
      chainId,
      broadcast: true,
      pins: {
        'pacto-aa': 'aaaaaaaa',
        'pacto-gov': 'bbbbbbbb',
        'pacto-username-nft': 'cccccccc',
        'pacto-squad-sponsor': 'dddddddd',
      },
      addresses: {
        pactoSimple7702Account: addrs.account7702,
        allowed7702Implementation: addrs.account7702,
        sponsorPolicyRegistry: addrs.policy,
        protocolRegistry: addrs.protocolRegistry,
        usernameSystemFactory: addrs.usernameFactory,
        pactoUsernameNft: addrs.usernameNft,
        pactoGlobalPaymaster: addrs.globalPaymaster,
        navePirataFactory: stackFactory ?? addrs.factory,
        navePirataRegistry: registry,
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
      },
    },
    govInfra: {
      chainId,
      deployer: addrs.deployer,
      navePirataFactory: addrs.factory,
      navePirataRegistry: registry,
      roleHatClonesFactory: addrs.roleHatFactory,
      roleHatUpgrader: addrs.roleHatUpgrader,
      sponsorPolicyRegistry: addrs.policy,
      warGameRegistry: addrs.warGame,
    },
    govFull: {
      chainId,
      deployer: addrs.deployer,
      hats: addrs.hats,
      masterMutinyModule: addrs.mutiny,
      masterQuartermaster: addrs.qm,
      masterSquadAdminExtImpl: addrs.squadAdminExt,
      masterSquadAdminImpl: addrs.squadAdmin,
      masterTreasuryAuthority: addrs.treasury,
      navePirataFactory: addrs.factory,
      navePirataRegistry: registry,
      roleHatClonesFactory: addrs.roleHatFactory,
      roleHatUpgrader: addrs.roleHatUpgrader,
      safeProxyFactory: addrs.safeFactory,
      safeSingleton: addrs.safeSingleton,
      sponsorPolicyRegistry: addrs.policy,
      warGameRegistry: addrs.warGame,
    },
    govExternal: {
      chainId,
      hats: addrs.hats,
      safeProxyFactory: addrs.safeFactory,
      safeSingleton: addrs.safeSingleton,
    },
    username: {
      allowed7702Implementation: addrs.account7702,
      bootstrapClaimPolicy: addrs.bootstrapPolicy,
      bootstrapMintPool: addrs.bootstrapPool,
      chainId,
      deployer: addrs.deployer,
      entryPoint: addrs.entryPoint,
      globalSponsorPool: addrs.globalPool,
      nostrClaimLink: addrs.nostrClaim,
      pactoGlobalPaymaster: addrs.globalPaymaster,
      pactoUsernameNft: addrs.usernameNft,
      protocolRegistry: addrs.protocolRegistry,
      sponsorPolicyRegistry: addrs.policy,
      usernameSystemFactory: addrs.usernameFactory,
    },
    sponsor: {
      chainId,
      deployer: addrs.deployer,
      entryPoint: addrs.entryPoint,
      navePirataRegistry: sponsorRegistry ?? registry,
      pactoSponsorPaymaster: addrs.sponsorPaymaster,
      squadSponsorFactory: addrs.sponsorFactory,
    },
  };
}

function writeTree(dir, artifacts) {
  const files = {
    'deployments/11155111/stack.json': artifacts.stack,
    'deployments/pacto-gov/11155111/infra.json': artifacts.govInfra,
    'deployments/pacto-gov/11155111/full-system.json': artifacts.govFull,
    'deployments/pacto-gov/11155111/external.json': artifacts.govExternal,
    'deployments/pacto-username-nft/11155111/full-system.json': artifacts.username,
    'deployments/pacto-squad-sponsor/11155111/full-system.json': artifacts.sponsor,
  };
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(body, null, 2));
  }
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
    const gh = parseArgs(['--from-github=covenant-gov/pacto-gov-system-tests@abc1234']);
    assert.equal(gh.fromGithub, 'covenant-gov/pacto-gov-system-tests@abc1234');
  });
});

describe('parseGithubRef', () => {
  it('splits owner/repo@ref', () => {
    assert.deepEqual(parseGithubRef('covenant-gov/pacto-gov-system-tests@deadbeef'), {
      owner: 'covenant-gov',
      repo: 'pacto-gov-system-tests',
      ref: 'deadbeef',
    });
  });
});

describe('mapSepoliaCutover', () => {
  it('maps system-tests artifacts onto the book shape and keeps Safe fallback + 7702', () => {
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
      /retired September pin/,
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

  it('refuses sponsor registry drift from the gov registry', () => {
    const addrs = cutoverAddrs();
    assert.throws(
      () =>
        mapSepoliaCutover({
          artifacts: artifactsFrom(addrs, { sponsorRegistry: A(0x99) }),
          currentBook: liveBook,
          sourceLabel: 'fixture',
        }),
      /gov registry must match sponsor/,
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

  it('refuses stack.json that disagrees with gov infra', () => {
    const addrs = cutoverAddrs();
    assert.throws(
      () =>
        mapSepoliaCutover({
          artifacts: artifactsFrom(addrs, { stackFactory: A(0x88) }),
          currentBook: liveBook,
          sourceLabel: 'fixture',
        }),
      /stack.addresses.navePirataFactory mismatch/,
    );
  });
});

describe('applySepoliaCutover', () => {
  it('writes $comment and replaces only the sepolia network', () => {
    const addrs = cutoverAddrs();
    const mapped = mapSepoliaCutover({
      artifacts: artifactsFrom(addrs),
      currentBook: liveBook,
      sourceLabel: 'pacto-gov-system-tests fixture@1',
    });
    const next = applySepoliaCutover({ ...liveBook, networks: { ...liveBook.networks, mainnet: {} } }, mapped);
    assert.match(next.$comment, /synced from pacto-gov-system-tests fixture@1/);
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
  it('loads the system-tests tree and dry-runs a mapped book without writing the live file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacto-sync-addr-'));
    const outBook = join(dir, 'book.json');
    const addrs = cutoverAddrs();
    try {
      writeTree(dir, artifactsFrom(addrs));
      writeFileSync(outBook, JSON.stringify(liveBook, null, 2));
      const loaded = await loadArtifactsFromDir(dir, 11155111);
      assert.equal(loaded.govInfra.navePirataFactory, addrs.factory);

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

  it('loads GitHub artifacts through fetchImpl', async () => {
    const addrs = cutoverAddrs();
    const artifacts = artifactsFrom(addrs);
    const byPath = {
      'deployments/11155111/stack.json': artifacts.stack,
      'deployments/pacto-gov/11155111/infra.json': artifacts.govInfra,
      'deployments/pacto-gov/11155111/full-system.json': artifacts.govFull,
      'deployments/pacto-gov/11155111/external.json': artifacts.govExternal,
      'deployments/pacto-username-nft/11155111/full-system.json': artifacts.username,
      'deployments/pacto-squad-sponsor/11155111/full-system.json': artifacts.sponsor,
    };
    const dir = mkdtempSync(join(tmpdir(), 'pacto-sync-gh-'));
    const outBook = join(dir, 'book.json');
    writeFileSync(outBook, JSON.stringify(liveBook, null, 2));
    try {
      const result = await run(
        ['--from-github', 'covenant-gov/pacto-gov-system-tests@abc1234', '--book', outBook, '--dry-run'],
        {
          fetchImpl: async (url) => {
            const path = url.replace('https://raw.githubusercontent.com/covenant-gov/pacto-gov-system-tests/abc1234/', '');
            const body = byPath[path];
            if (!body) return { ok: false, status: 404 };
            return { ok: true, json: async () => body };
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
