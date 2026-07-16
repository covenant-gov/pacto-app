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

After in-app deploy: one **`governance_updated`** card in **`#announcements`** (labeled module links, hat tree id → Hats explorer, deploy tx); **Governance** mode with **role sub-modes** (Proposals → Crew → Captain) — read-only proposal/mutiny status on Proposals (green **Execute** when ready); Crew/Captain write CTAs grouped by contract box (Treasury Authority / Mutiny / Quartermaster); ACL snapshot (`get_squad_capabilities`) disables CTAs with reasons; Rust `require_capability` preflights the same checks before signing. **Roles** mode owns the Hats tree. **Treasury** mode surfaces the Pacto Gov governance treasury Safe (balances + tracked tokens) above **Other vaults**. Receipt parse accepts **`NavePirataRegistered`** at the registry when the factory log is absent.

Key paths: `src/routes/+page.svelte` (`finalizePactoGovDeploy`), `src-tauri/src/evm/nave_pirata_deploy.rs`, `src-tauri/src/evm/access_control/`, `src/lib/governance/pacto-gov-payload.ts`, `src/lib/governance/governance-provider.ts`, `src/lib/governance/governance-privilege.ts`, `src/components/parent/governance/PactoGovGovernanceShell.svelte`, `src/components/parent/governance/GovProposalsBoard.svelte`, `src/components/parent/governance/GovCrewActions.svelte`, `src/components/parent/governance/GovCaptainActions.svelte`, `src/components/parent/dashboard/DashboardTreasuryTab.svelte`, `src/components/announcements/PactoGovDeployedAnnounceBody.svelte`, `src/components/parent/dashboard/DashboardRolesTreeTab.svelte`, `src/lib/governance/hats-tree-annotations.ts`.

Normative ACL (identity, capability table, fail-closed rules): [`docs/governance/ACCESS_CONTROL.md`](../governance/ACCESS_CONTROL.md).

## Governance providers

`resolveGovernanceProvider` (`src/lib/governance/governance-provider.ts`) selects the Squad Dashboard → Governance experience:

| Provider | When | UI |
|----------|------|-----|
| `pacto_gov` | `infraType === 'pacto_gov'` with Treasury Authority in payload | Role sub-modes (Proposals / Crew / Captain) + typed Tauri writes |
| `abi_modules` | Reserved: `provider_payload.custom_module.abiRef` (see `resolveAbiRefFromInfraPayload`) | Not implemented — stub empty copy only |
| `none` | No usable governance row | Deploy empty state |

Other governance systems should enter through `abi_modules` (dynamic ABI forms + allowlisted sends), not by forking the Pacto Gov panel tree.

## Treasury Safe balances

**Treasury** mode → **Squad governance treasury (Pacto Gov Safe)** shows native coin balance for the deployed Safe and a squad-tracked ERC-20 list (paste contract address → `symbol`/`decimals` on-chain → SQLite + MLS `squad_tracked_tokens_updated` so peers see the same list). Reads only; add/remove requires Captain or Crew via ACL (`mutateTrackedTokens`) and MLS-admin announce for cross-device sync (same pattern as contract allowlist). Standalone deploy/import Safes appear under **Other vaults**. Do not drop `squad_tracked_tokens` on rollback while upgraded clients run.

## Related

- Access control (roster + Hats / Squad Admin): [ACCESS_CONTROL.md](../governance/ACCESS_CONTROL.md)
- Squad sponsor contracts: [github.com/covenant-gov/pacto-squad-sponsor](https://github.com/covenant-gov/pacto-squad-sponsor) (same pattern — external repo, env addresses, in-app bindings).
- Virtual channel routing for deploy announces: [VIRTUAL_CHANNEL_ROUTING_ADR.md](../mls/VIRTUAL_CHANNEL_ROUTING_ADR.md).
