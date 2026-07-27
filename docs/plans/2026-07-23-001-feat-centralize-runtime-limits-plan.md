---
title: Centralize Runtime Limits and Feature Flags in AppConfig
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
created_at: 2026-07-23
topic: centralize runtime limits and feature flags in a type-safe AppConfig
execution: code
---

# Centralize Runtime Limits and Feature Flags in AppConfig - Plan

## Goal Capsule

- **Objective:** Ship a backend-owned, frontend-validated `AppConfig` that replaces scattered hardcoded limits with a single source of truth, and proves the mechanism with one experimental feature flag.
- **Product authority:** Rust defines the values; the Svelte frontend consumes them through Tauri IPC and validates them with a runtime schema.
- **Open blockers:** None.

## Product Contract

### Summary

Add a Rust `AppConfig` struct and a `get_app_config` Tauri command, expose a frontend Svelte store fed by a Zod-validated IPC call, and migrate the listed frontend limits (and related hardcoded caps found nearby) to read from the store. Include one concrete feature flag — an analytics collection toggle — as a proof-of-concept. Malformed or unreachable backend responses fall back to compiled defaults and surface an error toast.

### Problem Frame

Limits and feature flags are currently split across HTML `maxlength` attributes, inline numbers in Svelte components, and Rust constants. Examples found in the codebase today:

- Squad and channel name lengths are not enforced by a shared value.
- `DeploySafeModal` imports `DEPLOY_SAFE_MAX_SIGNERS = 10` from a frontend TS module (`src/lib/treasury/treasury-safes.ts`).
- `CommonsTagPicker` and squad creation flows hardcode a tag cap of `3`.
- `src-tauri/src/commons.rs` separately defines `MAX_TAGS: usize = 3`.
- Several other `maxlength` values (role labels, wallet account labels, token symbols, PIN digits) are hardcoded in components.

This makes it easy for the frontend and backend to disagree, and forces every limit change to touch multiple files. There is also no place to toggle experimental behavior without editing source.

### Key Decisions

- KTD1. **Backend defines, frontend consumes.** Rust is the source of truth for limits and flags; the frontend fetches `AppConfig` once on boot and validates the payload with Zod. Governs R1, R2, R3, R7.
- KTD2. **Compiled constants for v1.** AppConfig values are constants compiled into the Rust binary. Runtime file reloading is out of scope; it can be added later without changing the IPC contract. Governs R1.
- KTD3. **Proof-of-concept feature flag: analytics collection toggle.** One concrete boolean flag ships in v1 so the flag path is exercised end-to-end, even if no consumer reads it yet. Governs R6.
- KTD4. **Degrade to compiled defaults with an error toast.** If the backend response is missing, malformed, or fails Zod validation, the frontend uses safe compiled defaults, shows an error toast, and proceeds. Governs R4.
- KTD5. **Backend enforces limits where it already gates writes.** `create_group_chat` and related commands should reject inputs that exceed the configured limits, matching the values exposed in `AppConfig`. Governs R5.
- KTD6. **Scope extends to nearby hardcoded caps.** In addition to the four issue-listed limits, v1 also migrates role-label maxlength, wallet-account-label maxlength, custom-token-symbol maxlength, and PIN-digit maxlength to the config store. Governs R8.

### Requirements

#### AppConfig contract

- R1. Rust exposes a `get_app_config` Tauri command that returns a serializable `AppConfig` value containing all configured limits and feature flags. Values are defined as constants in the Rust source for v1.
- R2. The frontend defines a Zod schema that mirrors the `AppConfig` shape and validates the command response before storing it.
- R3. The app fetches `AppConfig` automatically during boot and exposes it through a Svelte store.
- R4. If validation fails or the command errors, the app falls back to compiled frontend defaults and shows one error toast describing that defaults are in use.
- R5. Rust commands that already validate input lengths (e.g., `create_group_chat`) reject inputs that exceed the corresponding `AppConfig` limit.

#### Feature flags

- R6. `AppConfig` includes a boolean `analyticsEnabled` flag as the proof-of-concept feature flag. The flag is exposed through the same store as limits. Consumers may read it; wiring it to a specific analytics initializer is not required for v1.

#### Limits migrated to the config store

- R7. The following components read their relevant limit from the `AppConfig` store instead of a hardcoded value:
  - `Navbar.svelte` — squad name max length.
  - `CreateChannelModal.svelte` — channel name max length.
  - `CommonsTagPicker.svelte` / squad creation and broadcast flows — max Commons tag count.
  - `DeploySafeModal.svelte` — max Safe signers.
- R8. The following additional hardcoded caps are also migrated to the store:
  - `SquadRolesModal.svelte` — role label max length.
  - `WalletView.svelte` — wallet account label max length.
  - `WalletImportTokensModal.svelte` — custom token symbol max length.
  - `PinInput.svelte`, `EvmAccountKeyExportModal.svelte`, and `ExportAllSecretsModal.svelte` — PIN digit count.

#### Quality gates

- R9. `cargo check --all-features` passes with no new errors.
- R10. `pnpm check` passes with no new errors.
- R11. Existing tests that mock Tauri IPC continue to pass after the new command is added.

### Actors

- **End user** — benefits from consistent limits and safer defaults.
- **Developer / release engineer** — changes limits in one Rust location.
- **Product / ops** — flags readiness for toggling experimental behavior once runtime config loading is available; v1 toggles require a release engineer because values are compiled constants.

### Key Flows

- F1. Boot config load
  - **Trigger:** App starts.
  - **Actors:** Frontend boot code, Rust backend.
  - **Steps:**
    1. Frontend calls `get_app_config`.
    2. Backend returns `AppConfig` serialized from compiled constants.
    3. Frontend validates with Zod and populates the store.
    4. If validation or the IPC call fails, the store is populated from compiled defaults and an error toast is shown.
  - **Outcome:** All downstream consumers read limits/flags from the store.

- F2. Limit-gated creation flow (e.g., create channel)
  - **Trigger:** User submits a create-channel form.
  - **Actors:** User, `CreateChannelModal`, frontend config store, Rust backend.
  - **Steps:**
    1. Modal reads `channelNameMaxLength` from the store and applies it to the input via `maxlength` and/or JS validation.
    2. On submit, the backend command validates the trimmed name against the same limit and returns a descriptive error if it exceeds the limit.
    3. The modal surfaces the returned error in its existing inline error or form error surface.
  - **Outcome:** Rejected names fail early on the frontend and are also rejected by the backend if they bypass the UI; the user sees the same error message in both cases.

### Acceptance Examples

- AE1. Boot with a malformed backend response
  - **Covers:** R1, R2, R4.
  - **Given:** A dev build where `get_app_config` returns an extra field type or a missing required limit.
  - **When:** The app boots.
  - **Then:** The error toast appears, the store uses compiled defaults, and limit-gated inputs still use the default values.

- AE2. Deploy Safe signer cap
  - **Covers:** R7.
  - **Given:** `AppConfig` exposes `deploySafeMaxSigners: 10`.
  - **When:** A user opens `DeploySafeModal` and selects more than 10 signers.
  - **Then:** The UI disables creation and shows the existing "At most 10 owners" message.

- AE3. Commons tag cap
  - **Covers:** R7.
  - **Given:** `AppConfig` exposes `commonsMaxTags: 3`.
  - **When:** A user creating a public squad or Commons broadcast has selected 3 tags.
  - **Then:** The tag picker shows the max-reached hint and refuses to add a fourth tag.

- AE4. Backend rejects an over-limit squad name
  - **Covers:** R5, R7.
  - **Given:** `AppConfig` exposes `squadNameMaxLength: 50` and a client sends a 60-character trimmed name.
  - **When:** `create_group_chat` (or the relevant squad-creation command) receives the name.
  - **Then:** The command returns an error without creating the group, and the originating modal surfaces that error to the user.

### Scope Boundaries

- **In scope:**
  - `AppConfig` struct, `get_app_config` command, frontend store, Zod schema.
  - Migrating the issue-listed limits and the additional hardcoded `maxlength` caps found in the scan.
  - One proof-of-concept feature flag (`analyticsEnabled`).
  - Backend enforcement for limits that already gate writes.
  - Error-toast fallback on config load/validation failure.

- **Deferred for later:**
  - Runtime file-based config or hot-reloading.
  - Additional feature flags beyond the analytics toggle.
  - Admin UI for editing flags/limits.
  - Network- or build-flavor-specific config overrides.
  - If runtime config loading is added later, the loader must include strict range validation for every limit and flag to prevent misconfiguration or DoS (e.g., a zero or extremely large limit).

- **Outside this product's identity:**
  - Changing the actual numeric values of limits (the goal is centralization, not policy changes).
  - Replacing backend business-rule validation that is not tied to these limits.

### How This Work Fits Together

This plan owns the first AppConfig implementation: the IPC contract, the validated store, and migrating the listed limits/flags. It does not own a broader feature-flag management surface or runtime config reloading. Those are contextual candidates for later plans and can proceed independently once the AppConfig store exists.

### Outstanding Questions

- None remaining. All open questions from dialogue are resolved above.

---

## Planning Contract

### Product Contract Preservation

Product Contract is unchanged from the source requirements document. Planning decisions below instantiate KTD1–KTD6 without altering product scope.

### Key Technical Decisions

- KTD-P1. **New Rust module for AppConfig.** Create `src-tauri/src/app_config.rs` rather than adding constants to `lib.rs`. It defines `AppConfig` constants, the struct, and the `get_app_config` command. This keeps the IPC contract isolated and testable.
- KTD-P2. **Frontend store in `src/stores/app-config.ts`.** The store holds a validated `AppConfig` shape, exposes a synchronous `loadAppConfig()` initializer, and falls back to `DEFAULT_APP_CONFIG` compiled in TS. Layout `+layout.svelte` calls the initializer in `onMount` so the app boots with defaults already present.
- KTD-P3. **Zod as a direct dependency.** Add `zod` to `dependencies` in `package.json`. It is already pulled in transitively by `viem` and `@modelcontextprotocol/sdk`; making it direct reflects that the runtime validation is now first-party code.
- KTD-P4. **Default limit values preserve current behavior.**
  - `squadNameMaxLength`: 50
  - `channelNameMaxLength`: 50
  - `commonsMaxTags`: 3
  - `deploySafeMaxSigners`: 10
  - `roleLabelMaxLength`: 32
  - `walletAccountLabelMaxLength`: 64
  - `customTokenSymbolMaxLength`: 16
  - `pinDigitCount`: 6 (v1 is fixed at this value; any future change needs a migration path and a hard minimum such as ≥ 4)
  - `analyticsEnabled`: false
- KTD-P5. **Backend enforcement in `create_group_chat` and the user-facing `upsert_squad` path.** Add length checks in `create_group_chat` for group names and in the `upsert_squad` command before it calls `squad_catalog::prepare_row`, using the same constants that `AppConfig` exposes. Do not add the check inside `prepare_row` because that helper is also used for remote records (invite acceptance) that must not be rejected by a local UI limit. Channel names flow through `create_group_chat`, so this also covers `createDefaultParentChannels` and `runCreateChannelInParent`.
- KTD-P6. **PIN digit count drives both `PinInput.svelte` and the export modals.** `PinInput.svelte` accepts the count as a prop whose default is the compiled TS fallback (`6`). Callers such as `Login.svelte`, `EvmAccountKeyExportModal.svelte`, and `ExportAllSecretsModal.svelte` pass `$appConfig.pinDigitCount`. The export modals use inline PIN boxes, so their arrays, paste limits, completion checks, and labels derive from the store rather than the literal `6`.

### Dependencies and Sequencing

- U1 (Rust AppConfig) must land before U2 (frontend store) because the frontend invokes `get_app_config`.
- U2 must land before U4 and U5 because those units consume the store.
- U3 (backend enforcement) can ship in parallel with U4/U5 once U1 exists; the constants are shared.
- U6 (mock fixtures and tests) depends on U1 and U2.
- U7 (quality gates) runs last.

### Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Adding Zod increases bundle size for a small validation task. | Zod is already a transitive dependency; direct declaration does not pull new code. The schema is limited to the AppConfig shape. |
| Backend/frontend constants drift if the TS fallback is not identical to Rust defaults. | Define the TS default values in one place (`src/stores/app-config.ts`) and document that they must mirror `src-tauri/src/app_config.rs`. Add unit tests in U6 that assert both defaults match the expected values field-by-field, and consider a lightweight parity assertion that fails if the two shapes diverge. |
| Mock-mode browser builds fail because `get_app_config` is unmocked. | Add the command to `src/lib/api/mock-fixtures.ts` before any consumer reads it. |
| `PinInput.svelte` is used before the AppConfig store is loaded (login screen). | The component defaults to the compiled fallback count when the store is unavailable, and the store is initialized in `+layout.svelte` before authenticated UI renders. |

---

## Implementation Units

### U1. Rust AppConfig struct and `get_app_config` command

**Goal:** Add a backend-owned, serializable AppConfig and expose it through Tauri IPC.

**Requirements:** R1, R5, R9.

**Dependencies:** None.

**Files:**
- Create `src-tauri/src/app_config.rs`
- Modify `src-tauri/src/lib.rs` to register `get_app_config` and add `mod app_config;`

**Approach:**
1. In `src-tauri/src/app_config.rs`, define public constants for each limit and the analytics flag (e.g., `SQUAD_NAME_MAX_LENGTH: usize = 50`).
2. Define a `#[derive(Serialize, Clone, Debug)]` `AppConfig` struct with `#[serde(rename_all = "camelCase")]` fields matching the constants.
3. Add `pub fn default_app_config() -> AppConfig` that constructs the struct from the constants.
4. Add `#[tauri::command] pub async fn get_app_config() -> AppConfig` that returns `default_app_config()`.
5. Add a defensive static assertion or comment that `PIN_DIGIT_COUNT` must remain at least 4 if it is ever changed from the v1 default of 6, to prevent dangerously low PIN entropy.
6. In `src-tauri/src/lib.rs`, add `mod app_config;` near the top and include `app_config::get_app_config` in the `tauri::generate_handler!` list.

**Patterns to follow:** Existing command modules such as `session.rs` and `image_cache.rs` define structs and commands separately and register them in `lib.rs`.

**Test scenarios:**
- `get_app_config` returns all expected fields with the configured default values.
- `default_app_config` produces positive integers for every limit and a boolean for `analyticsEnabled`.
- `PIN_DIGIT_COUNT` is documented or asserted to remain at least 4 if changed from the v1 default of 6.

**Verification:** `cargo check --all-features` passes; the new command appears in the generated handler list.

---

### U2. Frontend Zod schema, API wrapper, and Svelte store

**Goal:** Fetch AppConfig at boot, validate it with Zod, and expose it through a Svelte store with a fallback default and an error toast.

**Requirements:** R2, R3, R4, R10, R11.

**Dependencies:** U1.

**Files:**
- Modify `package.json` to add `zod` to `dependencies`.
- Create `src/stores/app-config.ts`
- Create `src/lib/api/app-config.ts`
- Modify `src/routes/+layout.svelte` to initialize the store on mount.
- Modify `src/lib/api/mock-fixtures.ts` to mock `get_app_config`.

**Approach:**
1. In `src/stores/app-config.ts`, define a `DEFAULT_APP_CONFIG` object with the same values as the Rust defaults.
2. Define a `z.object` schema that requires every AppConfig field with the correct type (`number` for limits, `boolean` for `analyticsEnabled`).
3. Create a `writable<AppConfig>` store initialized to `DEFAULT_APP_CONFIG`.
4. Export `async function loadAppConfig(): Promise<void>` that invokes `get_app_config`, validates with Zod, and sets the store. On any error, set the store to `DEFAULT_APP_CONFIG` and call `showToast('Using default app settings. Configuration could not be loaded.', undefined, undefined, { error: true })`.
5. In `src/lib/api/app-config.ts`, export a thin `getAppConfig()` wrapper around `invoke<AppConfig>('get_app_config')`.
6. In `src/routes/+layout.svelte`, call `loadAppConfig()` in `onMount` after the existing boot calls.
7. In `src/lib/api/mock-fixtures.ts`, add `get_app_config: () => ({ ...DEFAULT_APP_CONFIG })` under a new `configFixtures` object merged into the registry. The fixture should mirror the TS default values so mock-mode tests do not depend on the backend.

**Patterns to follow:** `src/stores/auth.ts` for async store loading; `src/stores/toast.ts` for toast fallback; `src/lib/api/index.ts` for the invoke wrapper.

**Test scenarios:**
- Happy path: backend returns a valid AppConfig, Zod accepts it, and the store reflects the returned values.
- Covers AE1: backend returns an extra field; Zod rejects the response (strict schema), the store falls back to defaults, and `showToast` is called with an error toast.
- Covers AE1: backend returns a missing required field; the store falls back to defaults and shows an error toast.
- Covers R11: mock-mode `invoke('get_app_config')` returns the fixture without throwing.

**Verification:** `pnpm check` passes; `pnpm test` passes for the new store/API tests.

---

### U3. Backend enforcement for limit-gated commands

**Goal:** Make `create_group_chat` and the squad-catalog path reject over-limit names using the same constants exposed in AppConfig.

**Requirements:** R5, R9.

**Dependencies:** U1.

**Files:**
- Modify `src-tauri/src/lib.rs` (`create_group_chat`)
- Modify `src-tauri/src/squad_catalog.rs` (tag cap in `normalize_commons_tags`; keep `prepare_row` usable for remote records)
- Modify `src-tauri/src/commons.rs` (`normalize_commons_tags` tag cap)

**Approach:**
1. In `create_group_chat`, after trimming `group_name`, check `name.len() > crate::app_config::SQUAD_NAME_MAX_LENGTH` and return an error such as `"Group name must be at most {SQUAD_NAME_MAX_LENGTH} characters"`. Surface the returned error in the originating modal's existing inline error area or form error pattern (e.g., `CreateChannelModal`/`CreateSquadModal`). This covers squad names and channel names because both flow through this command. Decide whether the byte-count semantics (`String.len()`) are acceptable for ASCII-only names; if non-ASCII input is expected, switch backend validation to grapheme clusters or UTF-16 code units so it matches HTML `maxlength`.
2. In `upsert_squad`, before calling `prepare_row`, check `input.name.trim().len() > crate::app_config::SQUAD_NAME_MAX_LENGTH` and return an error if it exceeds the limit. Do not add this check inside `prepare_row`, which is also used for remote invite records that must not be blocked by a local UI limit.
3. In `squad_catalog.rs`, import the AppConfig constants and replace the hardcoded `3` in `normalize_commons_tags` with `crate::app_config::COMMONS_MAX_TAGS`, updating the error message and unit tests.
4. In `commons.rs`, replace the local `MAX_TAGS: usize = 3` with `crate::app_config::COMMONS_MAX_TAGS` in both the constant usage and the error message.
5. Audit every Rust command that writes the R8 labels (role labels, wallet account labels, custom token symbols) and add matching length checks using the corresponding `AppConfig` constants. At minimum, enforce `roleLabelMaxLength`, `walletAccountLabelMaxLength`, and `customTokenSymbolMaxLength` on the write paths invoked by `SquadRolesModal`, `WalletView`, and `WalletImportTokensModal`.

**Patterns to follow:** Existing empty-name checks in `create_group_chat` and `prepare_row`.

**Test scenarios:**
- Covers AE4: `create_group_chat` with a 60-character name returns an error and does not create a group.
- `create_group_chat` with a 50-character name succeeds (assuming other checks pass).
- `upsert_squad` rejects a squad name longer than 50 characters before calling `prepare_row`.
- `prepare_row` still accepts remote squad names over 50 characters (e.g., from invite acceptance) when called outside the user-facing `upsert_squad` path.
- `normalize_commons_tags` in both `commons.rs` and `squad_catalog.rs` still rejects four author tags and allows three plus the reserved `new` tag.
- Backend write paths for role labels, wallet labels, and token symbols reject inputs exceeding their `AppConfig` limits.

**Verification:** `cargo test` for the affected modules passes; `cargo check --all-features` passes.

---

### U4. Migrate issue-listed frontend limits to the config store

**Goal:** Replace hardcoded limits in the four primary components with reads from the AppConfig store.

**Requirements:** R7, R10.

**Dependencies:** U2.

**Files:**
- Modify `src/components/layout/Navbar.svelte`
- Modify `src/components/channel/CreateChannelModal.svelte`
- Modify `src/components/commons/CommonsTagPicker.svelte`
- Modify `src/components/commons/SquadCommonsVisibilityFields.svelte`
- Modify `src/components/commons/BroadcastSquadModal.svelte`
- Modify `src/components/commons/UserCommonsBroadcastPanel.svelte`
- Modify `src/components/squad/PairWithSquadModal.svelte`
- Modify `src/components/parent/DeploySafeModal.svelte`
- Modify `src/lib/treasury/treasury-safes.ts`

**Approach:**
1. In `Navbar.svelte`, import the AppConfig store and bind the squad-name input `maxlength` to `$appConfig.squadNameMaxLength`. Add an associated hint or character counter and an `aria-describedby` link from the input to the hint. Keep the existing `required` and trimming behavior.
2. In `CreateChannelModal.svelte`, import the AppConfig store and bind the channel-name input `maxlength` to `$appConfig.channelNameMaxLength`. Wire `aria-describedby` and `aria-errormessage` to the hint/error elements.
3. In `CommonsTagPicker.svelte`, change `export let maxTags = 3` to `export let maxTags = DEFAULT_APP_CONFIG.commonsMaxTags` and add `export let requireExactlyMaxTags = false`. Squad and public-squad broadcast call sites set `requireExactlyMaxTags={true}`; user broadcasts leave it false. This keeps the picker API consistent while preserving the exact-3 product semantics where required.
4. Update `SquadCommonsVisibilityFields.svelte`, `BroadcastSquadModal.svelte`, `UserCommonsBroadcastPanel.svelte`, and `PairWithSquadModal.svelte` so that hardcoded `maxTags={3}` or `tags.length === 3` checks derive from `$appConfig.commonsMaxTags`. Squad broadcasts and public-squad creation should still require exactly `commonsMaxTags` tags; user broadcasts should allow 1 to `commonsMaxTags`. Also replace any hardcoded tag-count labels such as `Tags (1–3)` or `Tags (exactly 3)` with interpolated values from `$appConfig.commonsMaxTags`.
5. In `DeploySafeModal.svelte`, replace the import and usage of `DEPLOY_SAFE_MAX_SIGNERS` with `$appConfig.deploySafeMaxSigners`. Remove `DEPLOY_SAFE_MAX_SIGNERS` from `src/lib/treasury/treasury-safes.ts`; no other code uses it, so all callers read from the AppConfig store.

**Patterns to follow:** Use `import { appConfig } from '../../stores/app-config';` and `$appConfig.fieldName` in templates.

**Test scenarios:**
- Covers AE2: `DeploySafeModal` disables creation when selected owners exceed `$appConfig.deploySafeMaxSigners`.
- Covers AE3: `CommonsTagPicker` refuses a fourth tag when `$appConfig.commonsMaxTags` is 3.
- `CreateChannelModal` renders with `maxlength` equal to `$appConfig.channelNameMaxLength`.
- `Navbar` renders the squad-name input with `maxlength` equal to `$appConfig.squadNameMaxLength`.

**Verification:** `pnpm check` passes; component tests that previously asserted on hardcoded values are updated to use the store default.

---

### U5. Migrate additional hardcoded maxlength caps to the store

**Goal:** Move role-label, wallet-label, token-symbol, and PIN-digit caps into the AppConfig store.

**Requirements:** R8, R10.

**Dependencies:** U2, U4 (for store usage patterns).

**Files:**
- Modify `src/components/auth/PinInput.svelte`
- Modify `src/components/auth/Login.svelte`
- Modify `src/components/settings/EvmAccountKeyExportModal.svelte`
- Modify `src/components/settings/ExportAllSecretsModal.svelte`
- Modify `src/components/parent/governance/SquadRolesModal.svelte`
- Modify `src/components/wallet/WalletView.svelte`
- Modify `src/components/wallet/WalletImportTokensModal.svelte`

**Approach:**
1. In `SquadRolesModal.svelte`, bind `maxlength` to `$appConfig.roleLabelMaxLength`, update the inline validation error to reference the configured cap, and link the input to the error with `aria-errormessage`.
2. In `WalletView.svelte`, bind `maxlength` to `$appConfig.walletAccountLabelMaxLength` and add an `aria-describedby` hint.
3. In `WalletImportTokensModal.svelte`, bind `maxlength` to `$appConfig.customTokenSymbolMaxLength`, update the regex/JS validation to use the same value, and expose the constraint to assistive tech via `aria-describedby`.
4. In `PinInput.svelte`, add `export let pinDigitCount = DEFAULT_APP_CONFIG.pinDigitCount` as a prop default and derive the `digits` array from it. Import the AppConfig store so callers can pass `$appConfig.pinDigitCount`; every caller (`Login.svelte`, `EvmAccountKeyExportModal.svelte`, `ExportAllSecretsModal.svelte`) must pass the store value. Update the paste slice limit and the completion check to use `pinDigitCount`.
5. In `EvmAccountKeyExportModal.svelte` and `ExportAllSecretsModal.svelte`, replace the literal 6-element arrays and hardcoded `6` checks with `$appConfig.pinDigitCount`. These modals use inline PIN boxes, so bind their array length, paste limits, completion checks, and labels to the store value.

**Patterns to follow:** Keep existing validation logic; only replace literals with store reads.

**Test scenarios:**
- `SquadRolesModal` rejects a role label longer than `$appConfig.roleLabelMaxLength`.
- `WalletView` rejects a wallet account label longer than `$appConfig.walletAccountLabelMaxLength`.
- `WalletImportTokensModal` rejects a custom token symbol longer than `$appConfig.customTokenSymbolMaxLength`.
- `PinInput` completes after exactly `$appConfig.pinDigitCount` digits when the prop is passed.
- `Login.svelte` passes `$appConfig.pinDigitCount` to every `PinInput`.
- `EvmAccountKeyExportModal.svelte` and `ExportAllSecretsModal.svelte` derive their inline PIN box arrays and validation from `$appConfig.pinDigitCount`.
- Login and key-export flows still work when the store defaults to 6 PIN digits.

**Verification:** `pnpm check` passes; existing PIN and wallet tests pass.

---

### U6. Mock registry update and IPC test coverage

**Goal:** Ensure mock-mode builds and tests do not break when `get_app_config` is added, and add focused tests for the new IPC contract.

**Requirements:** R11.

**Dependencies:** U1, U2.

**Files:**
- Modify `src/lib/api/mock-fixtures.ts`
- Modify `src/lib/api/mock-registry.ts` (if needed)
- Create `src/stores/app-config.test.ts`
- Create `src/lib/api/app-config.test.ts`

**Approach:**
1. Add `get_app_config` to the mock registry with a fixture matching `DEFAULT_APP_CONFIG`.
2. In `app-config.test.ts`, test the wrapper: verify it calls `invoke('get_app_config')` and returns the typed result.
3. In `app-config.test.ts`, test the store initializer:
   - valid response populates the store;
   - invalid response falls back to defaults and calls `showToast`;
   - rejected invoke falls back to defaults and calls `showToast`.
4. Add a parity test that asserts the TS `DEFAULT_APP_CONFIG` object matches the Rust `default_app_config()` shape and values field-by-field (or at least that every limit and `analyticsEnabled` has the same value on both sides). This catches drift between the hand-maintained mirrors.
5. Update any existing tests that mock `invoke` and assert call counts to account for the new boot-time call.

**Patterns to follow:** `src/stores/auth.test.ts` for store tests with mocked invoke; `src/lib/api/nostr.test.ts` for invoke wrapper tests.

**Test scenarios:**
- Covers R11: all existing tests that mock Tauri IPC still pass.
- The new `get_app_config` tests exercise happy path, malformed payload, and command failure.
- A parity test asserts that `DEFAULT_APP_CONFIG` matches the Rust `default_app_config()` values for every limit and the `analyticsEnabled` flag.

**Verification:** `pnpm test` passes.

---

### U7. Quality gates and final verification

**Goal:** Confirm the implementation satisfies R9, R10, and R11.

**Requirements:** R9, R10, R11.

**Dependencies:** U1–U6.

**Files:** None new.

**Approach:**
1. Run `cargo check --all-features` from the workspace root. Fix any new errors.
2. Run `pnpm check`. Fix any new TypeScript or Svelte errors introduced by store imports or prop changes.
3. Run `pnpm test`. Fix any failing tests caused by new mock expectations or component behavior changes.

**Verification:** All three commands exit successfully.

---

## Verification Contract

- `cargo check --all-features` exits with no new errors.
- `pnpm check` exits with no new errors.
- `pnpm test` exits with all tests passing, including new tests for the AppConfig store and IPC wrapper and the Rust/TS default parity test.
- Manual acceptance: boot the app, open the browser dev build, and confirm no error toast appears when the mock returns a valid AppConfig. Temporarily corrupt the mock fixture to trigger the fallback toast path. Verify that remote squad records (e.g., from invite acceptance) with names over `squadNameMaxLength` still persist while user-created names are rejected.

## Definition of Done

- `get_app_config` is registered as a Tauri command and returns a serializable `AppConfig` from compiled Rust constants.
- The frontend defines a Zod schema, validates the backend response, and exposes the result through a Svelte store.
- On validation or IPC failure, the frontend uses compiled defaults and shows exactly one error toast.
- `create_group_chat` rejects names exceeding `squadNameMaxLength`; `upsert_squad` rejects user-provided names exceeding `squadNameMaxLength` before calling `prepare_row`, while `prepare_row` remains usable for remote records such as invite acceptance.
- `commons.rs` and `squad_catalog.rs` both use the shared `commonsMaxTags` constant.
- All components listed in R7 and R8 read their relevant limit from the AppConfig store instead of a hardcoded value, with accessibility wiring (`aria-describedby`, `aria-errormessage`) for migrated inputs.
- The `analyticsEnabled` flag is present in both Rust and TS AppConfig shapes and exposed through the store.
- Mock-mode builds include a `get_app_config` fixture and a Rust/TS default parity test.
- Backend write paths for all migrated limits (R7 and R8) enforce the same caps.
- `cargo check --all-features`, `pnpm check`, and `pnpm test` pass.
