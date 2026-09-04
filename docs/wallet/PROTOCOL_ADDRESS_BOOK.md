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

`globalUsernameSponsor` pins Sepolia from pacto-username-nft `deployments/11155111/full-system.json` (includes `protocolRegistry`, `nostrClaimLink`, `policyVersion`, bootstrap pool/policy, global pool/paymaster). Rust accessor: `global_username_sponsor_addresses(net_key)`. Claim/rotation backend: [USERNAME_NFT.md](./USERNAME_NFT.md). Ops fund + Sepolia smoke: [OPERATOR_SMOKE.md](./OPERATOR_SMOKE.md) §10.

### Cutover after username-nft redeploy

1. In pacto-username-nft: `pnpm deploy:sepolia` → new `deployments/11155111/full-system.json` (then `fund:paymaster:sepolia` + bootstrap pool deposit).
2. Copy into pacto-app `src/lib/evm/pacto-protocol-addresses.json` → `networks.sepolia.globalUsernameSponsor` (all fields including `protocolRegistry`, `policyVersion`, `allowed7702Implementation`, `entryPoint`).
3. Update the JSON `$comment` with the upstream commit / artifact note.
4. Full Tauri restart (compile-time embed).
5. **Hard gate:** [SPONSORED_USEROP_7702.md](./SPONSORED_USEROP_7702.md) harness must mint before calling redeploy / APP-1 done — [pacto-app#377](https://github.com/covenant-gov/pacto-app/issues/377) (epic [pacto-aa#1](https://github.com/covenant-gov/pacto-aa/issues/1)).

`erc4337.accountImplementation` / `PACTO_ERC4337_ACCOUNT_IMPL` is the shared EIP-7702 account bytecode the roster EOA set-codes to for paymaster-sponsored UserOps (must match EntryPoint v0.7 and the registry-backed paymaster allowlist). Sepolia pins Pacto `PactoSimple7702Account` from [pacto-aa](https://github.com/covenant-gov/pacto-aa) `deployments/11155111/eip7702-account.json` (`0x2E9156de…`). Details: [PACTO_SQUAD_SPONSOR.md](./PACTO_SQUAD_SPONSOR.md).

**Sepolia** (`chainId` 11155111) `squadSponsor` comes from pacto-squad-sponsor `deployments/11155111/full-system.json` (SS-3). `erc4337` comes from pacto-aa `eip7702-account.json`. `globalUsernameSponsor` comes from pacto-username-nft `deployments/11155111/full-system.json`.

## Rust (Alloy UX)

**`src-tauri/src/evm/pacto_chain_config.rs`** embeds the same JSON at compile time (`include_str!`). All curated deploy/read commands resolve addresses through:

- `pacto_gov_deploy_addresses(net_key)`
- `squad_sponsor_deploy_addresses(net_key)`
- `global_username_sponsor_addresses(net_key)`
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
- [covenant-gov/pacto-username-nft](https://github.com/covenant-gov/pacto-username-nft) — username NFT + global/bootstrap sponsor
- [OPERATOR_SMOKE.md](./OPERATOR_SMOKE.md) — manual deploy checklists (RPC + `.env` for keys only)
