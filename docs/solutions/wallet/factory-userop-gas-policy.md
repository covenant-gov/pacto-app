---
title: Factory UserOp gas policy, and a later squad-lane share
date: 2026-10-31
category: docs/solutions/wallet
module: sponsored-userop
problem_type: logic_error
component: wallet_evm
symptoms:
  - "0-ETH deployNavePirata rejected as 16794127 > 16000000 (FACTORY_USEROP_TOO_LARGE)."
  - "Squad-pool offboard from a 0-ETH member succeeds on the same stack."
root_cause: client_padded_factory_estimate_past_bundler_cap
resolution_type: code_fix
severity: high
tags: [erc4337, pimlico, factory, global-paymaster, gas-cap]
---

# Factory UserOp gas policy

## What landed

`deployNavePirata` on the global paymaster now follows the live-sepolia factory policy:

- Estimate once with factory ceilings: verification 1M, call 14M, preVerification 200k, paymaster verification 500k, postOp 100k (sum 15.8M).
- No second estimate and no 1.2× pad.
- Clamp the five-limit sum to ≤ 16M, cutting `callGasLimit` first. A ~14.0M estimate stays in that class. The 16,794,139 fixture clamps to exactly 16M (call cut to 13,705,861).
- On a bundler gas-cap estimate error, send those 15.8M ceilings. Other estimate errors propagate.
- Stderr: `[pacto_wallet] global UserOp lane=factory_target … sum=`.
- A later `max gas per userOp` reject still maps to `FACTORY_USEROP_TOO_LARGE`. Routing is unchanged: eligible member uses this UserOp; EOA only when that key can pay; no silent fallthrough for a 0-ETH key.

`16.79M > 16M` was the client padding a ~14M estimate (`16794127 / 1.2 ≈ 14.0M`). It was not the factory needing 16.79M of gas.

Squad and username sends still use two-pass estimate plus the 1.2× pad when the padded sum is already under 16M. The shared pad-to-fit branch no longer does `.max(raw.call_gas_limit)`, so that overflow path cannot submit a sum over 16M. Small ops still take the full pad.

## Squad lane (leave the code; share the policy later)

Sepolia tx [`0xa6f0e670…977ed7`](https://sepolia.etherscan.io/tx/0xa6f0e67092af09683ea0419d2ab70ac7ef3283f554cfc90e472eb3624f977ed7) is a working squad-sponsor UserOp, not a global one. Sender `0x2634FA7c…70a3b` held no ETH. Paymaster `0x734Cd82B…ee424` (squad clone). `CrewOffboardProposed` offboard id 11. Submitted five-limit sum about 1.51M (verification 204,421 + call 688,634 + preVerification 365,211 + pm verification 161,215 + postOp 86,874). `actualGasUsed` 1,138,656. UI: “gas sponsored from the squad pool.” The username NFT on that member did not choose the paymaster. Call nesting + gas settlement diagrams: [SPONSORED_USEROP_SEPOLIA_EXAMPLE.md](../../wallet/SPONSORED_USEROP_SEPOLIA_EXAMPLE.md).

A funded-ETH key deploying gov and the squad sponsor is the EOA factory arm. That also worked and is a different path.

Do not retune that squad send to chase the factory cap. The follow-up is to give both lanes one gas policy, chosen per lane, after this global path is confirmed on Sepolia (`funded_by: global_sponsored`, stderr sum ≤ 16M):

- One policy value: ceilings, whether to 1.2×, whether to run pass 2, always clamp to 16M.
- Small squad / gov / username ops keep 1.2× and pass 2. That is what the offboard already does.
- Heavy lanes (factory today) opt into the no-pad clamp.
- The live harness already does this with `factoryStyle` on one sender. The client currently splits `estimate_global_sponsored_gas`, `estimate_global_factory_gas`, and squad `estimate_sponsored_gas`, plus `finalize_userop_gas_limits` vs `finalize_factory_userop_gas_limits`.
- Paymaster encoding and deploy routing stay per product. This note does not change them.
