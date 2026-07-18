---
title: feat: in-app Check for Updates
type: feat
date: 2026-07-17
origin: docs/brainstorms/2026-07-17-in-app-check-for-updates-requirements.md
---

# In-app Check for Updates

## Summary

Add a frontend-only updater layer on top of the already-wired Tauri v2 updater plugin. The work introduces an updater service, an npub-scoped opt-in startup-check preference, shared update UI components, and an Updates subsection inside **Settings > App**. No Rust backend changes are needed.

## Problem Frame

Alpha desktop builds ship via GitHub Releases with the Tauri updater already configured, but testers have no in-app way to discover or install updates. They must re-download installers manually, which blocks a self-serve update path.

## Requirements

Carried forward from the origin doc. R-IDs are stable.

### Settings UI

- R1. Settings shows an **Updates** control inside the **App settings** section.
- R2. The control displays the current installed version.
- R3. The control provides a primary **Check for Updates** button.
- R4. Tapping the button triggers a Tauri updater check and shows a status line: `Checking…`, `You’re on the latest version`, or `Update vX.Y.Z available`.

### Manual update flow

- R5. When an update is available, the UI shows the new version and lets the user start download and install.
- R6. Download and install show progress to the user.
- R7. After install completes, the app prompts the user to relaunch.
- R8. Relaunching applies the installed update and starts the new version.

### Startup check

- R9. Settings offers an opt-in toggle to **Check for updates on startup**.
- R10. The startup check toggle is **off by default**.
- R11. When enabled, the app runs one update check after the user unlocks the app.
- R12. If the startup check finds an update, it surfaces the same available-update UX as a manual check.
- R13. The startup check runs at most once per app session.

### Build handling and errors

- R14. In dev builds, the update control is disabled with copy explaining that updates are only available in release builds.
- R15. Network failures, signature mismatch, and missing platform assets surface via user-readable toasts rather than silent failures.

### Operator docs

- R16. Operator steps for publishing `latest.json` and configuring signing env vars are documented in `docs/`.

## Key Technical Decisions

- **Frontend-only updater service.** The Tauri v2 updater plugin is already registered and the desktop capability already grants `updater:default`, so the feature calls `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process` directly from the frontend. No new Rust command is needed.
- **Shared update state in a Svelte store.** Both the Settings panel and the startup-check modal subscribe to the same `updateStatus` store so the available-update UX, progress, and errors are consistent wherever they appear.
- **Startup check fires from `src/lib/app/post-login-sync.ts`.** This reuses the existing non-blocking post-unlock hook and runs after `loadAccountState` has set the npub-scoped persistence context.
- **Startup-check opt-in is npub-scoped localStorage.** Follows the existing `persistenceKey(prefix)` pattern so the preference is tied to the account and cleared on logout.
- **Dev builds degrade via `import.meta.env.DEV`.** The service short-circuits to a disabled state with user-facing copy; no runtime backend detection is required.
- **Startup-found updates surface in a global modal.** This gives the user an immediate action surface without requiring navigation to Settings first.

## Implementation Units

### U1. Create updater service module

- **Goal:** Wrap Tauri plugin-updater `check()` and `downloadAndInstall()`, plus plugin-process `relaunch()`, and expose a shared `updateStatus` store.
- **Requirements:** R4, R5, R6, R7, R8, R14, R15.
- **Dependencies:** None.
- **Files:**
  - `src/lib/updater/update-check.ts` (new)
  - `src/lib/updater/update-check.test.ts` (new)
- **Approach:**
  - Define a status store with states: `idle`, `checking`, `no-update`, `available`, `downloading`, `installing`, `error`, `dev-disabled`.
  - `checkForUpdates()` guards on `import.meta.env.DEV` and sets `dev-disabled` in dev. In release builds it calls `check()` from `@tauri-apps/plugin-updater`, reads the installed version via `getVersion()` from `@tauri-apps/api/app`, and transitions the store to `no-update` or `available`.
  - `downloadAndInstallUpdate()` calls `downloadAndInstall()` on the returned update with a progress callback that updates the store. On completion it raises a relaunch prompt by setting a separate `relaunchPending` flag in the store.
  - `relaunchApp()` calls `relaunch()` from `@tauri-apps/plugin-process`.
  - Errors are caught, mapped to user-facing messages, stored in the status, and surfaced via `showToast` so startup-check failures are not silent.
- **Patterns to follow:** Existing wrapper modules in `src/lib/api/*` for typed Tauri command patterns; `src/stores/toast.ts` for error surfacing.
- **Test scenarios:**
  - Covers AE3. Dev build: `checkForUpdates` sets `dev-disabled` and never calls the plugin.
  - Covers AE1. No update available: mocked `check()` returns no update; status becomes `no-update`.
  - Covers AE2. Update available: mocked `check()` returns an update; status becomes `available` with the target version.
  - Download/install progress: mocked `downloadAndInstall()` emits progress events; status transitions through `downloading`/`installing`.
  - Error paths: network failure, signature mismatch, and missing platform asset each set `error` status and call `showToast`.
  - Relaunch: `relaunchApp` invokes the process plugin relaunch function.
- **Verification:** Unit tests pass and the service exposes a clean public API with no leaked plugin internals.

### U2. Create startup-check preference store

- **Goal:** Persist the opt-in startup-check toggle per account and track whether the check has already run this session.
- **Requirements:** R9, R10, R11, R13.
- **Dependencies:** None.
- **Files:**
  - `src/stores/startup-check.ts` (new)
  - `src/stores/startup-check.test.ts` (new)
  - `src/lib/utils/clear-account-state.ts` (add prefix)
  - `src/stores/persistence.ts` (read preference on account load)
- **Approach:**
  - Writable store `startupCheckEnabled` defaults to `false`.
  - On `loadAccountState(npub)`, read `persistenceKey(STARTUP_CHECK_PREFIX)` and seed the store.
  - Subscribe to the store and persist changes to the npub-scoped key.
  - Add `STARTUP_CHECK_PREFIX` to `SCOPED_KEY_PREFIXES` in `clear-account-state.ts` so logout clears it.
  - Keep a module-level `hasRunStartupCheckThisSession` flag that resets on app restart (no persistence).
- **Patterns to follow:** `src/stores/theme.ts` for localStorage persistence; `src/stores/navigation.ts` for `persistenceKey` usage; `src/stores/dm.ts` for npub-scoped read on load.
- **Test scenarios:**
  - Default off when no persisted value exists.
  - Persists `enabled` state per npub and clears it on logout.
  - `hasRunStartupCheckThisSession` is false at import time, true after `markStartupCheckRun()`, and only resets on app restart.
  - Subscription writes only when persistence context is set.
- **Verification:** Unit tests pass; `clearAccountState` removes the startup-check key for the logged-out npub.

### U3. Wire startup check trigger

- **Goal:** Run one update check after unlock when the user has opted in.
- **Requirements:** R11, R12, R13.
- **Dependencies:** U1, U2.
- **Files:**
  - `src/lib/app/post-login-sync.ts` (modify)
- **Approach:**
  - After the existing post-login sync tasks, check `startupCheckEnabled` and `hasRunStartupCheckThisSession`.
  - If enabled, not yet run, and not in dev, call `checkForUpdates()` from U1 and mark the session as checked.
  - Do not block on the result; failures are already surfaced as toasts by U1.
  - If an update is found, the global modal from U4 appears automatically because it subscribes to the shared store.
- **Patterns to follow:** Existing async fire-and-forget shape inside `runPostLoginNetworkSync`.
- **Test scenarios:**
  - Does not run when the preference is disabled.
  - Does not run when the session has already been checked.
  - Does not run in dev builds.
  - Runs exactly once when enabled in a release build.
  - When an update is found, the shared status store becomes `available` (modal handled in U4).
- **Verification:** Manual smoke test confirms a startup check runs once after PIN unlock when the toggle is on.

### U4. Create shared update-available UI components

- **Goal:** Provide a reusable panel and modal so the available-update UX is the same in Settings and after a startup check.
- **Requirements:** R5, R6, R7, R12.
- **Dependencies:** U1.
- **Files:**
  - `src/components/updater/UpdateAvailablePanel.svelte` (new)
  - `src/components/updater/UpdateAvailableModal.svelte` (new)
  - `src/routes/+page.svelte` (mount modal)
- **Approach:**
  - `UpdateAvailablePanel` reads `updateStatus` and renders the available version, install button, progress, and any error. It calls `downloadAndInstallUpdate()` and `relaunchApp()` from U1.
  - `UpdateAvailableModal` wraps the panel in `src/components/ui/Modal.svelte` and opens when `updateStatus` is `available` or `relaunchPending`.
  - Mount `UpdateAvailableModal` in `src/routes/+page.svelte` next to the existing toast portal and global modals so it can appear regardless of the active view.
- **Patterns to follow:** `src/components/ui/Modal.svelte` usage in `src/components/commons/BroadcastSquadModal.svelte`.
- **Test scenarios:**
  - Panel renders version and an enabled install button when status is `available`.
  - Panel disables the install button and shows progress when status is `downloading` or `installing`.
  - Panel shows the error state when status is `error`.
  - Modal opens when status becomes `available` and closes on dismiss.
  - Modal remains open during download/install so progress is visible.
- **Verification:** UI review confirms the modal and panel render consistently and the install/relaunch flow works end to end.

### U5. Add Updates UI to App settings

- **Goal:** Add the version display, manual check button, status line, startup toggle, and dev-build disabled copy inside **Settings > App**.
- **Requirements:** R1, R2, R3, R4, R9, R14.
- **Dependencies:** U1, U2, U4.
- **Files:**
  - `src/components/settings/AppSettingsSection.svelte` (modify)
- **Approach:**
  - Add a new subsection under the existing Appearance section in `AppSettingsSection`.
  - Display the installed version from U1.
  - Render a primary **Check for Updates** button that calls `checkForUpdates()`.
  - Show the status line based on `updateStatus`.
  - Render `UpdateAvailablePanel` inline when status is `available`.
  - Add a checkbox toggle bound to `startupCheckEnabled`.
  - In dev builds, disable the check button and show copy explaining updates are release-only.
- **Patterns to follow:** Existing `AppSettingsSection` radio-group layout; `src/components/ui/Modal.svelte` for modal usage; `src/stores/toast.ts` for transient status.
- **Test scenarios:**
  - Renders the current installed version.
  - Clicking **Check for Updates** transitions status to `checking`.
  - Toggling startup check persists the preference.
  - Dev build disables the button and shows explanatory copy.
  - When an update is available, the inline panel appears with install action.
- **Verification:** Manual review in dev and release builds confirms the control behaves as specified.

### U6. Document operator steps

- **Goal:** Provide runbook for publishing the updater manifest and configuring signing.
- **Requirements:** R16.
- **Dependencies:** None.
- **Files:**
  - `docs/build/OPERATOR_UPDATES.md` (new)
- **Approach:**
  - Explain how `latest.json` is produced by the release workflow.
  - Document the `TAURI_SIGNING_PRIVATE_KEY` environment variable and how it is used.
  - Include manual smoke-test steps: install build N, publish build N+1, verify in-app update on macOS and one other desktop platform.
- **Test expectation:** none — documentation-only unit.
- **Verification:** Doc is present in `docs/build/` and contains enough detail for a release operator to produce a signed update.

## Scope Boundaries

- **Deferred for later:**
  - Android/iOS updater.
  - Auto-check on startup without an explicit opt-in.
  - Rich in-app release notes rendering beyond the metadata the updater already carries.
- **Deferred to follow-up work:**
  - Add a global "check for updates on launch" option before PIN unlock.
  - Show detailed per-platform asset status in the UI.

## Risks & Dependencies

- **Signing key handling.** The release workflow already consumes `TAURI_SIGNING_PRIVATE_KEY`; the operator doc must make it clear this key must stay out of source control and out of the frontend bundle.
- **Dev vs release behavior mismatch.** Because dev builds short-circuit, the real update flow can only be verified in a release build. The smoke test in the success criteria is required.
- **Updater plugin API churn.** The feature is the first frontend caller of `@tauri-apps/plugin-updater`. If the plugin API changes in a future Tauri update, the service module is the single place to adapt.
- **Startup check timing.** The check must run only after `loadAccountState` sets the persistence context. The chosen hook (`post-login-sync`) already runs after that point.

## Sources & Research

- Origin requirements: `docs/brainstorms/2026-07-17-in-app-check-for-updates-requirements.md`
- Tauri v2 updater plugin docs: https://v2.tauri.app/plugin/updater/
- Tauri updater JS API: https://v2.tauri.app/reference/javascript/updater/
- Existing Tauri config: `src-tauri/tauri.conf.json`
- Updater plugin registration: `src-tauri/src/lib.rs`
- Desktop capability: `src-tauri/capabilities/desktop.json`
- Settings shell: `src/components/settings/AppSettingsSection.svelte`, `src/components/settings/SettingsPage.svelte`
- Persistence pattern: `src/stores/persistence-context.ts`, `src/stores/persistence.ts`, `src/lib/utils/clear-account-state.ts`
- Post-unlock hook: `src/lib/app/post-login-sync.ts`
- Toast primitive: `src/stores/toast.ts`
- Modal primitive: `src/components/ui/Modal.svelte`
