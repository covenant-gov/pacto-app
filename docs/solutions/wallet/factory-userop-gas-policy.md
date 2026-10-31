---
title: Factory UserOp gas policy, and a later squad-lane share
date: 2026-10-31
category: docs/solutions/wallet
module: sponsored-userop
problem_type: logic_error
component: wallet_evm
symptoms:
  - "0-ETH deployNavePirata rejected as 16794127 > 16000000 (FACTORY_USEROP_TOO_LARGE)."
  - "Eligible NFT member with 0 ETH saw global factory ok=false while the global pool still had ETH."
  - "Squad-pool offboard from a 0-ETH member succeeds on the same stack."
root_cause: client_padded_factory_estimate_past_bundler_cap
resolution_type: code_fix
severity: high
tags: [erc4337, pimlico, factory, global-paymaster, gas-cap]
---

# Factory UserOp gas policy

Incident / findings for the factory UserOp work on `feat/gov-ux`. Normative transport stays [SPONSORED_USEROP_7702.md](../../wallet/SPONSORED_USEROP_7702.md). Follow-up stack: [#452](https://github.com/covenant-gov/pacto-app/issues/452) (policy JSON) → [#453](https://github.com/covenant-gov/pacto-app/issues/453) (one pipeline) → [#454](https://github.com/covenant-gov/pacto-app/issues/454) (docs + Cursor rule). Do not invent a fourth issue.

**Pimlico is the ERC-4337 stack.** Estimate, send, and UserOp gas price go to Pimlico. Alchemy and other chain RPCs are for `eth_call` / balances / receipts, not 4337 fees or simulation.

## What landed

Factory `deployNavePirata` on the global paymaster follows the live-sepolia factory policy ([orchestrator PR 23](https://github.com/covenant-gov/pacto-onchain-orchestrator/pull/23) `live-sepolia/src/userop/sendSponsored.ts`: `FACTORY_CLAMP_GAS`, `factoryStyle`).

Commits:

- `12dc58bd` — estimate once, 14M call ceiling, no 1.2× pad, clamp five-limit sum ≤ 16M (`finalize_factory_userop_gas_limits`). Shared pad-to-fit no longer does `.max(raw.call_gas_limit)`.
- `0b609191` — factory pool probe uses `pimlico_getUserOperationGasPrice`, not `FALLBACK_MAX_FEE` (30 gwei).
- `42e3fd46` / `f8f3985b` — prefer the Pimlico quote; no silent EOA fallthrough for a 0-ETH key.

Policy:

- Estimate once with factory ceilings: verification 1M, call 14M, preVerification 200k, paymaster verification 500k, postOp 100k (sum 15.8M).
- No second estimate and no 1.2× pad.
- Clamp the five-limit sum to ≤ 16M, cutting `callGasLimit` first. A ~14.0M estimate stays in that class. The 16,794,139 fixture clamps to exactly 16M (call cut to 13,705,861).
- On a bundler gas-cap estimate error, send those 15.8M ceilings. Other estimate errors propagate.
- Stderr: `[pacto_wallet] global UserOp lane=factory_target … sum=`.
- A later `max gas per userOp` reject still maps to `FACTORY_USEROP_TOO_LARGE`. Routing is unchanged: eligible member uses this UserOp; EOA only when that key can pay.

`16.79M > 16M` was the client padding a ~14M estimate (`16794127 / 1.2 ≈ 14.0M`). It was not the factory Solidity needing 16.79M. Do not split `deployNavePirata`.

Squad and username sends still use two-pass estimate plus the 1.2× pad when the padded sum is already under 16M. Small ops still take the full pad. `HEAVY_CALL_GAS_LIMIT` (1.5M) is vote / propose / bootstrap only — not the factory estimate ceiling.

## 30 gwei vs ~1.2 gwei

`FALLBACK_MAX_FEE` (30 gwei) is a last-resort send fallback from the squad launchpad work, later applied as a floor on Alchemy EIP-1559 quotes (`42e3fd46`) so Sepolia would not send a 1 gwei UserOp. That is the wrong fee source.

The war-game deploy paid **Pimlico `standard`** (~1.2 gwei per gas), not an Alchemy estimate. Before `0b609191`, the factory pool probe priced 15.8M gas at 30 gwei plus 15% headroom (~0.55 ETH). The global pool had ~0.084 ETH spendable, so the router returned `global factory ok=false` for an eligible 0-ETH NFT member. At ~1.2 gwei the same envelope is ~0.022 ETH, which that pool already covered. The pool was not topped up. After the probe used the Pimlico quote, the same member deployed a war-game.

Never use 30 gwei to price pool headroom or factory `maxCost`. If the Pimlico price RPC is down, fail closed or use a last-resort send fallback. Do not pull fees from Alchemy and clamp.

## Squad lane (leave the send path; share the pipeline later)

Sepolia tx [`0xa6f0e670…977ed7`](https://sepolia.etherscan.io/tx/0xa6f0e67092af09683ea0419d2ab70ac7ef3283f554cfc90e472eb3624f977ed7) is a working **squad-sponsor** UserOp, not a global one. Sender `0x2634FA7c…70a3b` held no ETH. Paymaster `0x734Cd82B…ee424` (squad clone). `CrewOffboardProposed` offboard id 11. Submitted five-limit sum about 1.51M (verification 204,421 + call 688,634 + preVerification 365,211 + pm verification 161,215 + postOp 86,874). `actualGasUsed` 1,138,656. UI: “gas sponsored from the squad pool.” The username NFT on that member did not choose the paymaster. Call nesting + gas settlement: [SPONSORED_USEROP_SEPOLIA_EXAMPLE.md](../../wallet/SPONSORED_USEROP_SEPOLIA_EXAMPLE.md).

A funded-ETH key deploying gov and the squad sponsor is the EOA factory arm. That also worked and is a different path.

Do not retune that squad send to chase the factory cap. Small ops keep 1.2× and pass 2 because the padded sum fits under 16M. That is what the offboard already does.

## What is still split

The client still has three estimate loops and two finalize functions:

- squad `estimate_sponsored_gas`
- global small `estimate_global_sponsored_gas`
- factory `estimate_global_factory_gas`
- `finalize_userop_gas_limits` vs `finalize_factory_userop_gas_limits`

Live-sepolia already picks this with `factoryStyle` on one sender. Next work is that shape in the desktop client, not a second factory hotfix:

| Issue | What |
|-------|------|
| [#452](https://github.com/covenant-gov/pacto-app/issues/452) | One `userop-bundler-policy.json` (caps, pads, factory ceilings, last-resort fee). Factory numbers stay as landed. |
| [#453](https://github.com/covenant-gov/pacto-app/issues/453) | One estimate/send pipeline with a lane / `factoryStyle` flag. Cuts squad / global / factory spaghetti. Paymaster encode, eligibility, and routers stay per product. Do not apply the 500k → 1.5M heavy-call retry to factory. |
| [#454](https://github.com/covenant-gov/pacto-app/issues/454) | `SPONSORED_USEROP_7702.md` as the sole transport spec; Cursor rule so knobs stay in the JSON. This file stays incident-only. |

Not this stack: after the war-game deploy, a later write toasted `squad pool ok=false, global topHat ok=false`. That is gov-module routing, not factory gas.
