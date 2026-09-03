---
title: Sponsored UserOp / EIP-7702 debug method (L0–L4) and username claim Layer-1 staging
date: 2026-09-03
category: docs/solutions/wallet
module: sponsored-userop-7702
problem_type: debugging_method
component: wallet_evm
symptoms:
  - "Username claim toast GOV_CALL_REVERTED / USERNAME_CLAIM_REVERTED while squad sponsored gov works."
  - "Bundler reason: 0x (empty) or claim eth_call preflight selector=none."
  - "Operators re-fund bootstrap/squad pools or re-debug 7702 before proving the inner claim() call."
root_cause: missing_layer_ordering
resolution_type: documentation_and_code_fix
severity: medium
tags: [erc4337, eip7702, username-nft, paymaster, sepolia, eth_call, pimlico]
---

# Sponsored UserOp / EIP-7702 debug method (L0–L4)

## Problem

Username bootstrap claim and squad sponsored gov share EIP-7702 + EP v0.7 + Pimlico, but failures were investigated as open-ended “7702 broken” while the claim path never got a typed NFT revert from a direct `claim()` `eth_call`. Ops also re-funded pools that were already green for first claim.

## Normative playbook

Follow **[`docs/wallet/SPONSORED_USEROP_7702.md`](../../wallet/SPONSORED_USEROP_7702.md)** in order: L0 → L1 → L2 → L3 → L4. Stop at the first failing layer.

## This incident’s staging (Sepolia)

| Layer | Status | Evidence |
|-------|--------|----------|
| L0 | OK | BootstrapMintPool spendable > 0; global PM EP deposit + stake; `ALLOWED_7702` matches book; NFT `mintFee` 0. GlobalSponsorPool empty (rotation-only; not blocking first claim). Squad PM funded but irrelevant. |
| L1 | Fixed client-side | Structured eth_call revert data; `issuedAt` from chain time; ClaimBinding parity + local BIP-340 verify before UserOp; NFT selector → named wallet codes. |
| L2–L4 | Smoke ready | Shared UserOp key-set unit test; operator Sepolia claim after L1 OK (see playbook Layer 2 smoke). |

## What to capture next time

1. Redacted stderr: `[pacto_wallet] claim eth_call preflight` + bundler reject lines (`make logs LOG_CLIENT=<n>`).
2. NFT selector → map to `PactoUsernameNFT_*` / fix claim fields (Nostr BIP-340, EIP-712 ClaimBinding v2, `issuedAt` vs chain time, nonce, name).
3. After L1 OK: UserOp shared-field diff vs squad; one Sepolia bootstrap claim success.

## Related code

- `src-tauri/src/evm/rpc/call.rs` — structured eth_call revert data
- `src-tauri/src/evm/global_sponsor_userop.rs` — claim preflight + username UserOp
- `src-tauri/src/evm/sponsor_userop.rs` — shared 7702 / bundler
- `src-tauri/src/evm/username/commands_claim.rs` — claim construction
