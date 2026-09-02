# Username NFT (global / bootstrap sponsor)

Desktop claim + address-rotation backend for [covenant-gov/pacto-username-nft](https://github.com/covenant-gov/pacto-username-nft). Normative upstream: `docs/DESKTOP_CLIENT_INTEGRATION.md` in that repo.

## Gas path (username only)

Order: **bootstrap → EOA → global member → fail**. No squad sponsor arm on this path.

| Path | When | Paymaster |
|------|------|-----------|
| Bootstrap | First `claim()` (`npubOf == 0`) and bootstrap pool funded | `PactoGlobalPaymaster`, payload `policy = 0` |
| EOA | Roster/primary EVM has ETH (`msg.value >= mintFee` on claim) | none |
| Global member | Post-mint; `eligibleMember` + global pool | same paymaster, `policy = 0` only |

Member path rejects `claim()`; bootstrap rejects writes after mint.

## Dual attestation (claim)

1. Random `salt`; `nonce = usedNonce(npubHash) + 1`; `issuedAt = now`
2. Publish Nostr kind **31337** (social commit)
3. BIP-340 over `hashNostrClaim(...)` (64 bytes) — not NIP-01 event hash
4. EIP-712 `ClaimBinding` v2 (domain `PactoUsername` / version `2`)
5. UserOp or EOA `claim(...)`

Golden digests: `src/lib/evm/sponsor/claim-link.golden.json`.

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

Reads: `username_name_available`, `username_can_bootstrap_claim`, `username_npub_of`, `username_record_of`, `username_eligible_member`, `username_is_pending_transfer`, `username_*_spendable_pool_wei`, `username_mint_fee`, `username_used_nonce`, `username_get_cached_claim`.

Writes: `username_claim`, `username_initiate_address_transfer`, `username_claim_address_transfer`, `username_cancel_address_transfer`.

SQLite cache: `username_claims` (username, npubHash, tokenId, link event id, policyVersion).

## Verified badge

Requires **both** a cached kind **31337** `linkEventId` and on-chain `recordOf` with `evmAddress` equal to the active roster EVM.

## Operator smoke (Sepolia)

Runnable checklist: **[OPERATOR_SMOKE.md §10](./OPERATOR_SMOKE.md#10-username-nft-global--bootstrap-sponsor)** (fund both pools + global paymaster → Commons CTA → bootstrap claim → badge → global member rotation → regressions). Ops funding commands and path-divergence notes live there.

## Related

- [OPERATOR_SMOKE.md](./OPERATOR_SMOKE.md) §10
- [PROTOCOL_ADDRESS_BOOK.md](./PROTOCOL_ADDRESS_BOOK.md)
- [PACTO_SQUAD_SPONSOR.md](./PACTO_SQUAD_SPONSOR.md) — shared ERC-4337 / 7702 transport
- Upstream [DESKTOP_CLIENT_INTEGRATION.md](https://github.com/covenant-gov/pacto-username-nft/blob/main/docs/DESKTOP_CLIENT_INTEGRATION.md)
