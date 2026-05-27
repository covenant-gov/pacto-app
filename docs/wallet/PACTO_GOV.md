# pacto-gov (external contract repo)

Governance contract sources for **Nave Pirata** live in the upstream repository only — **not** vendored in this app repo.

**Canonical source:** [github.com/covenant-gov/pacto-gov](https://github.com/covenant-gov/pacto-gov) (`dev` branch during active development).

## How Pacto uses it

| Concern | Where in Pacto |
|---------|----------------|
| Alloy bindings (deploy surface) | `src-tauri/src/evm/contracts/pacto_gov/mod.rs` — hand-maintained `sol!` aligned with upstream interfaces |
| Deployed factory / master copies | [`src/lib/evm/pacto-protocol-addresses.json`](../../src/lib/evm/pacto-protocol-addresses.json) (compile-time in Rust); optional `PACTO_*` env override — see [`PROTOCOL_ADDRESS_BOOK.md`](./PROTOCOL_ADDRESS_BOOK.md) |
| Audit trail on deploy | Optional `pacto_gov_revision` on governance rows / announces — **upstream git commit SHA**, not a local submodule pin |

When upstream interfaces change, update bindings in `evm/contracts/pacto_gov/` against the reviewed commit on GitHub (Foundry `out/` JSON generation is optional follow-on).

## Manual smoke (Sepolia)

Operator checklist: [OPERATOR_SMOKE.md](./OPERATOR_SMOKE.md) §2 (Pacto Gov) and §4 (announce sync); requires squad sponsor first (§1).

## Related

- Squad sponsor contracts: [github.com/covenant-gov/pacto-squad-sponsor](https://github.com/covenant-gov/pacto-squad-sponsor) (same pattern — external repo, env addresses, in-app bindings).
- Planning: [`ai-docs/INHOUSE_GOV.md`](../../ai-docs/INHOUSE_GOV.md), [`ai-docs/gov-core/`](../../ai-docs/gov-core/).
