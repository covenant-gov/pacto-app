# Wallet & governance — operator smoke (Sepolia)

Single checklist for manual Sepolia verification on **desktop (Tauri)**.

## Shared prerequisites

- [ ] Copy [`.env.example`](../../.env.example) → `.env` for **RPC** (debug Tauri loads root `.env` into Rust at startup; release builds need real process env / export).
- [ ] Set **`ALCHEMY_RPC_KEY`** (builds Sepolia and other chain URLs automatically). Protocol factory / paymaster / EIP-7702 account addresses ship in [`pacto-protocol-addresses.json`](../../src/lib/evm/pacto-protocol-addresses.json) — see [`PROTOCOL_ADDRESS_BOOK.md`](./PROTOCOL_ADDRESS_BOOK.md). After changing the address book, **fully restart** `pnpm tauri:dev` (Rust embeds the JSON at compile time; frontend HMR does not reload it).
- [ ] For **sponsored** gov writes (roster 0 ETH): save a Pimlico key on **#dashboard → Status → Sponsored gas** (applies without restart). Optional **`PIMLICO_API_KEY`** in `.env` is a fallback; optional **`BUNDLER_RPC_URL`** overrides both — do **not** point it at Alchemy’s AA endpoint. EIP-7702 impl is pinned as `erc4337.accountImplementation` (`PactoSimple7702Account`); override with `PACTO_ERC4337_ACCOUNT_IMPL` only for experiments. See [PACTO_SQUAD_SPONSOR.md](./PACTO_SQUAD_SPONSOR.md).
- [ ] Smoke identities: **funded Default (DM)** for deploy/deposit gas; **new empty roster key** (0 ETH) as captain after gov+sponsor; enough Sepolia ETH to **seed the sponsor pool**; throwaway `parentId`.
- [ ] **Once per chain (after factory cutover):** fund the **current** shared paymaster **EntryPoint deposit** (`paymaster.deposit()`) and **stake** (`factory.addPaymasterStake`, ≥0.1 ETH, delay ≥1 day) — see [PACTO_SQUAD_SPONSOR.md](./PACTO_SQUAD_SPONSOR.md). Separate from squad pool deposits. Current Sepolia cutover (SS-3 / [pacto-aa#1](https://github.com/covenant-gov/pacto-aa/issues/1) APP-1) is factory `0x9F6b1936…e4d7` / paymaster `0xD84337C1…BcC3` with EIP-7702 `0x2E9156de…f45`. After a factory redeploy, **recreate** squad sponsor clones on the **new** factory and fund the clone pool — old clones stay initialized with superseded paymasters (`0xc7c3Ea95…` / `0x78197483…` / factories `0xD8bdc2e5…` / `0xb758DB17…`) and must not receive UserOps. Confirm clone `paymaster()` / `factory()` match the address book before sponsored writes.
- [ ] Logged-in profile; wallet unlocked.
- [ ] Test squad/network with **`#announcements`** and **`#personal-alerts`**; use a **throwaway `parentId`** (one sponsor clone per parent on-chain).
- [ ] Devtools helpers live in `src/lib/governance/api.ts`, `src/lib/wallet/backend-wallet.ts` — prefer in-app wizards when available.

### Bundler quick check (once per key / URL)

```bash
# Default: Pimlico from PIMLICO_API_KEY
curl -sS "https://api.pimlico.io/v2/11155111/rpc?apikey=$PIMLICO_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_supportedEntryPoints","params":[]}'
# expect …71727De22E5E9d8BAf0edAc6f37da032… (EntryPoint v0.7)
```

**Deploy order (default):** Pacto Gov + hats squad sponsor (combined Launchpad CTA; optional crew bootstrap) → announce sync. **Advanced:** Squad sponsor **Ext** (allowlist owner = squad roster EVM; gas + deposit may come from **Default**) or Squad Admin alone without Pacto Gov. If gov exists and sponsor is missing, the same combined wizard finishes hats sponsor only. **Treasury** and **Governance** **Deploy** / **Deploy Sponsor** open the same **Deploy Governance** launchpad (not the combined wizard directly).

---

## 1. Pacto Gov + squad sponsor (default)

- [ ] **#dashboard** → **Deploy** → **Deploy Pacto Gov + squad sponsor**; captain is locked to your squad-assigned EVM; deposit; optional bootstrap when the squad key pays (including after a Default→squad fund transfer).
- [ ] **Privacy + funded Default:** bind a **new squad key** (empty), keep Default (DM) funded → wizard **Pay gas and deposit from → Default signer** → enter **How much to transfer?** (must exceed sponsor deposit) → ETH moves Default→squad, then deploy/gas/deposit/hats run as captain on the roster key. Bootstrap is allowed after that transfer path.
- [ ] **0 ETH roster + funded pool (sponsored bootstrap):** after deploy with empty roster key + funded sponsor deposit (pay from squad, or fund via Default transfer first), **Bootstrap crew** (wizard or Governance → Captain) succeeds; pool balance decreases; bundler accepts the UserOp.
- [ ] **Squad-key deployer:** pay from squad-assigned signer → Bootstrap enabled; Roles tree **Crew** shows wearers after deploy (self-funded EOA path when roster has ETH).
- [ ] **Governance** / **Roles** / **Treasury** (sponsor + gov Safe) look healthy after both txs.
- [ ] Optional: Status checklist **Mint all members a Crew hat** completes after bootstrap (or Captain bootstrap later).

| Symptom | Likely cause |
|---------|----------------|
| `SPONSOR_CONFIG` / `NAVE_PIRATA_CONFIG` | Missing factory / registry / paymaster in address book |
| `SS_SquadAlreadyExists` / `ALREADY_DEPLOYED` | Same `parentId` already has sponsor or gov — new parent |
| Sponsor step fails after gov | Finish with Launchpad → **Deploy squad sponsor** (same wizard, hats path) |
| Roster key has 0 ETH | Fund via **Default signer** transfer in the deploy wizard, or pay deploy from squad after topping up; gov writes use sponsored UserOp when eligible |
| `SPONSOR_PATH_UNAVAILABLE` / `BUNDLER_CONFIG` | Save a Pimlico key on Status (or set `PIMLICO_API_KEY` / `BUNDLER_RPC_URL`); or fund the roster key |
| `PAYMASTER_DEPOSIT_LOW` | Fund shared paymaster via `paymaster.deposit()` / `EntryPoint.depositTo` — **not** the squad sponsor pool |
| `PAYMASTER_STAKE_LOW` | Stake via `factory.addPaymasterStake` (FCFS `paymasterStaker`; ≥0.1 ETH, delay ≥1 day on Sepolia) |
| `PAYMASTER_VERIFICATION_GAS` | Paymaster simulation OOG during estimate/send — usually a bundler/paymaster regression; limits are from `eth_estimateUserOperationGas` |
| `PAYMASTER_GAS_EFFICIENCY` | Alchemy AA bundler artifact (estimate ceiling echo) — use Pimlico via `PIMLICO_API_KEY`, not Alchemy as bundler |
| `BUNDLER_ESTIMATE` | `eth_estimateUserOperationGas` transport/parse failure — check `PIMLICO_API_KEY` / `BUNDLER_RPC_URL` |
| `PAYMASTER_VALIDATION` | Bundler `-32502` / banned opcode — often an **old clone** still on the pre-redeploy paymaster, or Tauri not restarted after address-book cutover. Recreate sponsor; check raw detail in the toast |
| `SPONSOR_PAYMASTER_MISMATCH` | Clone `paymaster()` ≠ address book — recreate squad sponsor under the current factory |
| `BUNDLER_FEE` | Client tip below bundler floor (should be rare after 1 gwei clamp) |
| `ACCOUNT_SIGNATURE` / `ACCOUNT_VALIDATION` | Bad UserOp sig or nonce — PactoSimple7702Account needs bare ECDSA over `userOpHash` and nonce key `0` |
| `SPONSOR_INELIGIBLE` / `SPONSOR_POOL_LOW` | Missing hat/Ext permit, or deposit more ETH into the sponsor pool |
| Bootstrap checkbox disabled | Need yourself as captain (roster EVM); otherwise mint from Governance → Captain |

See [PACTO_GOV.md](./PACTO_GOV.md) and [PACTO_SQUAD_SPONSOR.md](./PACTO_SQUAD_SPONSOR.md).

---

## 2. Advanced: Squad sponsor Ext or Squad Admin alone

- [ ] **Deploy** → Advanced → **Deploy squad sponsor (Ext)** for an address-list sponsor. Confirm **allowlist owner** is the squad-assigned roster EVM and **Pay gas and deposit from** defaults to **Default signer** when Default is funded and the roster key is empty.
- [ ] On explorer: `addressOwner()` on the new clone equals the roster EVM; when Default paid, deployer ≠ owner.
- [ ] Devtools: `deploy_squad_sponsor_for_parent` (Ext) now defaults `signerWallet` to `'default'` (Default pays gas + deposit; roster EVM stays allowlist owner) — pass `signerWallet: 'squad'` to fund from the squad roster key instead.
- [ ] **Deploy** → Advanced → **Deploy Squad Admin** standalone for executor AC without Nave Pirata.
- [ ] **Treasury** → **Deploy Sponsor** opens **Deploy Governance** launchpad (pick Ext or combined hats path from there).
- [ ] When gov exists and sponsor missing: primary card **Deploy squad sponsor** (hats path via the same wizard).
- [ ] When sponsor exists but Pacto Gov is missing: Launchpad offers **Deploy Pacto Gov** recovery.

| Symptom | Likely cause |
|---------|----------------|
| `SPONSOR_CONFIG` | Missing `PACTO_SQUAD_SPONSOR_FACTORY` / paymaster / entry point |
| `SS_SquadAlreadyExists` | Same `parentId` already has a sponsor — new parent |

---

## 3. Pacto Gov / Nave Pirata (gov-only recovery)

Prefer the combined CTA. Gov-only remains available from older flows / recovery.

- [ ] Pick captain from squad members with shared EVM.
- [ ] **Governance** tab shows **Pacto Gov deployment** infra (labeled contract links); **Treasury proposals** section below.
- [ ] **Treasury** tab does **not** list the governance treasury Safe under other vaults only (gov Safe under governance treasury).
- [ ] **#announcements** shows deploy card with module addresses, top hat (Hats tree link), and deploy tx link.
- [ ] **Roles Tree** tab loads on-chain tree after deploy.
- [ ] **Roles Tree** shows **Captain** / **Crew** badges on registry hat nodes when wears exist.
- [ ] **Roles Tree** lists wearers under labeled nodes (profile name when squad EVM is shared, else short address).
- [ ] **Roles Tree** refresh icon re-fetches tree + role/wearer maps without reload.
- [ ] Reload — `pacto_gov` row present; `provider_payload` includes `txHash`.
- [ ] With roster EVM + Captain/Crew hat, Governance CTAs enable with correct reasons; without roster binding, CTAs stay disabled (“Link a squad EVM…”).
- [ ] Backend rejects hat-gated writes without the matching hat (`ACL_DENIED` / clear reason), even if UI were bypassed.

| Symptom | Likely cause |
|---------|----------------|
| `NAVE_PIRATA_CONFIG` | Missing `PACTO_NAVE_PIRATA_*` / master copies |
| Wizard blocked | No `#announcements` on parent |
| `ACL_UNBOUND` / `ACL_DENIED` | **ACL** = access control; no roster EVM for parent, or missing Captain/Crew hat — see [ACCESS_CONTROL.md](../governance/ACCESS_CONTROL.md) |

See [PACTO_GOV.md](./PACTO_GOV.md) and [ACCESS_CONTROL.md](../governance/ACCESS_CONTROL.md).

**Roles Tree unit tests:** `src/lib/governance/roles-tree-annotations.test.ts`, `src/lib/governance/hats-tree-annotations.test.ts`, `src/lib/dashboard/parent-dashboard-loaders.test.ts`.

---

## 4. Standalone Safe

Independent of sponsor or Pacto Gov. Extra vault Safes allowed alongside pacto-gov; governance treasury Safe must not duplicate as `standalone_safe`.

- [ ] **Deploy Safe** or **Import Safe** from launchpad / Treasury.
- [ ] Vault card shows **`Vault: <label>`** (not governance treasury unless intentional).
- [ ] Reload — `standalone_safe` row (skipped if address is pacto-gov treasury).

| Symptom | Likely cause |
|---------|----------------|
| `SAFE_CONFIG` | Missing `PACTO_SAFE_*` for chain |
| No roster in deploy UI | Members have not shared squad EVM on announcements |

---

## 5. Governance announce sync

After deploy: **`governance_updated`** → **`squad_infra`** on reload or second client. Pacto Gov uses **`#announcements`** (not `#personal-alerts`). No separate **`squad_safe_updated`** for the governance treasury Safe.

**Wire:** `buildAnnounceContent` with `type: "governance_updated"` — fields `parent_id`, `provider`, `canonical_ref`, `entry_id`, `chain`, `provider_payload` (v1 JSON with module addresses + `txHash`). Ingest: `maybe_upsert_governance_from_announce` in `src-tauri/src/db.rs`.

- [ ] **Single client:** deploy → note `listSquadInfra` → quit/restart → same rows and refs.
- [ ] **Two clients:** Client A deploys; Client B opens **#announcements** after MLS sync — structured Pacto Gov card + same infra without redeploy.
- [ ] **#announcements** shows card; `entry_id` matches infra row id (`pacto-gov-{parentId}`, `sponsor-{parentId}`, etc.).

| Symptom | Likely cause |
|---------|----------------|
| Row gone after reload | Deploy skipped `upsertSquadInfra` / finalize |
| Second client empty | Not in MLS group or announcements channel |
| Duplicate rows | Same deploy, different `entry_id` |

Payload shape tests: `src/lib/governance/governance-announce-payload.test.ts`, `src/lib/governance/pacto-gov-deploy-announce.test.ts`.

---

## 6. Advanced contract call

Settings → Profile → Wallet → **Advanced contract call**. Requires **advanced-purpose** signer (import or **Add advanced account**).

- [ ] `readContract` via `src/lib/evm/read-plane.ts` + `erc20-minimal` ABI — no key.
- [ ] Advanced send: simulate → review → tx mines; banner shows **not linked to any squad**.
- [ ] Squad signer only → **`ADVANCED_SIGNER_REQUIRED`**.
- [ ] Roster share rejects advanced-purpose address.
- [ ] Reverting calldata → simulate shows revert.

See [RPC_AND_VIEM_ARCHITECTURE.md](./RPC_AND_VIEM_ARCHITECTURE.md).

---

## 7. Squad contract allowlist

Settings no longer exposes allowlist or contract-call UI. Backend list/upsert/send and MLS `squad_contract_allowlist_updated` ingest still exist.

- [ ] Advanced panel still sends arbitrary `to`; squad command refuses advanced signer.

---

## 8. Personal alerts & per-squad roster keys

Requires **squad-purpose** vs **advanced-purpose** signers. Two test accounts helpful.

**Sidebar label**

- [ ] Sidebar **`#personal-alerts`** (not `#monitor`); automation still in the personal-alerts timeline (wire bucket `inbox`).

**Join key choice (personal-alerts card, not DM Share / Not now)**

- [ ] **Default squad signer** → roster row matches active squad signer; global active unchanged.
- [ ] **New key for this squad** → new derived account bound; global active unchanged; DM Send unchanged.
- [ ] **Defer** → no roster until card completed.
- [ ] Create path does not auto-share without personal-alerts choice.
- [ ] After create (or invite join), peer **Request sync** / auto catch-up: unbound member must **not** emit `squad_member_evm_share`; Alerts card still shows; infra/network still sync.
- [ ] After bind (default or new key): one intentional `#announcements` share; Alerts card clears; Crew shows bound address for self.

**Deploy & air-gap**

- [ ] Curated deploy (e.g. Safe) uses **roster-bound** address when it differs from global active; unbound deploy stays fail-closed (no WalletBar invent).
- [ ] Advanced address still rejected on roster ingest; Advanced panel unrelated to roster.

See **Personal alerts & per-squad roster keys** above.

---

## 9. Join inbox (Commons)

Two accounts helpful: **requester** (not in squad) and **holder** (creator or added holder with local bot secret).

**Bot holders**

- [ ] **Dashboard → Settings → Join inbox holders** shows Join inbox npub, epoch, holder list.
- [ ] Creator is initial holder after squad create (Commons on path runs `initJoinInbox`).
- [ ] Holder adds a second MLS member → key share DM arrives → second device shows **Holds bot key**.
- [ ] Remove holder → remaining holders see **#personal-alerts** rotate prompt; **Rotate bot key** posts **#announcements** notice and rebroadcasts new bot npub on next Commons publish.

**Squad Admin gate (when deployed)**

- [ ] With Squad Admin live, only roster EVM with **Full** executor scope may add/remove/rotate holders.
- [ ] Holder without Full scope sees read-only holder list + hint.

**Commons → join → accept**

- [ ] Squad Commons card **Request to join** sends `pacto.squad.join_inbox_dm.v1` NIP-17 to bot npub.
- [ ] Holder opens **#join-requests** → refresh → pending row appears (bot DM fan-out to MLS).
- [ ] **Accept** → MLS first-write-wins + invite DM to requester; requester gets private `pacto.squad.join_inbox_response.v1` DM.
- [ ] **Reject** → MLS reject + private response DM to requester.
- [ ] **Mute** on a row suppresses re-fan-out for that requester npub (local per squad).

**Spam / abuse (v1)**

- [ ] Non-join bot DMs are ignored during sync (no MLS fan-out).
- [ ] Existing MLS members are not re-fanned from bot inbox.
- [ ] Repeat join DMs from same requester dedupe to one pending row.

See [`../communities/JOIN_INBOX.md`](../communities/JOIN_INBOX.md).

---

## 10. Username NFT (global / bootstrap sponsor)

Account-global username claim + address rotation on Sepolia. **Gas path (pacto-app):** bootstrap → EOA → global member → fail. **No squad sponsor** on this path — do not confuse with §1 “Bootstrap crew” (gov hats / squad paymaster). Upstream [DESKTOP_CLIENT_INTEGRATION.md](https://github.com/covenant-gov/pacto-username-nft/blob/main/docs/DESKTOP_CLIENT_INTEGRATION.md) still diagrams a squad arm; pacto-app intentionally diverges (see [USERNAME_NFT.md](./USERNAME_NFT.md)).

Addresses live under `networks.sepolia.globalUsernameSponsor` in [`pacto-protocol-addresses.json`](../../src/lib/evm/pacto-protocol-addresses.json) ([PROTOCOL_ADDRESS_BOOK.md](./PROTOCOL_ADDRESS_BOOK.md)). After address-book changes, **fully restart** Tauri.

**After a full-system username-nft redeploy:** pin the new `full-system.json`, fund pools/PM, then require harness SUCCESS before calling cutover done — [SPONSORED_USEROP_7702.md](./SPONSORED_USEROP_7702.md) + [pacto-username-nft#5](https://github.com/covenant-gov/pacto-username-nft/issues/5).

### Ops fund (once per environment)

Pools and paymaster are **separate** from squad sponsor § prerequisites.

```bash
# BootstrapMintPool
cast send 0x95d3B8B97C4ff48af010191E80CcAA9F55749A2B "deposit()" \
  --value 1ether --rpc-url "$SEPOLIA_RPC" --private-key "$OPS_KEY"

# GlobalSponsorPool
cast send 0x4EfeE104cF969bF70F342DFCd234f73A3bebEbeD "deposit()" \
  --value 1ether --rpc-url "$SEPOLIA_RPC" --private-key "$OPS_KEY"

# Confirm spendable (non-zero before sponsored UI smoke)
cast call 0x95d3B8B97C4ff48af010191E80CcAA9F55749A2B "spendablePoolWei()(uint256)" --rpc-url "$SEPOLIA_RPC"
cast call 0x4EfeE104cF969bF70F342DFCd234f73A3bebEbeD "spendablePoolWei()(uint256)" --rpc-url "$SEPOLIA_RPC"
```

**PactoGlobalPaymaster** `0x04Fc205adA4c0c5C5024546E87972C4c4bB30D0F`: fund EntryPoint deposit (+ stake if required) via upstream pacto-username-nft `pnpm fund:paymaster:sepolia` (see that repo’s §10). EIP-7702 **activation** gas is ops-funded separately — not drawn from either pool.

Also: Pimlico / bundler (shared prerequisites above); backup verified in-app before claim/rotate.

### Happy path

- [ ] `globalUsernameSponsor` pinned (`pactoUsernameNft` `0x09e08dB9…`, `protocolRegistry` `0xAF6119…`, `allowed7702Implementation` `0x2E9156de…`, `policyVersion` **3**); Tauri restarted if the JSON changed.
- [ ] Bootstrap + global pools funded; global paymaster EntryPoint deposit OK; bundler curl passes.
- [ ] Smoke identity: roster/primary EVM with **0 ETH** (sponsored paths); logged in, wallet unlocked, backup verified.
- [ ] **Commons** → **Pacto Early Adopter** CTA → deep-links to Profile `#settings-profile-username` (no mint UI on Commons).
- [ ] **Claim** any non-empty name (≤64 UTF-8 bytes, case-sensitive) with 0 ETH → path **`bootstrap`**; UserOp on explorer; bootstrap pool spendable decreases.
- [ ] **Badge:** Profile / Commons show `@username` with verified check when kind **31337** link is cached **and** on-chain `recordOf` EVM matches the active roster address.
- [ ] **Rotation:** initiate address transfer → claim transfer with 0 ETH → path **`global_member`** (not bootstrap); global pool spendable decreases.
- [ ] Optional: claim or rotate with funded EOA → path **`eoa`** (no UserOp).

### Regressions

- [ ] §1 squad sponsor still works on a throwaway squad — username writes never use squad pools / squad paymaster.
- [ ] After mint, another bootstrap claim (or bootstrap-lane UserOp) fails (`npubOf != 0` / `BOOTSTRAP_AFTER_MINT`).
- [ ] Member path rejects `claim()` selector `0x9824550d` (`CLAIM_ON_MEMBER_PATH`) — unit coverage in `global_sponsor_userop` / `pacto_actions`; live attempt not required if CI green.

| Symptom | Likely cause |
|---------|----------------|
| `USERNAME_SPONSOR_CONFIG` | Missing / stale `globalUsernameSponsor` in address book — restart Tauri after pin |
| Claim disabled / path fail with 0 ETH | Bootstrap pool empty or `canBootstrapClaim` false — fund `0x8187…`, check name + npub eligibility |
| `USERNAME_POOL_LOW` / empty spendable | Fund the matching pool (`deposit()`); paymaster needs ~115% headroom |
| `PAYMASTER_DEPOSIT_LOW` / validation fail on UserOp | Fund **global** paymaster EntryPoint deposit — not the squad paymaster |
| `BOOTSTRAP_AFTER_MINT` | Already minted on this EVM — use EOA or global member for further writes |
| `CLAIM_ON_MEMBER_PATH` | Client tried `claim()` on member lane — claim is bootstrap-only |
| `USERNAME_POLICY_STALE` | Catalog `policyVersion` ≠ on-chain registry (expect **3** on Sepolia) |
| `SPONSOR_PATH_UNAVAILABLE` / `BUNDLER_CONFIG` | Save Pimlico on Status (or `PIMLICO_API_KEY` / `BUNDLER_RPC_URL`) |
| `GOV_CALL_REVERTED` / vague simulation toast | Bundler reject detail is on process stderr as `[pacto_wallet] bundler …` (demo: `make logs LOG_CLIENT=<n>` for the client that ran the write). Empty `reason: 0x` → check preceding `[pacto_wallet] username UserOp … eip7702_auth=` / `code_len=` lines and any `claim eth_call preflight` selector — not another bootstrap pool deposit |
| `USERNAME_CLAIM_REVERTED` / `USERNAME_INVALID_*` / `USERNAME_BINDING_EXPIRED` | Direct `claim()` eth_call failed — fix claim fields/signatures / use chain `issuedAt` before blaming UserOp/7702. See [SPONSORED_USEROP_7702.md](./SPONSORED_USEROP_7702.md) L1 |
| `USERNAME_7702_MISMATCH` / `USERNAME_7702_SENDER` | Paymaster allowlist ≠ client impl, or roster EOA has unexpected code (wrong 7702 stub / non-delegation bytecode) |
| Verified badge missing after mint | Kind 31337 missing or `record.evmAddress` ≠ active roster EVM — refresh claim cache / check relays |
| Squad pool drained on username claim | Bug — username must not call squad sponsor; file with UserOp paymaster address |

See [USERNAME_NFT.md](./USERNAME_NFT.md) and upstream [DESKTOP_CLIENT_INTEGRATION.md](https://github.com/covenant-gov/pacto-username-nft/blob/main/docs/DESKTOP_CLIENT_INTEGRATION.md).

---

## DM wallet (non-governance)

Basic send/request/announcement flow: [MANUAL_E2E_CHECKLIST.md](./MANUAL_E2E_CHECKLIST.md).
