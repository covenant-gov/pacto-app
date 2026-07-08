# pacto-squad-sponsor (external contract repo)

Squad-scoped **ERC-4337** gas sponsorship (paymaster + per-squad clone factory). Sources live upstream only — **not** vendored in this app repo.

**Canonical source:** [github.com/covenant-gov/pacto-squad-sponsor](https://github.com/covenant-gov/pacto-squad-sponsor) (`dev` branch during active development).

## How Pacto uses it

| Concern | Where in Pacto |
|---------|----------------|
| Alloy bindings | `src-tauri/src/evm/contracts/pacto_sponsor/mod.rs` |
| Deploy + read | `src-tauri/src/evm/squad_sponsor_deploy.rs`, `squad_sponsor_deposit.rs`, `squad_sponsor_read.rs` |
| Deployed factory / paymaster | [`src/lib/evm/pacto-protocol-addresses.json`](../../src/lib/evm/pacto-protocol-addresses.json) — see [`PROTOCOL_ADDRESS_BOOK.md`](./PROTOCOL_ADDRESS_BOOK.md) |
| Persistence | `squad_infra` SQLite rows (`infra_type: sponsor`) via `list_squad_infra` / `upsert_squad_infra` |

**On-chain squad key:** `squadId = keccak256(utf8(parent_id))` where `parent_id` is the squad or network root id in the app.

**First-ship path:** `ISquadSponsorFactory.createSquadSponsorExt(squadId)` (address-list Ext clone; no hat tree required yet).

## Manual smoke (Sepolia)

See **[OPERATOR_SMOKE.md](./OPERATOR_SMOKE.md)** — **Squad sponsor**.

## Related

- Nave Pirata / governance stack: [PACTO_GOV.md](./PACTO_GOV.md)
