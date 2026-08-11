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

**Default path:** Launchpad **Deploy Pacto Gov + squad sponsor** — Nave Pirata first, then `createSquadSponsor(squadId, topHatId, registry, [])` so eligibility is captain/crew hat wearers. Optional `bootstrapCrew` in the same wizard. If gov already exists and sponsor is missing, the same wizard finishes hats sponsor only.

**Advanced Ext:** Launchpad / Advanced **Deploy squad sponsor (Ext)** — `createSquadSponsorExt(squadId, addressOwner)` with `addressOwner` = roster EVM; gas/deposit may come from Default.

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
| `PIMLICO_API_KEY` | **Default** sponsored bundler — builds `https://api.pimlico.io/v2/11155111/rpc?apikey=…` on Sepolia |
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

Squad **sponsor pool** deposits (Treasury UI / clone `deposit`) are **not** the same as the shared paymaster’s EntryPoint **deposit** or **stake**. Addresses: [`pacto-protocol-addresses.json`](../../src/lib/evm/pacto-protocol-addresses.json) Sepolia `squadSponsor` (source: upstream [`deployments/11155111/full-system.json`](https://github.com/covenant-gov/pacto-squad-sponsor/blob/dev/deployments/11155111/full-system.json)). EIP-7702 account: upstream [`deployments/11155111/eip7702-account.json`](https://github.com/covenant-gov/pacto-squad-sponsor/blob/dev/deployments/11155111/eip7702-account.json).

| Bucket | Who funds | Role |
|--------|-----------|------|
| Squad sponsor pool | squad (Treasury) | Reimburses paymaster after success (`spendGas`); validation uses `spendablePoolWei()` |
| Paymaster EntryPoint deposit | protocol / any wallet | Bundler prepaid gas (`paymaster.deposit()`) |
| Paymaster EntryPoint stake | protocol (FCFS `paymasterStaker` via factory) | Bundler reputation / ERC-7562; typical Sepolia floor **≥ 0.1 ETH**, delay ≥ **1 day** |

**Greenfield cutover:** a factory redeploy creates a new paymaster. Existing clones were initialized with the old paymaster — **recreate** the squad sponsor for the parent and replace stale `squad_infra` sponsor rows (no dual-read of old clones). Restart `pnpm tauri:dev` after address-book changes so Rust recompiles the embedded JSON. Sponsored writes preflight `clone.paymaster() ==` address book (`SPONSOR_PAYMASTER_MISMATCH` if not). Paymaster also requires EIP-7702 stubs to delegate to the allowlisted `PactoSimple7702Account` (`SS_Invalid7702Implementation` otherwise). Current Sepolia addresses: pacto-squad-sponsor [`1ef93bf`](https://github.com/covenant-gov/pacto-squad-sponsor/commit/1ef93bfe312d3462f79c91b741f803166b874f0f) `full-system.json` (EP deposit + stake already funded on that cutover).

Dev/protocol ops (no product UI) — Sepolia addrs from the current address book:

```bash
FACTORY=0x12883924e71Df814ff1E198E5C16CEFd251BC308
PAYMASTER=0x065dA13369604291E628DD8022E0e504dc62Da12
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
| `0x33F920B5aF6c527f63BD6B24d58Dccd698b2DC60` | Pacto `PactoSimple7702Account` ([pacto-squad-sponsor#12](https://github.com/covenant-gov/pacto-squad-sponsor/pull/12)) | `entryPoint()` = EP v0.7; bare ECDSA over `userOpHash`; `execute(address,uint256,bytes)`; paymaster `ALLOWED_7702_IMPLEMENTATION` |

Sponsored UserOps against this impl must use **EntryPoint nonce key `0`**, **bare ECDSA `sign_hash(userOpHash)`** (65-byte signature — not EIP-191 `personal_sign`, not Alchemy MAv2 packing). Gas limits come from a **two-pass** bundler **`eth_estimateUserOperationGas`** (placeholders, then re-estimate with measured limits), then a **1.2×** margin on call / preVerification / postOp; account and paymaster **verification** pads stay ≤ **2.0×**. Paymaster requires `sender == member` for 7702 senders and that the set-code target matches the allowlisted impl.

Do **not** use eth-infinitism `Simple7702Account` at `0xe6Cae83BdE06E4c305530e199D7217f42808555B` — that impl’s `entryPoint()` is EP **v0.8**, incompatible with the Sepolia paymaster / EntryPoint v0.7 stack. Do **not** use Alchemy SemiModularAccount7702.

## Manual smoke (Sepolia)

See **[OPERATOR_SMOKE.md](./OPERATOR_SMOKE.md)** and **[ACCESS_CONTROL.md](../governance/ACCESS_CONTROL.md)**. After the `1ef93bf` address-book pin: full-restart Tauri, recreate sponsor on a throwaway parent, then **0 ETH roster → sponsored Bootstrap crew** (section 1).

## Out of scope here

EOA deploy affordability / deposit gas-reserve UX is a separate follow-on (not required for sponsored UserOp cutover).

## Related

- Nave Pirata / governance stack: [PACTO_GOV.md](./PACTO_GOV.md)
