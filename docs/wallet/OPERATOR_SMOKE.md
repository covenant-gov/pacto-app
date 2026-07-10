# Wallet & governance — operator smoke (Sepolia)

Single checklist for manual Sepolia verification on **desktop (Tauri)**.

## Shared prerequisites

- [ ] Copy [`.env.example`](../../.env.example) → `.env` (or export before `tauri dev`) for **RPC**.
- [ ] Set **`ALCHEMY_RPC_KEY`** (builds Sepolia and other chain URLs automatically). Protocol factory addresses ship in [`pacto-protocol-addresses.json`](../../src/lib/evm/pacto-protocol-addresses.json) — see [`PROTOCOL_ADDRESS_BOOK.md`](./PROTOCOL_ADDRESS_BOOK.md).
- [ ] Logged-in profile with **Sepolia ETH**; wallet unlocked.
- [ ] Test squad/network with **`#announcements`** and **`#personal-alerts`**; use a **throwaway `parentId`** (one sponsor clone per parent on-chain).
- [ ] Devtools helpers live in `src/lib/governance/api.ts`, `src/lib/wallet/backend-wallet.ts` — prefer in-app wizards when available.

**Deploy order:** sponsor → Pacto Gov / vault Safe → announce sync. Advanced panel and allowlist tests need squad infra where noted.

---

## 1. Squad sponsor

- [ ] **#dashboard** → **Deploy** → **Deploy squad sponsor** (Sepolia).
- [ ] **Treasury** shows pool balance; optional deposit.
- [ ] Reload — `sponsor` infra row persists (`listSquadInfra`).

| Symptom | Likely cause |
|---------|----------------|
| `SPONSOR_CONFIG` | Missing `PACTO_SQUAD_SPONSOR_FACTORY` / paymaster / entry point |
| `SS_SquadAlreadyExists` | Same `parentId` already has a sponsor — new parent |
| `SPONSOR_REQUIRED` on later deploys | Run sponsor first |

See [PACTO_SQUAD_SPONSOR.md](./PACTO_SQUAD_SPONSOR.md).

---

## 2. Pacto Gov / Nave Pirata

Requires **sponsor** for same `parentId`.

- [ ] **Deploy** → **Set up Pacto Gov**; pick captain from squad members with shared EVM.
- [ ] **Governance** tab shows **Pacto Gov deployment** infra (labeled contract links); **Treasury proposals** section below.
- [ ] **Treasury** tab does **not** list the governance treasury Safe (vault Safes + sponsor only).
- [ ] **#announcements** shows deploy card with module addresses, top hat (Hats tree link), and deploy tx link.
- [ ] **Roles Tree** tab loads on-chain tree after deploy.
- [ ] **Roles Tree** shows **Captain** / **Crew** badges on registry hat nodes when wears exist.
- [ ] **Roles Tree** lists wearers under labeled nodes (profile name when squad EVM is shared, else short address).
- [ ] **Roles Tree** refresh icon re-fetches tree + role/wearer maps without reload.
- [ ] Reload — `pacto_gov` row present; `provider_payload` includes `txHash`.

| Symptom | Likely cause |
|---------|----------------|
| `SPONSOR_REQUIRED` | Sponsor not deployed |
| `NAVE_PIRATA_CONFIG` | Missing `PACTO_NAVE_PIRATA_*` / master copies |
| Wizard blocked | No `#announcements` on parent |

See [PACTO_GOV.md](./PACTO_GOV.md).

**Roles Tree unit tests:** `src/lib/governance/roles-tree-annotations.test.ts`, `src/lib/governance/hats-tree-annotations.test.ts`, `src/lib/dashboard/parent-dashboard-loaders.test.ts`.

---

## 3. Standalone Safe

Requires **sponsor**. Extra vault Safes allowed alongside pacto-gov; governance treasury Safe must not duplicate as `standalone_safe`.

- [ ] **Deploy Safe** or **Import Safe** from launchpad / Treasury.
- [ ] Vault card shows **`Vault: <label>`** (not governance treasury unless intentional).
- [ ] Reload — `standalone_safe` row (skipped if address is pacto-gov treasury).

| Symptom | Likely cause |
|---------|----------------|
| `SPONSOR_REQUIRED` | Sponsor first |
| `SAFE_CONFIG` | Missing `PACTO_SAFE_*` for chain |
| No roster in deploy UI | Members have not shared squad EVM on announcements |

---

## 4. Governance announce sync

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

## 5. Advanced contract call

Settings → Profile → Wallet → **Advanced contract call**. Requires **advanced-purpose** signer (import or **Add advanced account**).

- [ ] `readContract` via `src/lib/evm/read-plane.ts` + `erc20-minimal` ABI — no key.
- [ ] Advanced send: simulate → review → tx mines; banner shows **not linked to any squad**.
- [ ] Squad signer only → **`ADVANCED_SIGNER_REQUIRED`**.
- [ ] Roster share rejects advanced-purpose address.
- [ ] Reverting calldata → simulate shows revert.

See [RPC_AND_VIEM_ARCHITECTURE.md](./RPC_AND_VIEM_ARCHITECTURE.md).

---

## 6. Squad contract allowlist

Dashboard → Settings → **Smart contract security**. Pacto Gov deployed; **squad-purpose** active signer.

- [ ] **Add contract** → row + **`squad_contract_allowlist_updated`** on **#personal-alerts**; **Remove** announces delete.
- [ ] Allowlisted target: simulate + **Send (squad key)** mines; other `0x` → **`TARGET_NOT_ALLOWLISTED`**.
- [ ] Advanced panel still sends arbitrary `to`; squad command refuses advanced signer.

---

## 7. Personal alerts & per-squad roster keys

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

## 8. Squad bot join inbox (Commons)

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
