# Wallet & governance — operator smoke (Sepolia)

Single checklist for manual Sepolia verification on **desktop (Tauri)**.

## Shared prerequisites

- [ ] Copy [`.env.example`](../../.env.example) → `.env` (or export before `tauri dev`) for **RPC**.
- [ ] Set **`ALCHEMY_RPC_KEY`** (builds Sepolia and other chain URLs automatically). Protocol factory addresses ship in [`pacto-protocol-addresses.json`](../../src/lib/evm/pacto-protocol-addresses.json) — see [`PROTOCOL_ADDRESS_BOOK.md`](./PROTOCOL_ADDRESS_BOOK.md).
- [ ] For **sponsored** gov writes (roster 0 ETH): set **`BUNDLER_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<ALCHEMY_RPC_KEY>`** (same Alchemy app). EIP-7702 impl is pinned in the address book (`erc4337.accountImplementation`); override with `PACTO_ERC4337_ACCOUNT_IMPL` only for experiments. See [PACTO_SQUAD_SPONSOR.md](./PACTO_SQUAD_SPONSOR.md).
- [ ] Smoke identities: **funded Default (DM)** for deploy/deposit gas; **new empty roster key** (0 ETH) as captain after gov+sponsor; enough Sepolia ETH to **seed the sponsor pool**; throwaway `parentId`.
- [ ] Logged-in profile; wallet unlocked.
- [ ] Test squad/network with **`#announcements`** and **`#personal-alerts`**; use a **throwaway `parentId`** (one sponsor clone per parent on-chain).
- [ ] Devtools helpers live in `src/lib/governance/api.ts`, `src/lib/wallet/backend-wallet.ts` — prefer in-app wizards when available.

### Bundler quick check (once per Alchemy key)

```bash
curl -sS "$BUNDLER_RPC_URL" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_supportedEntryPoints","params":[]}'
# expect …71727De22E5E9d8BAf0edAc6f37da032… (EntryPoint v0.7)
```

**Deploy order (default):** Pacto Gov + hats squad sponsor (combined Launchpad CTA; optional crew bootstrap) → announce sync. **Advanced:** Squad sponsor **Ext** (allowlist owner = squad roster EVM; gas + deposit may come from **Default**) or Squad Admin alone without Pacto Gov. If gov exists and sponsor is missing, the same combined wizard finishes hats sponsor only. **Treasury** and **Governance** **Deploy** / **Deploy Sponsor** open the same **Deploy Governance** launchpad (not the combined wizard directly).

---

## 1. Pacto Gov + squad sponsor (default)

- [ ] **#dashboard** → **Deploy** → **Deploy Pacto Gov + squad sponsor**; pick captain (any member’s squad-assigned EVM), deposit, optional bootstrap crew.
- [ ] **Privacy + funded Default:** bind a **new squad key** (empty), keep Default (DM) funded → wizard **Pay gas and deposit from → Default signer** → captain = yourself → confirm Default has **no** captain hat. Bootstrap is **enabled** (mint signed by roster; sponsored UserOp when roster has 0 ETH and bundler/7702 are configured).
- [ ] **0 ETH roster + funded pool (sponsored bootstrap):** after deploy with empty roster key + funded sponsor deposit, **Bootstrap crew** (wizard or Governance → Captain) succeeds; pool balance decreases; bundler accepts the UserOp.
- [ ] **Squad-key deployer + self as captain:** pay from squad-assigned signer, captain = yourself → Bootstrap enabled; Roles tree **Crew** shows wearers after deploy (self-funded EOA path when roster has ETH).
- [ ] **Governance** / **Roles** / **Treasury** (sponsor + gov Safe) look healthy after both txs.
- [ ] Optional: Status checklist **Mint all members a Crew hat** completes after bootstrap (or Captain bootstrap later).

| Symptom | Likely cause |
|---------|----------------|
| `SPONSOR_CONFIG` / `NAVE_PIRATA_CONFIG` | Missing factory / registry / paymaster in address book |
| `SS_SquadAlreadyExists` / `ALREADY_DEPLOYED` | Same `parentId` already has sponsor or gov — new parent |
| Sponsor step fails after gov | Finish with Launchpad → **Deploy squad sponsor** (same wizard, hats path) |
| Roster key has 0 ETH | Pay deploy from **Default signer**; gov writes use sponsored UserOp when eligible |
| `SPONSOR_PATH_UNAVAILABLE` / `BUNDLER_CONFIG` | Set `BUNDLER_RPC_URL` + `erc4337.accountImplementation` in the address book, or fund the roster key |
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
| `ACL_UNBOUND` / `ACL_DENIED` | No roster EVM for parent, or missing Captain/Crew hat — see [ACCESS_CONTROL.md](../governance/ACCESS_CONTROL.md) |

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

Dashboard → Settings → **Smart contract security**. Pacto Gov deployed; **squad-purpose** active signer.

- [ ] **Add contract** → row + **`squad_contract_allowlist_updated`** on **#personal-alerts**; **Remove** announces delete.
- [ ] Allowlisted target: simulate + **Send (squad key)** mines; other `0x` → **`TARGET_NOT_ALLOWLISTED`**.
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

**Deploy & air-gap**

- [ ] Curated deploy (e.g. Safe) uses **roster-bound** address when it differs from global active.
- [ ] Advanced address still rejected on roster ingest; Advanced panel unrelated to roster.

See **Personal alerts & per-squad roster keys** above.

---

## 9. Squad bot join inbox (Commons)

Two accounts helpful: **requester** (not in squad) and **holder** (creator or added holder with local bot secret).

**Bot holders**

- [ ] **Dashboard → Settings → Join inbox / Bot key holders** shows bot npub, epoch, holder list.
- [ ] Creator is initial holder after squad create (Commons on path runs `initSquadBot`).
- [ ] Holder adds a second MLS member → key share DM arrives → second device shows **Holds bot key**.
- [ ] Remove holder → remaining holders see **#personal-alerts** rotate prompt; **Rotate bot key** posts **#announcements** notice and rebroadcasts new bot npub on next Commons publish.

**Squad Admin gate (when deployed)**

- [ ] With Squad Admin live, only roster EVM with **Full** executor scope may add/remove/rotate holders.
- [ ] Holder without Full scope sees read-only holder list + hint.

**Commons → join → accept**

- [ ] Squad Commons card **Request to join** sends `pacto.squad.bot_join_dm.v1` NIP-17 to bot npub.
- [ ] Holder opens **#join-requests** → refresh → pending row appears (bot DM fan-out to MLS).
- [ ] **Accept** → MLS first-write-wins + invite DM to requester; requester gets private `pacto.squad.bot_join_response.v1` DM.
- [ ] **Reject** → MLS reject + private response DM to requester.
- [ ] **Mute** on a row suppresses re-fan-out for that requester npub (local per squad).

**Spam / abuse (v1)**

- [ ] Non-join bot DMs are ignored during sync (no MLS fan-out).
- [ ] Existing MLS members are not re-fanned from bot inbox.
- [ ] Repeat join DMs from same requester dedupe to one pending row.

See [`../communities/SQUAD_BOT_JOIN.md`](../communities/SQUAD_BOT_JOIN.md).

---

## DM wallet (non-governance)

Basic send/request/announcement flow: [MANUAL_E2E_CHECKLIST.md](./MANUAL_E2E_CHECKLIST.md).
