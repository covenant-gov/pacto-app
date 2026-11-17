# Username NFT (global / bootstrap sponsor)

Desktop claim + address-rotation backend for [covenant-gov/pacto-username-nft](https://github.com/covenant-gov/pacto-username-nft). Normative upstream: `docs/DESKTOP_CLIENT_INTEGRATION.md` in that repo.

## Gas path (username only)

Order: **bootstrap → EOA → global member → fail**. No squad sponsor arm on this path.

| Path | When | Paymaster |
|------|------|-----------|
| Bootstrap | First `claim()` (`npubOf == 0`) and bootstrap pool funded | `PactoGlobalPaymaster`, payload `policy = 0` |
| EOA | Roster/primary EVM has ETH for gas (no mint fee) | none |
| Global member | Post-mint; `eligibleMember` + global pool | same paymaster, `policy = 0` only |

Member path rejects `claim()`; bootstrap rejects writes after mint.

## Global topHat sponsorship (gov writes + factory deploys)

Separate from the **username claim** path above. Applies when the roster EOA is an **`eligibleMember`** on the Username NFT and the action is a **parent-scoped** pacto-gov module write or a **factory deploy** (`deployNavePirata`, squad sponsor create, squad admin, war-game sponsor, Safe proxy).

| Tier | When | Paymaster |
|------|------|-----------|
| Squad pool | This `parent_id` has sponsor infra + roster `isEligible` on **this parent's** clone + pool headroom | `PactoSponsorPaymaster` (squad UserOp) |
| Global topHat | No squad path for **this parent**; factory/gov module registered on `SponsorPolicyRegistry`; global pool headroom | `PactoGlobalPaymaster` (`funded_by: global_sponsored`) |
| EOA | Roster (or deploy payer) has ETH for gas; `msg.value` on factory calls still requires signer ETH | none |
| Fail | Eligible but no pool and no EOA | `SPONSOR_PATH_UNAVAILABLE` |

**Parent scoping:** squad pools are per-parent. Guest eligibility on squad A's sponsor clone does **not** bill squad A when the user deploys or writes in squad B — B with no sponsor routes to **global** (if eligible), not A's pool.

**Policy surface:** username actions use selector allowlists (`policy = 0` on the global paymaster). Gov-module writes use `moduleToTopHat` + `isTopHatSponsored`; Squad Admin writes (`createRole`, `enableExecutor`, `disableExecutor`, `enableFullPermission`) use this lane, so the proxy must be indexed under a sponsored topHat. Factory deploys use `isContractAllowed(factory)` (catalog: `PACTO_FACTORY_ACTIONS`).

Zero-ETH onboarding smoke: [OPERATOR_SMOKE.md §11](./OPERATOR_SMOKE.md#11-zero-eth-username-onboarding-global-tophat). Squad pool precedence after deploy: [PACTO_SQUAD_SPONSOR.md](./PACTO_SQUAD_SPONSOR.md). UserOp transport: [SPONSORED_USEROP_7702.md](./SPONSORED_USEROP_7702.md).

**Spend ledger:** successful global UserOps write to `global_sponsored_fee_usage` (`list_global_sponsored_fee_usage`, account-scoped). Squad pool spend stays in `squad_sponsored_fee_usage` — see [PACTO_SQUAD_SPONSOR.md](./PACTO_SQUAD_SPONSOR.md#sponsored-fee-ledger). Member-facing list: Profile → **Sponsored gas** disclosure — not an operator pool view; see [SETTINGS_LAYOUT.md](./SETTINGS_LAYOUT.md). The Profile NFT strip shows the Username NFT from the tracked catalog (`pacto-protocol-addresses.json`); it does not crawl `tokenURI`.

## Dual attestation (claim)

Shared binding tuple: `(pubkey, npubHash, evmAddress, name, nonce, issuedAt, salt)`.

1. Generate random `salt` (32 bytes); `nonce = usedNonce(npubHash) + 1`.
2. **`issuedAt` = latest block timestamp** (not wall clock) so `BindingExpired` (±5m / 7d) cannot trip on a skewed laptop clock.
3. Compute Nostr digest — must match `NostrClaimLink.hashNostrClaim(...)`.
4. Publish Nostr link event (kind `31337`).
5. Client parity: on-chain `hashClaimBinding` must equal local EIP-712 digest before signing.
6. BIP-340 over Nostr digest (verify locally) + EIP-712 ClaimBinding v2 → UserOp / EOA `claim(...)`.

Golden digests: `src/lib/evm/sponsor/claim-link.golden.json`.

Sponsored UserOp transport: [SPONSORED_USEROP_7702.md](./SPONSORED_USEROP_7702.md).

## Kind 31337 tags

Content = username. Tags (relay/UX only; chain does not parse them):

| Tag | Value |
|-----|--------|
| `name` | username |
| `evm` | checksum address |
| `npub-hash` | `0x` + npubHash |
| `nonce` | decimal |
| `issued-at` | unix seconds |
| `salt` | `0x` + salt |
| `d` | same as npub-hash (addressable) |

## Tauri commands

Typed wrappers: `src/lib/api/username.ts`.

Reads: `username_name_available`, `username_can_bootstrap_claim`, `username_npub_of`, `username_record_of`, `username_record_for_npub`, `username_eligible_member`, `username_is_pending_transfer`, `username_*_spendable_pool_wei`, `username_used_nonce`, `username_get_cached_claim`, `username_sync_account_state` (one provider: cache row, `recordOf`, `isPendingTransfer`, and `policyVersion` only when the claim row is missing or drifted).

Writes: `username_claim`, `username_initiate_address_transfer`, `username_claim_address_transfer`, `username_cancel_address_transfer`.

SQLite cache: `username_claims` (username, npubHash, tokenId, link event id, policyVersion).

## Username vs display name

- **Claimed username** (on-chain NFT): any non-empty string up to **64 UTF-8 bytes** client-side (chain: unique + not reserved; NIP-01 style — no charset). Trim only; **do not** force lowercase (names are case-sensitive on-chain). The name is immutable after claim.
- **After a successful claim,** the client publishes kind 0 with both `name` and `display_name` set to that chain username. Profile edit can still change avatar and bio. It cannot write a different name while this account holds the NFT.
- **One name in the UI.** No claim: nickname, then kind 0 `name`, then `display_name`, with no check. A minted chain record (non-empty name, non-zero token) is the name, with a check, for this account and for everyone else. The active roster signer is not part of that check. A missing kind 31337 link does not hide the check.
- **Other people.** `username_record_for_npub` reads `recordOf` for that npub. A minted record replaces nickname and kind 0. The session cache stores confirmed misses. A failed read is not stored, so the next lookup tries again. The signed-in account uses the same minted-record rule on its local username record, not the peer cache. Logout and account switch drop that in-memory record and the peer cache. A record is ignored when its npub is not the signed-in account.
- **Profile.** The identity heading is the only name. The profile stays visible while that chain read is in flight. Edit is disabled until the read is ready or has failed. The name field locks only when a minted record is present. Claim and address rotation live in the username view opened from the Pacto NFTs card. The empty slot is the claim call to action. What the kind 0 name should become after the NFT leaves the account is undecided.
- **Session pubkey for `npubHash`:** `currentUser.pubkey` must be the 32-byte hex x-only key (`LoginKeyPair.pubkey_hex`), not the bech32 npub. Hash is `sha256(0x02 || pubkey)`.

## Link restore

The name check does not use this. Kind 31337 is the sponsorship link. Restore requires **both** a cached kind **31337** `linkEventId` and on-chain `recordOf` with `evmAddress` equal to the active roster EVM. Holder sync fills a missing `linkEventId` from trusted relays that are currently in the pool (kind 31337, `#d` = npub hash) when the author and `evm` / `name` / `npub-hash` tags match `recordOf`. Publish uses the same in-pool set. Failed restore fetches are skipped for 5 minutes (process-local); an explicit refresh on a minted record with a missing link forces a new fetch. Overlapping restores return the live cache row so a skipped UPDATE cannot clobber a restored `linkEventId`. A relay that dropped the event cannot be rebuilt from the chain.

## Profile UX (address rotation)

The profile heading is the only name. Claim, link restore, and address rotation (`initiate` / `claim` / `cancel`) live in the username view opened from the Pacto NFT card (`PactoNftStrip` → `UsernameNftView` → `UsernameAddressRotateModal`), not in wallet Send. The card keeps the bound EVM and a pending-transfer line. See [SETTINGS_LAYOUT.md](./SETTINGS_LAYOUT.md).

## Operator smoke (Sepolia)

Runnable checklist: **[OPERATOR_SMOKE.md §10](./OPERATOR_SMOKE.md#10-username-nft-global--bootstrap-sponsor)** (fund both pools + global paymaster → Commons CTA → bootstrap claim → badge → global member rotation → regressions). Ops funding commands and path-divergence notes live there.

## Related

- [OPERATOR_SMOKE.md](./OPERATOR_SMOKE.md) §10–§11
- [PROTOCOL_ADDRESS_BOOK.md](./PROTOCOL_ADDRESS_BOOK.md)
- [SPONSORED_USEROP_7702.md](./SPONSORED_USEROP_7702.md) — transport spec; fund matrix (GlobalSponsorPool empty is rotation-only)
- [PACTO_SQUAD_SPONSOR.md](./PACTO_SQUAD_SPONSOR.md) — squad paymaster path (not used for username)
- Upstream [DESKTOP_CLIENT_INTEGRATION.md](https://github.com/covenant-gov/pacto-username-nft/blob/main/docs/DESKTOP_CLIENT_INTEGRATION.md)
