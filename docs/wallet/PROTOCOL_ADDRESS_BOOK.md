# Protocol address book

Covenant / Pacto **deploy infra** (factories, paymaster, Safe bundle, Hats masters) lives in one tracked JSON file — not in `.env`.

## Source file

**[`src/lib/evm/pacto-protocol-addresses.json`](../../src/lib/evm/pacto-protocol-addresses.json)**

| Section | Used by |
|---------|---------|
| `globalUsernameSponsor` | Username NFT claim / rotation; global + bootstrap paymaster path (account-global; not squad) |
| `squadSponsor` | Squad sponsor deploy, deposit, summary reads |
| `pactoGov` | Nave Pirata deploy, Hats reads, squad admin deploy; Sepolia also pins `warGameRegistry` |
| `safe` | Standalone Safe deploy (pacto-gov 1.4.x bundle on Sepolia) |
| `erc4337.accountImplementation` | EIP-7702 set-code target for sponsored gov UserOps (roster EOA); optional `PACTO_ERC4337_ACCOUNT_IMPL` override |
| `meta.deployer` | Reference only (upstream deployer; not a runtime signer) |

Do **not** copy live hex into operator docs, tests, or encoding vectors. Read pins from this JSON (Rust `include_str!`; TS `pacto-protocol-addresses.ts`). After a book write, **fully restart** Tauri.

Rust accessors: `pacto_gov_deploy_addresses`, `squad_sponsor_deploy_addresses`, `global_username_sponsor_addresses`, `safe_factory_addresses`. Claim/rotation: [USERNAME_NFT.md](./USERNAME_NFT.md). Ops smoke: [OPERATOR_SMOKE.md](./OPERATOR_SMOKE.md).

## Updating Sepolia

Canonical artifacts live in [pacto-onchain-orchestrator](https://github.com/covenant-gov/pacto-onchain-orchestrator) (`deployments/11155111/stack.json`: flat `addresses`, `meta.deployer`, package `pins`, and `vars.policyVersion`). Private-repo `--from-github` falls back to `gh api` when raw.githubusercontent.com 404s.

```bash
# from a local checkout
node scripts/sync-protocol-addresses.mjs --from-dir /path/to/pacto-onchain-orchestrator \
  --source-label 'pacto-onchain-orchestrator covenant-gov/pacto-onchain-orchestrator@<sha>'

# or
node scripts/sync-protocol-addresses.mjs --from-github covenant-gov/pacto-onchain-orchestrator@<sha>

# inspect without writing
node scripts/sync-protocol-addresses.mjs --from-dir /path/to/pacto-onchain-orchestrator --dry-run
```

The mapper reads **`deployments/11155111/stack.json` only** and maps flat `addresses` into the book:

| Book field | Source (`stack.json`) |
|------------|------------------------|
| `globalUsernameSponsor.*` | username / global keys in `addresses` |
| `squadSponsor.factory` / `paymaster` / `entryPoint` | `squadSponsorFactory`, `pactoSponsorPaymaster`, `entryPoint` |
| `squadSponsor.navePirataRegistry` | `navePirataRegistry` (gov registry) |
| `pactoGov` factory / registry / warGame / roleHat* | gov keys in `addresses` |
| `pactoGov` master* / `hats` | `masterQuartermaster`, `masterMutinyModule` → `masterMutiny`, etc. |
| `safe.proxyFactory` / `singleton` | `safeProxyFactory`, `safeSingleton` |
| `safe.fallbackHandler` | keep existing book value |
| `erc4337.accountImplementation` | `pactoSimple7702Account` (must match the previous book pin unless pacto-aa is redeployed) |
| `meta.deployer` | `meta.deployer` |
| `$comment` | source ref + `pins` |

It refuses: retired September and Oct 2026 archive pins, a no-op rewrite of the current book, and a 7702 pin that does not match the current book.

Then: `cargo test --lib pacto_chain_config`, `pnpm test -- pacto-protocol-addresses`, full Tauri restart, [OPERATOR_SMOKE.md](./OPERATOR_SMOKE.md). Recreate squad sponsor clones on the new factory (greenfield; no dual-read of old clones). Bindings already match the post-gas-ops ABI.

### Username-nft-only (rare)

Prefer a full system-tests stack. If only username infra moved: copy `networks.sepolia.globalUsernameSponsor` from that repo’s `full-system.json`, keep 7702 / EntryPoint, restart Tauri, then hard-gate [SPONSORED_USEROP_7702.md](./SPONSORED_USEROP_7702.md).

## Retired clones (do not send UserOps)

Superseded Sepolia factories / paymasters — confirm `clone.paymaster()` / `clone.factory()` match the **current** address book before sponsored writes:

- Factories: `0xD8bdc2e5…`, `0xb758DB17…`, September `0xd540B03A…`, SS-3 `0x9F6b1936…`, Oct 2026 archive `0x97d2dbA0…` (nave), `0x28075576…` (squad)
- Registries / policy: September `0xb4e93495…`, `0x1350F096…`, Oct 2026 archive `0xEDe67E7f…` (gov registry), `0xa70590C0…` (policy)
- Paymasters: `0xc7c3Ea95…`, `0x78197483…`, SS-3 `0xD84337C1…`, Oct 2026 archive `0x86480317…` (squad), `0x7F628e9F…` (global)

## Rust (Alloy UX)

**`src-tauri/src/evm/pacto_chain_config.rs`** embeds the same JSON at compile time. Resolution order for each field: **`PACTO_*` env override** (optional) → **JSON book** → error (required fields) or safe-global defaults (Safe only).

## TypeScript

**`src/lib/evm/pacto-protocol-addresses.ts`** imports the JSON for UI / viem helpers. Prefer this over duplicating hex in components.

## RPC stays in env

JSON-RPC URLs are **not** in the address book. Set **`ALCHEMY_RPC_KEY`** in `.env` — see [CHAIN_CONFIG.md](./CHAIN_CONFIG.md).

## Adding a network

1. Add a `networks.<key>` block to `pacto-protocol-addresses.json` (match `wallet-assets.json` keys: `mainnet`, `arbitrum`, `sepolia`, `local`). Sepolia cutovers use the sync script above, not a hand edit.
2. Run `cargo test --lib pacto_chain_config` and `pnpm test -- pacto-protocol-addresses`.
3. Document the upstream deploy revision in the JSON `$comment` or commit message.

## Related

- [PACTO_GOV.md](./PACTO_GOV.md) — upstream repo
- [PACTO_SQUAD_SPONSOR.md](./PACTO_SQUAD_SPONSOR.md) — sponsor repo
- [covenant-gov/pacto-username-nft](https://github.com/covenant-gov/pacto-username-nft) — username NFT + global/bootstrap sponsor
- [OPERATOR_SMOKE.md](./OPERATOR_SMOKE.md) — manual deploy checklists (RPC + `.env` for keys only)
- [`scripts/sync-protocol-addresses.mjs`](../../scripts/sync-protocol-addresses.mjs) — Sepolia mapper
