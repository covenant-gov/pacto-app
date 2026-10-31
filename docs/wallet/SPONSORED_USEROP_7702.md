# Sponsored UserOp + EIP-7702

Normative transport spec for **roster-EOA → EIP-7702 account → EntryPoint v0.7 → Pimlico** sponsored writes. Squad gov, username claim, and factory deploy share this transport. They differ in paymaster, eligibility, and lane.

Numeric caps, pads, factory ceilings, headroom, and last-resort fees live only in [`src/lib/evm/userop-bundler-policy.json`](../../src/lib/evm/userop-bundler-policy.json). A new gas or fee literal in Rust or TypeScript is a bug; change the JSON.

Worked Sepolia example (call nesting + gas settlement diagrams): [SPONSORED_USEROP_SEPOLIA_EXAMPLE.md](./SPONSORED_USEROP_SEPOLIA_EXAMPLE.md).

Incident notes stay incident-only: [`docs/solutions/wallet/sponsored-userop-7702-debug-method.md`](../solutions/wallet/sponsored-userop-7702-debug-method.md), [`docs/solutions/wallet/factory-userop-gas-policy.md`](../solutions/wallet/factory-userop-gas-policy.md).

## Shared transport contract

| Piece | Pin / rule |
|-------|------------|
| Account | `PactoSimple7702Account` (`erc4337.accountImplementation` / global `allowed7702Implementation` in the address book; pacto-aa) |
| EntryPoint | v0.7 `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| Bundler | Pimlico (Settings Sponsored gas / `PIMLICO_API_KEY` / `BUNDLER_RPC_URL`) — **not** Alchemy AA |
| Auth | `sign_eip7702_authorization` (yParity 0/1); skip when sender already has correct `0xef0100` stub |
| Signature | Bare ECDSA `sign_hash(userOpHash)` (65 bytes) — not `personal_sign`, not MAv2 |
| Nonce | EntryPoint nonce **key 0** |
| Gas | Two lanes below. Knobs in the policy JSON. |
| Fees | Route probes require Pimlico `standard`; final sends prefer Pimlico and may use the policy fallback. Final safety checks use the selected send fee. See Fees. |
| Helpers | [`src-tauri/src/evm/userop/`](../../src-tauri/src/evm/userop/) — `policy`, `pipeline`, `fees`, `eip7702`, `placeholder`, `transport` |

**Forbidden:** eth-infinitism Simple7702Account (EP v0.8), Alchemy SemiModularAccount7702, hand-rolled relay lists for MLS, mega-merging `send_sponsored_*` unless Layer 2 proves transport drift.

## Bundler policy

[`userop-bundler-policy.json`](../../src/lib/evm/userop-bundler-policy.json) is the only copy of these knobs. Rust loads it from `evm/userop/policy.rs`. TypeScript reads the same file. The meanings below describe the current JSON; edit the file, not this table, when a number moves.

| Key | Why |
|-----|-----|
| `bundlerUserOpGasCap` | Pimlico five-limit sum ceiling (16M). |
| `callGasMarginBps` | Small-lane pad on call / preVerification / postOp (12000 = 1.2×). |
| `verificationGasMaxPadBps` | Cap on account and paymaster verification pads (20000 = 2.0×). |
| `fallbackCallGasLimit` | Small-lane placeholder `callGasLimit` (500k). |
| `heavyCallGasLimit` | Retry ceiling when the 500k placeholder OOGs (1.5M). Hats/Safe execute selectors start here. |
| `fallbackPreVerificationGas` | Small-lane placeholder preVerification. |
| `defaultVerificationGasLimit` | Small-lane placeholder account verification. |
| `defaultPaymasterVerificationGasLimit` | Small-lane placeholder paymaster verification. |
| `defaultPostOpGasLimit` | Small-lane placeholder postOp. |
| `factoryCallGasLimit` | Factory estimate ceiling for `callGasLimit` (~14M). |
| `factoryVerificationGasLimit` | Factory account verification ceiling. |
| `factoryPreVerificationGas` | Factory preVerification ceiling. |
| `factoryPaymasterPostOpGasLimit` | Factory paymaster postOp ceiling. |
| `fallbackMaxPriorityFeeWei` | Final-send last-resort tip (1 gwei) when the Pimlico price RPC fails. |
| `fallbackMaxFeeWei` | Final-send last-resort max fee (30 gwei) when the Pimlico price RPC fails. Do not clamp an Alchemy quote to this. |
| `poolBalanceHeadroomBps` | Pool spendable must cover `maxCost` plus headroom (11500 = 115%). |
| `paymasterDataOffset` | Byte offset of the inner paymaster payload. |

## Two lanes

`SponsoredUserOpLane` selects `Small` or `Factory` inside the shared pipeline. Lane behavior is fixed in code, not configured by JSON booleans.

**Small** (squad gov, global gov-module, username claim): estimate pass 1 at the lane placeholders. A pass-1 cap rejection uses the cap-filling placeholder fallback. Run pass 2 only when pass 1 and its locally padded form fit under `bundlerUserOpGasCap`; otherwise finalize pass 1 directly. Normal estimates are padded and clamped into final limits. If pass 2 hits the bundler cap, the clamped pass-1 limits are already final and are sent unchanged, without another pad.

**Factory** (`deployNavePirata`, `lane=factory_target`): one estimate at the factory ceilings. No call margin and no pass 2. Clamp the five-limit sum to the cap, cutting `callGasLimit` first; a cap rejection during estimate uses the factory ceilings. `FACTORY_USEROP_TOO_LARGE` only if the bundler still rejects the final send. A 0-ETH username-NFT deploy is the Launchpad path (`funded_by: global_sponsored`). A reject of the form `16794127 > 16000000` is the client padding a ~14M estimate. It is not proof the factory call itself exceeds the cap.

## Fees

Route and eligibility probes call `resolve_userop_probe_fees`, which requires Pimlico `pimlico_getUserOperationGasPrice` (`standard`). If pricing fails, the sponsored route is unavailable; probes never use the fallback fee to make a route look fundable.

Final sends call `resolve_userop_send_fees`. They use the Pimlico quote when available and may use `fallbackMaxPriorityFeeWei` / `fallbackMaxFeeWei` only when that price RPC fails. They do not source or clamp an Alchemy EIP-1559 quote.

Route probes are routing hints, not send authorization. After `eth_estimateUserOperationGas` returns final limits, `sign_and_send_sponsored_userop` recomputes `maxCost` from those limits and the actual selected send fee, then reruns the EntryPoint deposit and product-pool headroom preflights. This includes fallback-priced sends.

Alchemy (`ALCHEMY_RPC_KEY`) is chain RPC only (`eth_call`, receipts). It is not the 4337 fee path and not the bundler.

## Mandatory pipeline

1. Select the typed `SponsoredUserOpLane`.
2. Resolve final-send fees with `resolve_userop_send_fees`.
3. `estimate_sponsored_userop` — apply the lane ceilings and estimate policy, returning final gas limits.
4. `sign_and_send_sponsored_userop` — recompute final `maxCost`, rerun deposit and pool safety preflights, sign `userOpHash`, then call `eth_sendUserOperation`.

Product code supplies the paymaster encoder and the final pool preflight. Route selection separately uses strict probe pricing. Product code does not call the bundler itself.

## Agent rule

New gas or fee literals in Rust or TypeScript are a bug. Change [`userop-bundler-policy.json`](../../src/lib/evm/userop-bundler-policy.json). Do not source UserOp fees from Alchemy.

## Two sponsors, one transport

| | Squad (working golden path) | Username |
|--|--|--|
| Entry | `gov_module_write` → `send_sponsored_gov_userop` | `username_claim` / member writes → `send_sponsored_username_userop` |
| Paymaster | `PactoSponsorPaymaster` (per-squad clone) | `PactoGlobalPaymaster` |
| Pool | Squad sponsor pool | BootstrapMintPool (first claim) / GlobalSponsorPool (post-mint) |
| Paymaster payload | Squad encoder | Global encoder; **`policy = address(0)` always** (do not put bootstrap policy in `paymasterData`) |

## Mandatory layer order

Do **not** re-debug 7702 while Layer 1 fails.

1. **L0 Ops** — Address book pin, Tauri full restart after pin, Pimlico, EP deposit + stake, product pool funded.
2. **L1 Inner call** — `eth_call`/`cast` with `from=roster` for the inner target calldata. Require success **or** a named 4-byte selector. Username: claim preflight in `global_sponsor_userop` before estimate.
3. **L2 7702** — Only after L1 OK. `code_len`, `eip7702_auth=some|none`, allowlist match; field-diff shared UserOp keys vs squad golden path.
4. **L3 Paymaster** — Product encoder + pool headroom; username keeps `policy=0`.
5. **L4 Bundler** — Classify stderr (`[pacto_wallet] bundler …`). Empty `reason: 0x` **after** L1 OK ⇒ transport; **before** L1 OK ⇒ ignore 7702. Factory lane: `[pacto_wallet] global UserOp lane=factory_target … sum=` must be ≤ 16_000_000. A `16794… > 16000000` reject is a padded estimate, not an inner Solidity over-cap.

```mermaid
flowchart TB
  subgraph layer0 [Layer0 ops pins]
    pools[Pools and EP deposit stake]
    pimlico[Pimlico bundler]
  end
  subgraph layer1 [Layer1 inner call]
    ethCall[eth_call as roster]
  end
  subgraph layer2 [Layer2 shared 7702]
    auth[eip7702Auth and account impl]
  end
  subgraph layer3 [Layer3 paymaster]
    pm[Product paymaster payload]
  end
  subgraph layer4 [Layer4 bundler]
    est[estimate and classify]
  end
  layer0 --> layer1
  layer1 -->|fail| stop[Stop fix product call]
  layer1 -->|ok| layer2 --> layer3 --> layer4
```

## Sepolia fund matrix (bootstrap username claim)

Address book: [`pacto-protocol-addresses.json`](../../src/lib/evm/pacto-protocol-addresses.json). Audit snapshot (ops): bootstrap claim infra was funded — **do not** re-fund squad PM or bootstrap pool to fix a Layer-1 claim revert.

| Contract | Need for bootstrap claim | Notes |
|----------|--------------------------|--------|
| BootstrapMintPool | spendable > 0 (+ later ~115% headroom) | First-claim gas |
| PactoGlobalPaymaster | EP deposit + stake; `ALLOWED_7702` = book impl | Required |
| Claim `msg.value` | always 0 | Mint fee removed upstream |
| GlobalSponsorPool | post-mint rotation only | Empty does **not** block first claim |
| Squad paymaster | squad gov only | Irrelevant to username claim |

### Re-check with `cast` (Sepolia RPC)

```bash
BOOK=src/lib/evm/pacto-protocol-addresses.json
BOOTSTRAP=$(jq -r '.networks.sepolia.globalUsernameSponsor.bootstrapMintPool' "$BOOK")
GLOBAL=$(jq -r '.networks.sepolia.globalUsernameSponsor.globalSponsorPool' "$BOOK")
PM=$(jq -r '.networks.sepolia.globalUsernameSponsor.pactoGlobalPaymaster' "$BOOK")
EP=$(jq -r '.networks.sepolia.globalUsernameSponsor.entryPoint' "$BOOK")

cast call "$BOOTSTRAP" 'spendablePoolWei()(uint256)' --rpc-url $SEPOLIA_RPC
cast call "$GLOBAL" 'spendablePoolWei()(uint256)' --rpc-url $SEPOLIA_RPC
cast call "$EP" 'balanceOf(address)(uint256)' "$PM" --rpc-url $SEPOLIA_RPC
cast call "$PM" 'ALLOWED_7702_IMPLEMENTATION()(address)' --rpc-url $SEPOLIA_RPC
```

## Next-sponsor plug-in surface

Reuse shared 7702 helpers. New product only adds:

- Paymaster + `paymasterAndData` encoder
- Eligibility / pool preflight
- Optional inner `eth_call` preflight (typed selector before estimate)

Do not fork authorization, UserOp JSON shape, or estimate/sign loop unless L2 field-diff shows drift.

## Layer 2 smoke (after Layer 1 OK)

Unit baseline: `user_op_json_shared_keys_stable_for_username_and_squad` in `evm/userop/transport.rs` (same key set for both sponsors).

Operator Sepolia checklist (empty-code roster):

1. Restart Tauri after address-book pin; Pimlico configured.
2. Claim username via Commons / Profile (bootstrap path).
3. Logs (`make logs LOG_CLIENT=<n>`): `claim eth_call` succeeds (no `USERNAME_CLAIM_REVERTED`); then `username UserOp … eip7702_auth=some code_len=0`.
4. Bundler accept → receipt success; badge shows claimed name.
5. If estimate fails after L1 OK: classify via L2–L4 against squad golden path — do not re-fund bootstrap pool.

## Isolated claim harness (Tauri-free)

Local-only Sepolia probe that walks L0 → build `claim("test")` → L1 `eth_call` → **L1.5** `execute` under EIP-7702 stub → sponsored 7702 UserOp **without** Commons/UI or roster ETH. Not in CI.

```bash
cd src-tauri && cargo run --bin username_claim_harness --features username-claim-harness
# optional replay: -- --mnemonic 'twelve words…'
```

Requires `ALCHEMY_RPC_KEY` + `PIMLICO_API_KEY` in repo-root `.env`. Stdout stages:

- **L1 fail** → named NFT selector / stop (fix claim fields before UserOp).
- **L1.5** — Alchemy `eth_call` of `execute(nft, 0, claim)` with `to=member`, state override `code=0xef0100||allowed7702Implementation`, `from` = EntryPoint then member. Isolates account/`execute` before Pimlico. Fail → stop (do not estimate).
- **L1.5 OK + estimate fail** → redacted UserOp + Tenderly **Simulator** recipe on stderr. There is **no** `txHash` / `userOpHash` until bundler send — Tenderly Explorer cannot open estimate failures; paste RECIPE A/B into Simulator.
- **Mint OK** → `recordOf` / tx hash; next compare `global_sponsor_userop` → Tauri `username_claim` → Commons CTA.

### L1.5 finding (empty revert after L1 OK)

Bare `claim` eth_call succeeds (EOA has no code). Under a 7702 stub, NFT `_safeMint` calls `onERC721Received` on the roster EOA; `PactoSimple7702Account`’s empty `fallback` does not return the IERC721Receiver magic → nested empty revert (cast: Transfer then `onERC721Received` → `EvmError: Revert`). That matches Pimlico `reason: 0x` at estimate. **Fix:** implement `onERC721Received` on the account, redeploy **only** the EIP-7702 impl, pin `erc4337.accountImplementation` + paymaster `ALLOWED_7702` (not a third full-system redeploy).

**Production client parity (post harness):** `global_sponsor_userop` bootstrap claims now mirror the harness: authoritative **L1.5** `execute(nft, 0, claim)` preflight (bare L1 only when roster code is empty), and **auto EIP-7702 upgrade** auth when delegation points at a stale impl instead of failing closed. Shared logic lives in `src-tauri/src/evm/username_claim_preflight.rs`.

### Field-diff notes (squad vs username)

Shared: `user_op_json`, EIP-7702 auth, bare `sign_hash(userOpHash)`, EP v0.7 nonce key 0, and the typed estimate/send pipeline. Small lanes may use pass 2; factory uses one pass. Products diverge only on paymaster contract + `paymasterData` payload and inner `execute(dest, 0, data)`. L1 claim `eth_call` does **not** wrap `execute` — L1 OK does not prove UserOp sim. Squad gov does not `_safeMint` to the roster, so it never hit the missing receiver.

### Broadcast invariants (must hold after PR #4 redeploy)

- Bootstrap: `npubOf==0`, `canBootstrapClaim`, bill `BootstrapMintPool`
- Client `paymasterAndData`: always **`policy = address(0)`** (never encode `bootstrapClaimPolicy`)
- `ALLOWED_7702` == app `PactoSimple7702Account` / `erc4337.accountImplementation`
- Foundry: `forge test --match-contract SponsoredBootstrapClaim` green on upstream `dev`

### Post-redeploy hard gate

Do not call Sepolia full-system redeploy done until:

1. New `full-system.json` + fund paymaster EP + BootstrapMintPool
2. App address book pin ([PROTOCOL_ADDRESS_BOOK.md](./PROTOCOL_ADDRESS_BOOK.md)) + Tauri restart
3. Harness above prints **SUCCESS**

On failure: client fix or registry NFT swap — not a third full-system broadcast unless factory/registry layout is wrong.

## Related

- [PACTO_SQUAD_SPONSOR.md](./PACTO_SQUAD_SPONSOR.md) — squad paymaster and pool ops
- [USERNAME_NFT.md](./USERNAME_NFT.md) — claim dual attestation
- [OPERATOR_SMOKE.md](./OPERATOR_SMOKE.md) §1 (squad) and §10 (username)
- [PROTOCOL_ADDRESS_BOOK.md](./PROTOCOL_ADDRESS_BOOK.md)
- Incident staging: [`docs/solutions/wallet/sponsored-userop-7702-debug-method.md`](../solutions/wallet/sponsored-userop-7702-debug-method.md)
- Factory gas policy and later squad-lane share: [`docs/solutions/wallet/factory-userop-gas-policy.md`](../solutions/wallet/factory-userop-gas-policy.md)
- Tracking: [pacto-username-nft#5](https://github.com/covenant-gov/pacto-username-nft/issues/5)
