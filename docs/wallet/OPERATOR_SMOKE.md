# Wallet & governance — operator smoke (Sepolia)

Single checklist for manual Sepolia verification on **desktop (Tauri)**. Execution plan and phase labels: [`ai-docs/INHOUSE_GOV.md`](../../ai-docs/INHOUSE_GOV.md). Post–step 17 regression matrix: [`ai-docs/STEP17_POST_CLEANUP.md`](../../ai-docs/STEP17_POST_CLEANUP.md) (T0–T2).

## Shared prerequisites

- [ ] Copy [`.env.example`](../../.env.example) → `.env` (or export before `tauri dev`) for **RPC**.
- [ ] Set **`ALCHEMY_RPC_KEY`** (builds Sepolia and other chain URLs automatically). Protocol factory addresses ship in [`pacto-protocol-addresses.json`](../../src/lib/evm/pacto-protocol-addresses.json) — see [`PROTOCOL_ADDRESS_BOOK.md`](./PROTOCOL_ADDRESS_BOOK.md).
- [ ] Logged-in profile with **Sepolia ETH**; wallet unlocked.
- [ ] Test squad/network with **`#announcements`** and **`#inbox`**; use a **throwaway `parentId`** (one sponsor clone per parent on-chain).
- [ ] Devtools helpers live in `src/lib/governance/api.ts`, `src/lib/wallet/backend-wallet.ts` — prefer in-app wizards when available.

**Deploy order:** sponsor → Pacto Gov / vault Safe → announce sync. Advanced panel and allowlist tests need squad infra where noted.

---

## 1. Squad sponsor (A1)

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

## 2. Pacto Gov / Nave Pirata (A2)

Requires **sponsor** for same `parentId`.

- [ ] **Deploy** → **Set up Pacto Gov**; captain = embedded wallet, metadata URI set.
- [ ] **Governance** + **Treasury** (`Governance: Treasury`); **Roles Tree** loads.
- [ ] Explorer: `NavePirataDeployed` log; `topHatId` / Safe match infra `provider_payload`.
- [ ] Reload — `pacto_gov` row present.

| Symptom | Likely cause |
|---------|----------------|
| `SPONSOR_REQUIRED` | Sponsor not deployed |
| `NAVE_PIRATA_CONFIG` | Missing `PACTO_NAVE_PIRATA_*` / master copies |
| Wizard blocked | No `#announcements` on parent |

See [PACTO_GOV.md](./PACTO_GOV.md).

---

## 3. Standalone Safe (A3)

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

## 4. Governance announce sync (A4)

After any deploy: **`governance_updated`** (and **`squad_safe_updated`** for treasury links) → **`squad_infra`** on reload or second client.

**Wire:** `buildAnnounceContent` with `type: "governance_updated"` — fields `parent_id`, `provider`, `canonical_ref`, `entry_id`, `chain`, `provider_payload`. Ingest: `maybe_upsert_governance_from_announce` in `src-tauri/src/db.rs`.

- [ ] **Single client:** deploy → note `listSquadInfra` → quit/restart → same rows and refs.
- [ ] **Two clients:** Client A deploys; Client B opens **#dashboard** after MLS sync — same infra without redeploy.
- [ ] Inbox shows announce; `entry_id` matches infra row id (`sponsor-{parentId}`, `pacto-gov-{parentId}`, etc.).

| Symptom | Likely cause |
|---------|----------------|
| Row gone after reload | Deploy skipped `upsertSquadInfra` / finalize |
| Second client empty | Not in MLS group or announcements channel |
| Duplicate rows | Same deploy, different `entry_id` |

Payload shape tests: `src/lib/governance/governance-announce-payload.test.ts`.

---

## 5. Advanced contract call (H10)

Settings → Profile → Wallet → **Advanced contract call**. Requires **advanced-purpose** signer (import or **Add advanced account**).

- [ ] `readContract` via `src/lib/evm/read-plane.ts` + `erc20-minimal` ABI — no key.
- [ ] Advanced send: simulate → review → tx mines; banner shows **not linked to any squad**.
- [ ] Squad signer only → **`ADVANCED_SIGNER_REQUIRED`**.
- [ ] Roster share rejects advanced-purpose address.
- [ ] Reverting calldata → simulate shows revert.

See [RPC_AND_VIEM_ARCHITECTURE.md](./RPC_AND_VIEM_ARCHITECTURE.md), [`ai-docs/EVM_INTEGRATION_LAYERS.md`](../../ai-docs/EVM_INTEGRATION_LAYERS.md).

---

## 6. Squad contract allowlist (I12)

Dashboard → Settings → **Smart contract security**. Pacto Gov deployed; **squad-purpose** active signer.

- [ ] **Add contract** → row + **`squad_contract_allowlist_updated`** on **#inbox**; **Remove** announces delete.
- [ ] Allowlisted target: simulate + **Send (squad key)** mines; other `0x` → **`TARGET_NOT_ALLOWLISTED`**.
- [ ] Advanced panel still sends arbitrary `to`; squad command refuses advanced signer.

---

## 7. Inbox & per-squad roster keys (step 17 / G′)

Requires Phase **G** (squad vs advanced accounts). Two test accounts helpful.

**Inbox rename**

- [ ] Sidebar **`#inbox`** (not `#monitor`); automation still in Inbox timeline.

**Join key choice (Inbox card, not DM Share / Not now)**

- [ ] **Default squad signer** → roster row matches active squad signer; global active unchanged.
- [ ] **New key for this squad** → new derived account bound; global active unchanged; DM Send unchanged.
- [ ] **Defer** → no roster until card completed.
- [ ] Create path does not auto-share without Inbox choice.

**Deploy & air-gap**

- [ ] Curated deploy (e.g. Safe) uses **roster-bound** address when it differs from global active.
- [ ] Advanced address still rejected on roster ingest; Advanced panel unrelated to roster.

See [`ai-docs/INHOUSE_GOV.md`](../../ai-docs/INHOUSE_GOV.md) step **17**.

---

## DM wallet (non-governance)

Basic send/request/announcement flow: [MANUAL_E2E_CHECKLIST.md](./MANUAL_E2E_CHECKLIST.md).
