# pacto-squad-sponsor (external contract repo)

Squad-scoped **ERC-4337** gas sponsorship (paymaster + per-squad clone factory). Sources live upstream only — **not** vendored as a full contract tree in this app repo.

**Canonical source:** [github.com/covenant-gov/pacto-squad-sponsor](https://github.com/covenant-gov/pacto-squad-sponsor) (`dev` branch during active development). Desktop client guide: upstream `docs/DESKTOP_CLIENT_INTEGRATION.md`.

## How Pacto uses it

| Concern | Where in Pacto |
|---------|----------------|
| Alloy bindings | `src-tauri/src/evm/contracts/pacto_sponsor/mod.rs` |
| Deploy + read | `squad_sponsor_deploy.rs` (Ext + hats), `squad_sponsor_deposit.rs`, `squad_sponsor_read.rs`, `squad_sponsor_ext.rs` |
| AuthZ helpers | `squad_sponsor_common.rs` (parent membership, duplicate preflight, signer wallet parse) |
| Sponsored gov writes | `sponsor_paymaster.rs`, `sponsor_userop.rs`, hooked from `gov_module_write.rs` |
| `paymasterAndData` encoder + vectors | `src/lib/evm/sponsor/` (vendored from upstream client fixtures) |
| Deployed factory / paymaster | [`pacto-protocol-addresses.json`](../../src/lib/evm/pacto-protocol-addresses.json) — see [`PROTOCOL_ADDRESS_BOOK.md`](./PROTOCOL_ADDRESS_BOOK.md) |
| Persistence | `squad_infra` SQLite rows (`infra_type: sponsor`) via `list_squad_infra` / `upsert_squad_infra` |

**On-chain squad key:** `squadId = keccak256(utf8(parent_id))` where `parent_id` is the squad or network root id in the app.

**Default path:** Launchpad **Deploy Pacto Gov + squad sponsor** — Nave Pirata first, then `createSquadSponsor(squadId, topHatId, registry, [])` so eligibility is captain/crew hat wearers. Optional `bootstrapCrew` in the same wizard. If gov already exists and sponsor is missing, the same wizard finishes hats sponsor only.

**Advanced Ext:** Launchpad / Advanced **Deploy squad sponsor (Ext)** — `createSquadSponsorExt(squadId, addressOwner)` with `addressOwner` = roster EVM; gas/deposit may come from Default.

## Sponsored UserOps (gov writes)

When the roster EOA has no ETH, gov module writes build an EntryPoint v0.7 UserOp, EIP-7702 set-code (if code empty), and `paymasterAndData` for `PactoSponsorPaymaster`. Self-funded EOA path remains when the roster key has balance.

### Operator env

| Variable | Role |
|----------|------|
| `BUNDLER_RPC_URL` | JSON-RPC that accepts `eth_sendUserOperation` for EntryPoint v0.7 |
| `PACTO_ERC4337_ACCOUNT_IMPL` | Optional override of the EIP-7702 account implementation |

**Bundler (Sepolia):** use the same Alchemy app as `ALCHEMY_RPC_KEY`:

```bash
BUNDLER_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<ALCHEMY_RPC_KEY>
```

Confirm `eth_supportedEntryPoints` includes `0x0000000071727De22E5E9d8BAf0edAc6f37da032`. Pacto sponsorship uses **`PactoSponsorPaymaster`** (not Alchemy Gas Manager); the bundler only submits UserOps.

**EIP-7702 account implementation (Sepolia):** pinned in [`pacto-protocol-addresses.json`](../../src/lib/evm/pacto-protocol-addresses.json) as `networks.sepolia.erc4337.accountImplementation`:

| Address | Source | Notes |
|---------|--------|--------|
| `0x69007702764179f14F51cdce752f4f775d74E139` | Alchemy [SemiModularAccount7702](https://www.alchemy.com/docs/wallets/smart-contracts/deployed-addresses) (MAv2) | `entryPoint()` = EP v0.7; `execute(address,uint256,bytes)`; shared bytecode for roster EOA set-code (not a per-user deploy) |

Do **not** use eth-infinitism `Simple7702Account` at `0xe6Cae83BdE06E4c305530e199D7217f42808555B` — that impl’s `entryPoint()` is EP **v0.8**, incompatible with the Sepolia paymaster / EntryPoint v0.7 stack.

## Manual smoke (Sepolia)

See **[OPERATOR_SMOKE.md](./OPERATOR_SMOKE.md)** and **[ACCESS_CONTROL.md](../governance/ACCESS_CONTROL.md)**.

## Related

- Nave Pirata / governance stack: [PACTO_GOV.md](./PACTO_GOV.md)
