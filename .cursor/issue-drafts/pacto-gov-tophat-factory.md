## Summary

When `INavePirataFactory.deployNavePirata` completes, automatically register the new squad's **`topHatId`** with the username global sponsor policy layer and index all deployed **module addresses** → `topHatId`. This enables gasless governance participation via `PactoGlobalPaymaster` without per-clone policy registry writes.

**Blocked by / pairs with:** covenant-gov/pacto-username-nft#10 (SponsorPolicyRegistry v2 + `authorizedRegistrars`).

## Problem

Global username sponsorship needs a **top-hat-tier** policy: one registration covers Quartermaster, Mutiny, Treasury Authority, Safe, Squad Admin proxy for a deployment. Manual or ops-driven per-address registration does not scale.

## Proposed changes

### `INavePirataFactory.deployNavePirata`

At end of successful deploy (same atomic transaction):

1. Existing: write `NavePirataRegistry.deployment(topHatId)`.
2. **New:** populate module → top hat index for:
   - `safe`, `quartermaster`, `mutinyModule`, `treasuryAuthority`, `squadAdminProxy`
3. **New:** call policy registrar `registerTopHat(topHatId)` (or `registerModulesForTopHat`) — only if caller is authorized factory in username-nft policy contract.

### `INavePirataRegistry` (optional but recommended)

- `moduleToTopHat(address module) → uint256 topHatId` view
- Written once at deploy; paymaster reads this instead of scanning all deployments

### War-game parity

- Same hook on war-game deploy path / `WarGameRegistry` (`active(squadId)` stacks use same top-hat sponsorship model)

## Interfaces

Policy registrar address wired at factory deploy (from username-nft `full-system.json`). Factory holds no `Ownable` on the policy registry.

## Acceptance criteria

- [ ] Foundry: `deployNavePirata` emits / stores top hat + module index
- [ ] `registerTopHat(topHatId)` called from factory when policy registrar configured
- [ ] Unauthorized contract cannot register top hats
- [ ] War-game deploy path parity test
- [ ] Deployment artifact documents registrar + factory addresses for pacto-app pin

## Out of scope

- Paymaster validation logic (pacto-username-nft)
- Client sponsorship router (pacto-app)

## Related

- covenant-gov/pacto-username-nft#10
