# pacto-squad-sponsor (external contract repo)

Squad-scoped **ERC-4337** gas sponsorship (paymaster + per-squad clone factory). Sources live upstream only — **not** vendored as a full contract tree in this app repo.

**Canonical source:** [github.com/covenant-gov/pacto-squad-sponsor](https://github.com/covenant-gov/pacto-squad-sponsor) (`dev` branch during active development). Desktop client guide: upstream `docs/DESKTOP_CLIENT_INTEGRATION.md`.

## How Pacto uses it

| Concern | Where in Pacto |
|---------|----------------|
| Alloy bindings | `src-tauri/src/evm/contracts/pacto_sponsor/mod.rs` |
| Deploy + read | `squad_sponsor_deploy.rs` (Ext + hats), `squad_sponsor_deposit.rs`, `squad_sponsor_read.rs`, `squad_sponsor_ext.rs` |
| AuthZ helpers | `squad_sponsor_common.rs` (parent membership, duplicate preflight, signer wallet parse) |
| Sponsored gov writes | `sponsor_paymaster.rs`, `sponsor_userop.rs`, hooked from `gov_module_write.rs` |
| `paymasterAndData` encoder + vectors | `src/lib/evm/sponsor/` (vendored from upstream client fixtures) |
| Deployed factory / paymaster | [`pacto-protocol-addresses.json`](../../src/lib/evm/pacto-protocol-addresses.json) — see [`PROTOCOL_ADDRESS_BOOK.md`](./PROTOCOL_ADDRESS_BOOK.md) |
| Persistence | `squad_infra` SQLite rows (`infra_type: sponsor`) via `list_squad_infra` / `upsert_squad_infra`; **sponsored fee ledger** `squad_sponsored_fee_usage` (per successful UserOp) via `list_squad_sponsored_fee_usage` |

**On-chain squad key:** `squadId = keccak256(utf8(parent_id))` where `parent_id` is the squad or network root id in the app.

**Default path:** Launchpad **Deploy Pacto Gov + squad sponsor** — Nave Pirata first, then `createSquadSponsor(squadId, topHatId, registry, [])` so eligibility is captain/crew hat wearers. Optional `bootstrapCrew` in the same wizard. If gov already exists and sponsor is missing, the same wizard finishes hats sponsor only (empty parent slot → `createSquadSponsor`; already-wired Ext or a hats clone stays `ALREADY_DEPLOYED`).

**Advanced Ext:** Launchpad / Advanced **Deploy squad sponsor (Ext)** — `createSquadSponsorExt(squadId, addressOwner)` with `addressOwner` = roster EVM; gas/deposit may come from Default. An unwired Ext can later hats-wire via `postInitialize` onto NavePirataRegistry. War-game deploy does **not** create that parent Ext.

## Sponsored UserOps (gov writes)

**Who pays gas?** For post-deploy gov module writes (`gov_module_write`), Pacto checks whether the **squad roster key** can cover the tx:

1. **Roster has enough ETH** → send a normal EOA transaction (user pays gas).
2. **Roster cannot cover gas** (and a squad sponsor is deployed) → build a sponsored EntryPoint v0.7 UserOp; the squad’s paymaster / pool pays gas instead.
3. **No ETH and no sponsor / bundler config** → write fails (`SPONSOR_PATH_UNAVAILABLE` or similar).

Deploy and deposit themselves are **not** sponsored — only those gov writes. See also [ACCESS_CONTROL.md](../governance/ACCESS_CONTROL.md) (Sponsored gov writes).

**Wallet model:** Pacto signs with the embedded **roster EOA** only. There is no “pick EOA vs smart-contract wallet” switch and no support for an external SCW (e.g. Safe) as the roster signer. On the sponsored path, if that EOA still has empty code, the client attaches an **EIP-7702** authorization so the bundler can temporarily set-code it to a shared account implementation (AA-compatible `execute`). That is not a different wallet product — same key, temporary bytecode for the UserOp. If the address already has code, 7702 auth is skipped.

### Sponsored fee ledger

On successful sponsored inclusion (`success: true` + bundler `actualGasCost`), `gov_module_write` inserts a row into `squad_sponsored_fee_usage` (actor npub/EVM, amount wei, selector/action, target, userOp/tx hash, parent, chain). Failed or reverted UserOps are not recorded as spent. Persist failures are logged and do not fail the write. Treasury UI lists via `list_squad_sponsored_fee_usage` (newest first, capped).

### Operator env

| Variable | Role |
|----------|------|
| `ALCHEMY_RPC_KEY` | Chain RPC URLs only (not the UserOp bundler) |
| In-app Pimlico key | **Preferred** — Status → Sponsored gas; stored on the current account; overrides `.env` without restart |
| `PIMLICO_API_KEY` | Fallback sponsored bundler — builds `https://api.pimlico.io/v2/11155111/rpc?apikey=…` on Sepolia |
| `BUNDLER_RPC_URL` | Optional override of the bundler JSON-RPC URL (any EP v0.7 bundler; do **not** use Alchemy as bundler) |
| `PACTO_ERC4337_ACCOUNT_IMPL` | Optional override of the shared EIP-7702 set-code target (not pacto-gov; leave unset unless experimenting) |

In **debug** `tauri:dev` builds, the Rust backend loads repo-root `.env` into the process at startup (existing process env wins). Release builds expect secrets via the real environment. Vite still loads `.env` separately for the frontend.

**Bundler (Pimlico-first):**

```bash
PIMLICO_API_KEY=<KEY>
# → https://api.pimlico.io/v2/11155111/rpc?apikey=<KEY>

# Optional escape hatch (non-Alchemy EP v0.7):
# BUNDLER_RPC_URL=https://…
```

Confirm `eth_supportedEntryPoints` includes `0x0000000071727De22E5E9d8BAf0edAc6f37da032`. Pacto sponsorship uses **`PactoSponsorPaymaster`** (not a vendor gas manager); the bundler only submits UserOps. Sponsored UserOps clamp `maxPriorityFeePerGas` to at least **1 gwei** so common bundler prechecks do not reject near-zero RPC tip estimates.

Alchemy’s AA bundler echoes estimate ceilings and rejects with a verification-gas efficiency floor — use **Pimlico** (or another measuring bundler), not Alchemy, for `eth_sendUserOperation`.

### Protocol paymaster float and stake (once per chain)

Squad **sponsor pool** deposits (Treasury UI / `sponsor.pool().deposit()`) are **not** the same as the shared paymaster’s EntryPoint **deposit** or **stake**. Addresses: [`pacto-protocol-addresses.json`](../../src/lib/evm/pacto-protocol-addresses.json) Sepolia `squadSponsor` (source: upstream [`deployments/11155111/full-system.json`](https://github.com/covenant-gov/pacto-squad-sponsor/blob/dev/deployments/11155111/full-system.json)). EIP-7702 account: [pacto-aa `deployments/11155111/eip7702-account.json`](https://github.com/covenant-gov/pacto-aa/blob/dev/deployments/11155111/eip7702-account.json).

| Bucket | Who funds | Role |
|--------|-----------|------|
| Squad sponsor pool | squad (Treasury) | Reimburses paymaster after success (`spendGas`); validation uses `spendablePoolWei()` |
| Paymaster EntryPoint deposit | protocol / any wallet | Bundler prepaid gas (`paymaster.deposit()`) |
| Paymaster EntryPoint stake | protocol (FCFS `paymasterStaker` via factory) | Bundler reputation / ERC-7562; typical Sepolia floor **≥ 0.1 ETH**, delay ≥ **1 day** |

**Greenfield cutover:** a factory redeploy creates a new paymaster. Existing clones were initialized with the old paymaster — **recreate** the squad sponsor for the parent and replace stale `squad_infra` sponsor rows (no dual-read of old clones). Restart `pnpm tauri:dev` after address-book changes so Rust recompiles the embedded JSON. Sponsored writes preflight `clone.paymaster() ==` address book (`SPONSOR_PAYMASTER_MISMATCH` if not). Paymaster also requires EIP-7702 stubs to delegate to the allowlisted `PactoSimple7702Account` (`SS_Invalid7702Implementation` otherwise). Current Sepolia addresses: pacto-squad-sponsor SS-3 `full-system.json` (factory `0x9F6b1936…` / paymaster `0xD84337C1…`; registry-backed allowlist via username `PactoProtocolRegistry` `0xAF61198b…`). Do **not** send UserOps at retired paymasters `0xc7c3Ea95…` / `0x78197483…` or factories `0xD8bdc2e5…` / `0xb758DB17…`.

Dev/protocol ops (no product UI) — Sepolia addrs from the current address book:

```bash
FACTORY=0x9F6b1936e1817A074033591bb55DC65CBB29e4d7
PAYMASTER=0xD84337C18dB089DF78c69Ea0df619bD48EEBBcC3
EP=0x0000000071727De22E5E9d8BAf0edAc6f37da032

# EP deposit (anyone)
cast call $EP "balanceOf(address)(uint256)" $PAYMASTER --rpc-url "$SEPOLIA_RPC"
cast send $PAYMASTER "deposit()" --value 0.1ether --rpc-url "$SEPOLIA_RPC" --private-key "$OPS_KEY"

# Stake via factory (first caller becomes paymasterStaker; min 0.1 ETH, delay ≥ 86400)
cast send $FACTORY "addPaymasterStake(uint32)" 172800 \
  --value 0.1ether --rpc-url "$SEPOLIA_RPC" --private-key "$OPS_KEY"
```

Unlock / withdraw stake or EP deposit: factory `unlockPaymasterStake` / `withdrawPaymasterStake` / `withdrawPaymasterDeposit` — **staker only**.

**EIP-7702 account implementation (Sepolia):** pinned in [`pacto-protocol-addresses.json`](../../src/lib/evm/pacto-protocol-addresses.json) as `networks.sepolia.erc4337.accountImplementation`:

| Address | Source | Notes |
|---------|--------|--------|
| `0x2E9156deE65d7946305C334824e2648Ff9128f45` | Pacto `PactoSimple7702Account` ([pacto-aa](https://github.com/covenant-gov/pacto-aa); IERC721/1155 receiver) | `entryPoint()` = EP v0.7; bare ECDSA over `userOpHash`; `execute(address,uint256,bytes)`; global + squad PMs read allowlist from `PactoProtocolRegistry` |

Sponsored UserOps against this impl must use **EntryPoint nonce key `0`**, **bare ECDSA `sign_hash(userOpHash)`** (65-byte signature — not EIP-191 `personal_sign`, not Alchemy MAv2 packing). Gas limits come from a **two-pass** bundler **`eth_estimateUserOperationGas`** (placeholders, then re-estimate with measured limits), then a **1.2×** margin on call / preVerification / postOp; account and paymaster **verification** pads stay ≤ **2.0×**. Estimate placeholders use **500k** `callGasLimit` by default and **1.5M** for Hats/Safe execute selectors (`executeMutiny`, `captainResign`, treasury `execute`, crew add/remove/bootstrap, `executeOffboard`). Account-OOG on the 500k ceiling retries once at 1.5M. `PAYMASTER_REJECTED` is only the unclassified leftover; call OOG / simulation revert / AA33 map to `USEROP_CALL_GAS`, `GOV_CALL_REVERTED` (or `MUTINY_*` when the revert selector is known), and `PAYMASTER_VALIDATION`. Paymaster requires `sender == member` for 7702 senders and that the set-code target matches the allowlisted impl.

Do **not** use eth-infinitism `Simple7702Account` at `0xe6Cae83BdE06E4c305530e199D7217f42808555B` — that impl’s `entryPoint()` is EP **v0.8**, incompatible with the Sepolia paymaster / EntryPoint v0.7 stack. Do **not** use Alchemy SemiModularAccount7702.

## Manual smoke (Sepolia)

See **[OPERATOR_SMOKE.md](./OPERATOR_SMOKE.md)** and **[ACCESS_CONTROL.md](../governance/ACCESS_CONTROL.md)**. After the SS-3 address-book pin: full-restart Tauri, recreate squad sponsor clones on the **new** factory (`0x9F6b1936…`), fund the clone pool, then **0 ETH roster → sponsored Bootstrap crew** (section 1).

## Out of scope here

EOA deploy affordability / deposit gas-reserve UX is a separate follow-on (not required for sponsored UserOp cutover).

## Related

- Shared sponsored UserOp / EIP-7702 debug order (L0–L4) and Sepolia fund matrix: [SPONSORED_USEROP_7702.md](./SPONSORED_USEROP_7702.md)
- Nave Pirata / governance stack: [PACTO_GOV.md](./PACTO_GOV.md)
