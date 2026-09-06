# Sponsored UserOp + EIP-7702 (Layer 0–4)

Reusable debug playbook for **roster-EOA → EIP-7702 account → EntryPoint v0.7 → Pimlico** sponsored writes. Squad gov and username claim share this transport; they differ only in paymaster / eligibility.

Incident staging notes: [`docs/solutions/wallet/sponsored-userop-7702-debug-method.md`](../solutions/wallet/sponsored-userop-7702-debug-method.md).

## Shared transport contract

| Piece | Pin / rule |
|-------|------------|
| Account | `PactoSimple7702Account` (`erc4337.accountImplementation` / global `allowed7702Implementation`; Sepolia `0x2E9156de…` from pacto-aa) |
| EntryPoint | v0.7 `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| Bundler | Pimlico (Settings Sponsored gas / `PIMLICO_API_KEY` / `BUNDLER_RPC_URL`) — **not** Alchemy AA |
| Auth | `sign_eip7702_authorization` (yParity 0/1); skip when sender already has correct `0xef0100` stub |
| Signature | Bare ECDSA `sign_hash(userOpHash)` (65 bytes) — not `personal_sign`, not MAv2 |
| Nonce | EntryPoint nonce **key 0** |
| Gas | Two-pass `eth_estimateUserOperationGas`, then margins (see [PACTO_SQUAD_SPONSOR.md](./PACTO_SQUAD_SPONSOR.md)) |
| Helpers | `user_op_json`, `sign_eip7702_authorization`, estimate/send in `sponsor_userop.rs` |

**Forbidden:** eth-infinitism Simple7702Account (EP v0.8), Alchemy SemiModularAccount7702, hand-rolled relay lists for MLS, mega-merging `send_sponsored_*` unless Layer 2 proves transport drift.

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
5. **L4 Bundler** — Classify stderr (`[pacto_wallet] bundler …`). Empty `reason: 0x` **after** L1 OK ⇒ transport; **before** L1 OK ⇒ ignore 7702.

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
# BootstrapMintPool.spendablePoolWei()
cast call 0x95d3B8B97C4ff48af010191E80CcAA9F55749A2B 'spendablePoolWei()(uint256)' --rpc-url $SEPOLIA_RPC

# GlobalSponsorPool.spendablePoolWei() — rotation only
cast call 0x4EfeE104cF969bF70F342DFCd234f73A3bebEbeD 'spendablePoolWei()(uint256)' --rpc-url $SEPOLIA_RPC

# EntryPoint balanceOf(paymaster)
cast call 0x0000000071727De22E5E9d8BAf0edAc6f37da032 \
  'balanceOf(address)(uint256)' 0x04Fc205adA4c0c5C5024546E87972C4c4bB30D0F --rpc-url $SEPOLIA_RPC

# ALLOWED_7702 on global PM
cast call 0x04Fc205adA4c0c5C5024546E87972C4c4bB30D0F \
  'ALLOWED_7702_IMPLEMENTATION()(address)' --rpc-url $SEPOLIA_RPC
```

## Next-sponsor plug-in surface

Reuse shared 7702 helpers. New product only adds:

- Paymaster + `paymasterAndData` encoder
- Eligibility / pool preflight
- Optional inner `eth_call` preflight (typed selector before estimate)

Do not fork authorization, UserOp JSON shape, or estimate/sign loop unless L2 field-diff shows drift.

## Layer 2 smoke (after Layer 1 OK)

Unit baseline: `user_op_json_shared_keys_stable_for_username_and_squad` in `sponsor_userop.rs` (same key set for both sponsors).

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

Shared: `user_op_json`, EIP-7702 auth, bare `sign_hash(userOpHash)`, EP v0.7 nonce key 0, two-pass estimate. Diverges only on paymaster contract + `paymasterData` payload and inner `execute(dest, 0, data)`. L1 claim `eth_call` does **not** wrap `execute` — L1 OK does not prove UserOp sim. Squad gov does not `_safeMint` to the roster, so it never hit the missing receiver.

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

- [PACTO_SQUAD_SPONSOR.md](./PACTO_SQUAD_SPONSOR.md) — squad path + gas margins
- [USERNAME_NFT.md](./USERNAME_NFT.md) — claim dual attestation
- [OPERATOR_SMOKE.md](./OPERATOR_SMOKE.md) §1 (squad) and §10 (username)
- [PROTOCOL_ADDRESS_BOOK.md](./PROTOCOL_ADDRESS_BOOK.md)
- Incident staging: [`docs/solutions/wallet/sponsored-userop-7702-debug-method.md`](../solutions/wallet/sponsored-userop-7702-debug-method.md)
- Tracking: [pacto-username-nft#5](https://github.com/covenant-gov/pacto-username-nft/issues/5)
