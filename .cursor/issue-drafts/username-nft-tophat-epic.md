## Summary

Username NFT holders should complete **zero-ETH onboarding**: claim → create squad → deploy governance → participate in governance writes, billed from **GlobalSponsorPool** when no squad sponsor exists. Per-contract / per-selector allowlists in `SponsorPolicyRegistry` do not scale (each `deployNavePirata` stack creates Safe, Quartermaster, Mutiny, Treasury Authority, Squad Admin, …).

Add a **third policy tier — `topHatId`** — so one `registerTopHat(topHatId)` (auto-called at factory deploy) sponsors **all module contracts** for that squad tree. Keep **factory target** tier for deploy txs (`INavePirataFactory`, `ISquadSponsorFactory`, Safe factory, username NFT). **Squad sponsor pool** preference over global pool is a **client routing** convention in pacto-app (both paymasters stay independent on-chain).

## Problem (today)

- Global sponsorship covers bootstrap claim + 3 username rotation selectors only (`policyVersion` **3** on Sepolia).
- Factory deploys and gov module writes are unsponsored EOA paths in pacto-app → `-32003 insufficient funds` for alpha users with dust/zero balance.
- Registering every deployed clone in the policy registry is ops-heavy and gas-expensive.

## Proposed policy model (v2)

### Three tiers

| Tier | Use | Examples |
|------|-----|----------|
| **Selector** | Optional narrow writes (can fold into target) | Username rotation selectors |
| **Target** | Protocol **factories** only | See Sepolia pins below |
| **TopHat** | **All gov modules** for one squad tree | One `topHatId` → QM, Mutiny, TA, Safe, SquadAdmin proxy |

### `isSponsorable(target, callData, member, value)` (paymaster)

1. **Bootstrap lane** (unchanged): first `claim()`, `BootstrapMintPool`, `policy = address(0)` in paymaster payload.
2. **Factory / username target lane:** `isContractAllowed(target)` + `eligibleMember(member)` for factory deploy and username NFT writes.
3. **Gov module lane:** resolve `target` → `topHatId` via `moduleToTopHat[target]` (written at deploy), require `isTopHatSponsored(topHatId)` + `eligibleMember(member)`. Module auth (hats) still enforced by the module; paymaster only pays gas.

### Auto-registration (pacto-gov factory hook — tracked separately)

At end of `deployNavePirata` (same atomic tx):

1. Write `NavePirataRegistry.deployment(topHatId)` (existing).
2. Index `moduleToTopHat[module] = topHatId` for each deployed module.
3. Call `registerTopHat(topHatId)` via **authorized registrar** (factory must not own registry `Ownable`).

War-game: same on `WarGameRegistry`. Squad sponsor **clone** deploy uses **factory target** tier only (`createSquadSponsor*` with **`msg.value = 0`**); fund pool later via `deposit()`.

## Contract work (this repo)

### SponsorPolicyRegistry v2 (or `SponsorPolicyRegistrar` + thin registry)

- `registerTopHat(uint256 topHatId)` / `deregisterTopHat`
- `isTopHatSponsored(uint256 topHatId) view`
- `registerTarget(address)` / `isContractAllowed(address)` — replace per-selector ops for username NFT
- `moduleToTopHat(address) → uint256` + `registerModulesForTopHat(topHatId, addresses[])` **or** read module index from `NavePirataRegistry` (paymaster external view)
- `authorizedRegistrars` — `INavePirataFactory` (+ war-game factory path) only
- Bump **`policyVersion`** (expect **4**); migrate: deregister legacy selector rows; register factory targets at deploy time

### PactoGlobalPaymaster

- Bill **GlobalSponsorPool** for factory deploy + gov-module writes passing top-hat policy
- Derive `topHatId` from `moduleToTopHat[to]` (prefer over encoding in client payload)
- Reuse EIP-7702 + EntryPoint v0.7 transport (shared with pacto-app username path)
- Gas-only sponsorship: optional `msg.value > 0` on factory calls still requires signer ETH for the value leg

### Sepolia factory targets to `registerTarget` at ops/deploy (not per-squad clones)

| Contract | Sepolia address |
|----------|-----------------|
| `pactoUsernameNft` | `0x09e08dB9B4275979Bb2aE8C86f3bB5d406c120d1` |
| `navePirataFactory` | `0xba54955cF9eab7F546c3a1c1fCE2584996626ef0` |
| `squadSponsorFactory` | `0x9F6b1936e1817A074033591bb55DC65CBB29e4d7` |
| `safeProxyFactory` | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` |

Existing registry: `0xd479edB2cfE051310553716d8628c92C81cBD0db` (v1 selector-only rows).

## Pool precedence (client — document in DESKTOP_CLIENT_INTEGRATION.md)

```text
if squad_sponsor_deployed && member_eligible && squad_pool_headroom:
    PactoSponsorPaymaster
else if eligibleMember && topHat_sponsored && global_pool_headroom:
    PactoGlobalPaymaster
else if eoa_balance >= gas:
    EOA
else:
    fail
```

Alpha: ops fund global pool; users play without ETH. When global pool is low, squads deploy squad sponsor and fund it; client prefers squad pool automatically.

## Acceptance criteria

- [ ] Foundry: sponsored UserOp `deployNavePirata` as `eligibleMember` → `registerTopHat` + module index in same tx
- [ ] Subsequent `execute(quartermaster, 0, calldata)` sponsored from GlobalSponsorPool for same top hat
- [ ] Non-`eligibleMember` or unsponsored top hat → paymaster rejects
- [ ] `createSquadSponsor*` with `value = 0` sponsored when squad factory target allowed
- [ ] `policyVersion` bumped; `full-system.json` + fund scripts updated
- [ ] `DESKTOP_CLIENT_INTEGRATION.md` documents three tiers, auto top-hat registration, pool precedence, zero-value sponsor deploy

## Security

- Only protocol factories may call `registerTopHat` / module index writes.
- Do not `registerTarget` on user-deployed clones (gov Safe, sponsor clones) — only master factories + top-hat module index from canonical registry deployments.
- `eligibleMember` binds global sponsorship to username roster EVM.
- Global pool griefing: retain `spendablePoolWei` headroom (~115% margin).

## Downstream (separate issues)

- **pacto-gov:** factory auto `registerTopHat` + module index on `deployNavePirata`
- **pacto-app:** sponsorship router, deploy UserOps, zero sponsor deposit UX, address-book pin (blocked on this epic shipping)

## Gas efficiency

| Approach | Per squad | Ops |
|----------|-----------|-----|
| Per-module `registerTarget` | 5+ writes | High |
| **`registerTopHat` once** | O(1) + index in factory tx (sponsored) | Low |
