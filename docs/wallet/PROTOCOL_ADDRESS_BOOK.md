# Protocol address book

Covenant / Pacto **deploy infra** (factories, paymaster, Safe bundle, Hats masters) lives in one tracked JSON file — not in `.env`.

## Source file

**[`src/lib/evm/pacto-protocol-addresses.json`](../../src/lib/evm/pacto-protocol-addresses.json)**

| Section | Used by |
|---------|---------|
| `squadSponsor` | Squad sponsor deploy, deposit, summary reads |
| `pactoGov` | Nave Pirata deploy, Hats reads, squad admin deploy |
| `safe` | Standalone Safe deploy (pacto-gov 1.4.x bundle on Sepolia) |
| `meta.deployer` | Reference only (upstream deployer; not a runtime signer) |

**Sepolia** (`chainId` 11155111) is populated from the covenant-gov deploy bundle.

## Rust (Alloy UX)

**`src-tauri/src/evm/pacto_chain_config.rs`** embeds the same JSON at compile time (`include_str!`). All curated deploy/read commands resolve addresses through:

- `pacto_gov_deploy_addresses(net_key)`
- `squad_sponsor_deploy_addresses(net_key)`
- `safe_factory_addresses(net_key, chain_id)`

Resolution order for each field: **`PACTO_*` env override** (optional) → **JSON book** → error (required fields) or safe-global defaults (Safe only).

## TypeScript

**`src/lib/evm/pacto-protocol-addresses.ts`** imports the JSON for UI / viem helpers. Prefer this over duplicating hex in components.

## RPC stays in env

JSON-RPC URLs are **not** in the address book. Set **`ALCHEMY_RPC_KEY`** in `.env` — see [CHAIN_CONFIG.md](./CHAIN_CONFIG.md).

## Adding a network

1. Add a `networks.<key>` block to `pacto-protocol-addresses.json` (match `wallet-assets.json` keys: `mainnet`, `arbitrum`, `sepolia`, `local`).
2. Run `cargo test pacto_chain_config` and `npm test -- pacto-protocol-addresses`.
3. Document the upstream deploy revision in the JSON `$comment` or commit message.

## Related

- [PACTO_GOV.md](./PACTO_GOV.md) — upstream repo
- [PACTO_SQUAD_SPONSOR.md](./PACTO_SQUAD_SPONSOR.md) — sponsor repo
- [OPERATOR_SMOKE.md](./OPERATOR_SMOKE.md) — manual deploy checklists (RPC + `.env` for keys only)
