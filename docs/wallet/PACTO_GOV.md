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

Operator checklist: [OPERATOR_SMOKE.md](./OPERATOR_SMOKE.md) — **Pacto Gov / Nave Pirata** and **Governance announce sync**; deploy squad sponsor first.

## Post-deploy UX (shipped)

After in-app deploy: one **`governance_updated`** card in **`#announcements`** (labeled module links, top hat → Hats explorer, deploy tx); **Governance** tab infra panel; **Roles Tree** with Nave Pirata role badges, wearers (profile name when squad EVM shared), refresh, and BFS truncation note. Treasury tab excludes the governance treasury Safe. Receipt parse accepts **`NavePirataRegistered`** at the registry when the factory log is absent.

Key paths: `src/routes/+page.svelte` (`finalizePactoGovDeploy`), `src-tauri/src/evm/nave_pirata_deploy.rs`, `src/lib/governance/pacto-gov-payload.ts`, `src/components/announcements/PactoGovDeployedAnnounceBody.svelte`, `src/components/parent/dashboard/DashboardRolesTreeTab.svelte`, `src/lib/governance/hats-tree-annotations.ts`.

## Related

- Squad sponsor contracts: [github.com/covenant-gov/pacto-squad-sponsor](https://github.com/covenant-gov/pacto-squad-sponsor) (same pattern — external repo, env addresses, in-app bindings).
- Virtual channel routing for deploy announces: [VIRTUAL_CHANNEL_ROUTING_ADR.md](../mls/VIRTUAL_CHANNEL_ROUTING_ADR.md).
