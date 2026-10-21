---
title: Page Loader Runes - Plan
type: refactor
date: 2026-10-20
topic: page-loader-runes
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
origin_issue: 391
---

# Page Loader Runes - Plan

## Goal Capsule

- **Objective:** A person whose authenticated shell fails to load can press Retry and the app tries that load again, including after the compiler is set to force runes mode.
- **Means:** Convert the loader's retry counter and click handler in place (KD1, KTD1).
- **Authority:** GitHub issue 391 is the product source. Product Contract requirements win on behavior. Planning Contract decisions win on mechanism. `docs/plans/2026-07-25-001-refactor-svelte-5-runes-migration-plan.md` is historical context and is not edited.
- **Stop conditions:** Stop if the conversion requires editing `src/components/app/AuthenticatedApp.svelte` or `svelte.config.js`.
- **Execution profile:** One change. No new component test.
- **Ships:** The implementing agent opens the pull request. Merge stays with a maintainer.

## Product Contract

### Summary

`src/routes/+page.svelte` becomes a runes-mode loader. Retry keeps re-running the authenticated-shell import. `AuthenticatedApp.svelte` stays a legacy shell. `AGENTS.md` drops the sentence that calls the page a thin legacy loader.

### Problem Frame

The page is no longer the old root shell. It is a 63-line loader (issue 391 says 62) that lazy-loads `AuthenticatedApp` through `loadAuthenticatedApp()` in `src/lib/app/authenticated-app.ts`. It is still legacy mode: `let shellLoadAttempt = 0` and `on:click={retryShellLoad}`. A `{#key shellLoadAttempt}` block is what makes Retry call the loader again. With `compilerOptions.runes` left off, that plain `let` is still reactive in the template. Issue 395 turns the option on. A plain `let` then stops updating the key, and Retry does nothing.

### Key Decisions

- **Convert the loader in place.** (session-settled: user-directed — chosen over leaving the loader legacy until the compiler gate, or converting `AuthenticatedApp` in the same change: Retry has to keep working once runes mode is forced, and `AuthenticatedApp` stays a shell until issue 394.) Governs R1, R2, R4.
- **Edit only the legacy-loader sentence in `AGENTS.md`.** (session-settled: user-directed — chosen over rewriting the architecture overview: issue 391 names that sentence and says leave the rest of the exception.) Governs R3.

### Requirements

- R1. Clicking Retry after a failed shell load runs `loadAuthenticatedApp()` again. The counter that `{#key}` reads is reactive under runes mode.
- R2. The retry control uses `onclick`. The `{#key}` / `{#await}` structure, the keys `auth.checkingAccount`, `auth.shellLoadError`, and `auth.shellLoadRetry`, and the style block stay as they are.
- R3. `AGENTS.md` no longer says `src/routes/+page.svelte` stays a thin legacy loader. The exception still names `AuthenticatedApp.svelte`, `ChatView.svelte`, and `ParentDashboard.svelte` as legacy shells.
- R4. `src/components/app/AuthenticatedApp.svelte` is not edited.

### Acceptance Examples

- AE1. `loadAuthenticatedApp()` rejects. The catch branch shows the retry control. Clicking it runs `loadAuthenticatedApp()` again. Covers R1, R2.

### Scope Boundaries

- The `{#key}` / `{#await}` markup stays as it is aside from `on:click={retryShellLoad}` becoming `onclick={retryShellLoad}`. i18n catalogs and styles are unchanged.
- No `<svelte:options>` pragma and no `svelte.config.js` edit in this change.
- No new component test for the route.

### Deferred to Follow-Up Work

- Issue 394 decomposes `AuthenticatedApp.svelte`.
- Issue 395 sets `compilerOptions.runes: true` after 391, 392, 393, and 394.
- `AGENTS.md` still says `src/routes/+page.svelte` is the root container that mounts the navbars. Issue 391 does not name that sentence.
- R16 in `docs/plans/2026-07-25-001-refactor-svelte-5-runes-migration-plan.md` still says not to convert `src/routes/+page.svelte` wholesale. That plan is not edited.

### Sources

- Issue 391, verified against `src/routes/+page.svelte` (plain `let shellLoadAttempt = 0` at line 6, `on:click={retryShellLoad}` at line 27) and the legacy-shells sentence in `AGENTS.md`.
- `docs/svelte5-reference.md` maps `let count = 0` to `$state(0)` and `on:click` to `onclick`.
- `src/components/wallet/WalletTransferStubModal.svelte` uses `$state(0)` and `onclick` in a converted file.
- `src/components/ui/cross-mode-interop.test.ts` covers a runes parent rendering a legacy child. It is not extended.

## Planning Contract

### Key Technical Decisions

- KTD1. The two syntax edits are the whole conversion. Do not add `<svelte:options runes>` and do not set `compilerOptions.runes`. The file has no `export let`, `$:`, `<slot>`, or `createEventDispatcher`, so it does not need a second pass to be valid runes mode. A rune in the component is what opts that file in while the compiler option stays off.

### Assumptions

- `pnpm tauri:dev` may be unavailable here. The forced-failure Retry check is then a maintainer step, written in the pull request.
- The route has no component test, and this change does not add one. `pnpm test` is the regression gate, including `src/components/ui/cross-mode-interop.test.ts`.
- Issue 391 matches the current loader. The line-count wording is 62 in the issue and 63 in the file. Follow the issue's edits.

### Sequencing

U1 is the only unit. It lands as one change.

## Implementation Units

### U1. Convert the page loader

- **Goal:** Retry still remounts the shell import after the loader is in runes mode, and `AGENTS.md` stops calling that file a legacy loader.
- **Requirements:** R1, R2, R3, R4. KD1, KD2, KTD1.
- **Dependencies:** None. Issues 392, 393, and 394 can land in any order. Issue 395 stays last.
- **Files:** `src/routes/+page.svelte`, `AGENTS.md`
- **Approach:**
  1. Change `let shellLoadAttempt = 0` to `let shellLoadAttempt = $state(0)`.
  2. Change `on:click={retryShellLoad}` to `onclick={retryShellLoad}`.
  3. Delete the sentence `` `src/routes/+page.svelte` stays a thin legacy loader for that shell. `` from the legacy-shells exception. Leave the surrounding sentences.
- **Patterns to follow:** `src/components/wallet/WalletTransferStubModal.svelte` (`let pricesFetchGen = $state(0)` and `onclick={...}`).
- **Test scenarios:**
  - The loader script initializes `shellLoadAttempt` with `$state(0)`, and the retry button's attribute is `onclick={retryShellLoad}`.
  - `{#key shellLoadAttempt}`, the `{#await loadAuthenticatedApp()}` branches, the three `auth.*` keys, and the `<style>` block are byte-for-byte the same aside from that attribute.
  - `git diff` for `src/components/app/AuthenticatedApp.svelte` is empty.
  - With `loadAuthenticatedApp` forced to throw, the catch UI shows Retry. One click increments the key and calls `loadAuthenticatedApp` again. This is the manual check in the issue. Skip it only when `pnpm tauri:dev` cannot run, and say so in the pull request.
- **Verification:** `pnpm check` reports 0 errors and no new warning for `src/routes/+page.svelte`. `pnpm lint` is clean. `pnpm test` passes. `pnpm build` succeeds.

## Verification Contract

- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- Manual, when a desktop session is available: `pnpm tauri:dev` reaches the login screen, unlock renders the authenticated app, and a temporary throw inside `loadAuthenticatedApp` makes Retry run the load again. Remove that throw before committing.

## Definition of Done

- U1 matches R1–R4 and KTD1.
- The four commands above pass.
- The diff does not include `AuthenticatedApp.svelte`, `svelte.config.js`, i18n catalogs, or a new test file.
- Any temporary throw used for the Retry check is gone.
- The pull request says `Closes #391`, notes the R16 and line-count drift, and names the maintainer Retry check if `pnpm tauri:dev` did not run.
