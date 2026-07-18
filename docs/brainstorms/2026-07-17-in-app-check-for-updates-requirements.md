---
date: 2026-07-17
topic: in-app-check-for-updates
---

# In-app Check for Updates

## Summary

Add an Updates panel in **Settings > App** where desktop users can see the installed version, check for new releases, download/install an update, and relaunch. Include an opt-in toggle (off by default) to run one update check automatically after the app unlocks. The feature uses the existing Tauri v2 updater backend and degrades gracefully outside release builds.

## Problem Frame

Alpha desktop builds already ship via GitHub Releases with the Tauri updater plugin configured on the backend, but there is no Settings UI that exposes update check/install to users. Alpha testers must re-download installers manually when a new build is published. This blocks a self-serve update path and slows the alpha feedback loop.

## Key Decisions

- **Updates control lives inside App settings.** A dedicated subsection under the existing App settings collapsible keeps the Settings nav compact while still making the control obvious.
- **Prompt-to-relaunch after install.** The user confirms the restart rather than the app auto-relaunching, preserving control over the interruption.
- **Disable the update control in dev builds with explanatory copy.** The control remains visible but inactive in `tauri dev`, with copy explaining that updates are only available in release builds.
- **Startup check is opt-in and off by default.** This respects user choice and avoids surprise download prompts on first unlock.

## Requirements

### Settings UI

- R1. Settings shows an **Updates** control inside the **App settings** section.
- R2. The control displays the current installed version, e.g. `Current Version: v0.1.0`.
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

## Key Flows

### F1. Manual check

- **Trigger:** User opens **Settings > App > Updates** and taps **Check for Updates**.
- **Actors:** User, Tauri updater plugin.
- **Steps:**
  1. Read installed version from app metadata.
  2. Call updater `check()`.
  3. If no update: show `You’re on the latest version`.
  4. If update available: show version and offer **Download & Install**.
  5. On confirm: download and install with progress events.
  6. On completion: prompt user to relaunch.
  7. On relaunch confirm: call `relaunch()`.
- **Outcome:** App restarts on the new version, or the user is confirmed as current.

### F2. Startup check

- **Trigger:** App unlocks and the user has enabled **Check for updates on startup**.
- **Actors:** User, app lifecycle, Tauri updater plugin.
- **Steps:**
  1. After PIN unlock, run one updater check for the session.
  2. If no update: do nothing (no toast).
  3. If update available: present the same available-update UX as F1.
- **Outcome:** User is notified of an update only when one exists.

## Acceptance Examples

- **AE1. No update available.** Given the user is on the latest release, when the user taps **Check for Updates**, then the status shows `You’re on the latest version` and no install prompt appears.
- **AE2. Update available.** Given a newer release is published, when the user taps **Check for Updates**, then the available version is shown, the user can download/install with progress, and a relaunch prompt appears after install.
- **AE3. Dev build.** Given the app is running in `tauri dev`, when the user opens **Settings > App > Updates**, then the update control is disabled and explains that updates are only available in release builds.
- **AE4. Startup check off by default.** Given a fresh install or account, when the app unlocks, then no automatic update check occurs.
- **AE5. Startup check opted in.** Given the user enabled **Check for updates on startup**, when the app unlocks, then one updater check runs and, if an update exists, the available-update UX appears.

## Success Criteria

- Manual smoke test passes: install build N, publish build N+1 to the release channel, and verify in-app update on macOS and one other desktop platform.
- Settings shows version and update controls in an obvious location.
- Release builds only; dev/web builds degrade gracefully without confusing testers.
- Operator documentation is in `docs/`.

## Scope Boundaries

- **Deferred for later:**
  - Android/iOS updater.
  - Auto-check on startup without an explicit opt-in.
  - Rich in-app release notes rendering beyond the metadata the updater already carries.

## Dependencies / Assumptions

- The Tauri updater plugin is already registered and configured in `src-tauri/src/lib.rs` and `src-tauri/tauri.conf.json`.
- The desktop capability already grants `updater:default` in `src-tauri/capabilities/desktop.json`.
- The frontend packages `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process` are already installed.
- The updater manifest endpoint is `https://github.com/covenant-gov/pacto-app/releases/latest/download/latest.json` and release artifacts are signed with the configured pubkey.
- The app has an unlock lifecycle event or equivalent hook on which to run the startup check.

## Sources / Research

- GitHub issue #70: `feat(settings): in-app Check for Updates for alpha desktop builds`
- Tauri v2 Updater plugin documentation: https://v2.tauri.app/plugin/updater/
- Tauri Updater JS API: https://v2.tauri.app/reference/javascript/updater/
- Existing backend configuration: `src-tauri/tauri.conf.json`, `src-tauri/capabilities/desktop.json`, `src-tauri/src/lib.rs`
- Existing Settings shell: `src/components/settings/AppSettingsSection.svelte`, `src/components/settings/SettingsPage.svelte`
