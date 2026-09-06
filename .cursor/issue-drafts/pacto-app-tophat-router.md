## Summary

After username-nft ships **topHat-tier** global sponsorship, wire pacto-app so **eligible username NFT holders** can deploy all Pacto infrastructure and execute **gov module writes** without ETH, with **squad sponsor pool preferred** over global pool when available.

**Blocked on:** covenant-gov/pacto-username-nft#10 (policy v2) + pacto-gov factory auto-registration pins in `pacto-protocol-addresses.json`.

## Problem (today)

- All factory deploys use EOA `send_and_confirm` → `-32003 insufficient funds` for users with zero/dust balance.
- Gov writes use squad sponsor only when roster balance &lt; gas **and** squad sponsor infra exists; no global fallback.
- Squad deploy **requires** `initialDepositWei > 0` (`parse_required_deposit_wei`); war-game already allows zero.

## Sponsorship router (new)

Extend [`gov_module_write.rs`](src-tauri/src/evm/gov_module_write.rs) `select_write_path` and deploy entry points:

```text
if squad_sponsor_deployed && member_eligible && squad_pool_headroom:
    send_sponsored_gov_userop  # existing squad paymaster
else if eligibleMember && topHat_sponsored && global_pool_headroom:
    send_sponsored_global_gov_userop  # extend global_sponsor_userop
else if eoa_balance >= estimated_gas:
    EOA
else:
    fail (USERNAME_PATH_UNAVAILABLE / SPONSOR_PATH_UNAVAILABLE)
```

For alpha: consider **`eligibleMember` prefers sponsored paths** even with dust balance (today EOA wins when `balance >= required`).

## Deploy commands → global UserOp

Route when `eligibleMember && !eoa_can_pay` (or prefer sponsored for members):

| Module | File |
|--------|------|
| Pacto Gov | `nave_pirata_deploy.rs` |
| Squad sponsor | `squad_sponsor_deploy.rs` |
| Squad admin | `squad_admin_deploy.rs` |
| War-game | `war_game_deploy.rs` |
| Safe | `safe_deploy.rs` |

Shared transport: EIP-7702 + `PactoGlobalPaymaster` (same as username claim).

## Zero-value squad sponsor deploy

- Replace `parse_required_deposit_wei` with optional zero (match `war_game_deploy.rs` `parse_optional_deposit_wei`)
- UI: [`DeployPactoGovAndSponsorModal.svelte`](src/components/parent/governance/DeployPactoGovAndSponsorModal.svelte), [`DeploySquadSponsorExtModal.svelte`](src/components/parent/governance/DeploySquadSponsorExtModal.svelte) — deposit optional, default `0`; fund later via [`SquadSponsorTreasuryPanel.svelte`](src/components/parent/governance/SquadSponsorTreasuryPanel.svelte)

## Policy preflight

- Extend [`pacto_actions.ts`](src/lib/evm/sponsor/pacto_actions.ts) / Rust: factory **targets** + `isTopHatSponsored` / `moduleToTopHat` reads
- Pin new `policyVersion` and addresses in [`pacto-protocol-addresses.json`](src/lib/evm/pacto-protocol-addresses.json)
- Update [`USERNAME_NFT.md`](docs/wallet/USERNAME_NFT.md), [`PACTO_SQUAD_SPONSOR.md`](docs/wallet/PACTO_SQUAD_SPONSOR.md), [`OPERATOR_SMOKE.md`](docs/wallet/OPERATOR_SMOKE.md) §10

## Acceptance criteria

- [ ] Claim username (0 ETH) → deploy gov (0 ETH) → gov write (vote/bootstrap) bills global pool
- [ ] Deploy squad sponsor with **0 deposit**; fund pool later; subsequent write uses **squad** pool
- [ ] User without username NFT unchanged (EOA / squad-only behavior)
- [ ] `pnpm check`, `pnpm test`, Rust tests for router matrix
- [ ] Operator smoke path documented

## Out of scope

- Contract changes (upstream repos)
- Funding global/squad pools (ops)

## Related

- covenant-gov/pacto-username-nft#10
- covenant-gov/pacto-gov#36
