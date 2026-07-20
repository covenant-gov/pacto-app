---
date: 2026-07-18
topic: onboarding-verified-seed-backup
---

# Verified seed-backup gate (first milestone)

## Summary

Introduce a progressive, per-account verified seed-backup gate for Pacto. Fresh accounts see it after PIN setup; existing unverified accounts see it on next unlock. DMs stay available before verification, but seed export, squad creation, squad invite acceptance, treasury interactions, and fund sends are blocked until the user writes down the seed and verifies a random subset by number. Imports with a recovery phrase skip the ritual.

## Problem frame

Pacto is a self-custody app: one BIP-39 seed powers both the Nostr identity and the embedded EVM wallet. If a user loses the seed, they lose messaging identity and any funds. Today there is no enforced safety ritual before risky actions; the seed can be viewed in Settings (`src/components/settings/ProfileSection.svelte`), but nothing verifies the user wrote it down. Squad invites, treasury deploys, and fund sends are reachable before any backup check. This is the single catastrophic loss point in the first-run experience.

## Key decisions

- **Progressive gate, not hard gate.** The main shell unlocks after PIN setup; only risky actions are blocked until backup is verified. This preserves a meaningful first action (DMs) while still protecting the surfaces that can cause irreversible loss.
- **Random-subset verification.** After showing the seed, the user verifies a random subset of words by their position numbers. This is stronger than self-attest and less tedious than full re-entry.
- **Three attempts, then re-show.** A failed verification re-shows the full seed so the user can re-copy and try again. No lockouts or cooldowns in the first milestone.
- **Imports skip verification.** A user who imports with a recovery phrase is assumed to already have the phrase offline. The gate applies only to fresh accounts created inside Pacto.
- **Per-npub persistence.** Backup-verified status is stored per account, not per install, so existing unverified accounts are covered and verification survives PIN changes or app reinstalls.
- **All risky actions gated.** Seed export, squad creation, squad invite acceptance, treasury operations, and fund sends require verification. DMs do not.

## Requirements

### Backup tracking and prompt

- R1. Persist a `backupVerified` boolean per npub in the per-account store (`src/stores/persistence-context.ts` or backend equivalent).
- R2. For a fresh account, show the backup prompt after the user completes PIN setup and reaches the main shell.
- R3. For an existing account that is not yet verified, show the backup prompt on the next unlock after this feature ships.
- R4. The backup prompt is dismissible. A dismissed prompt returns on the next unlock or when the user attempts a gated action.
- R5. Display a persistent but dismissible indicator (e.g., banner, badge on Settings, or alert in the squad/DM sidebars) until verification is complete.

### Verification ritual

- R6. The verification flow has three steps: show the full seed phrase, instruct the user to write it down offline, then ask for a random subset of words by their position numbers.
- R7. The random subset uses at least 3 words and covers different positions across the phrase (e.g., word #3, #7, #12). The exact positions are randomized per attempt.
- R8. If the user enters the subset correctly, mark the account as `backupVerified` and close the flow.
- R9. If the user enters the subset incorrectly, allow up to 3 attempts on the same shown seed, then re-show the full seed and restart the ritual.
- R10. The seed is never displayed again after successful verification except through the existing Settings export flow, which remains gated by the backup check (see R13).

### Gated actions

- R11. Before verification, DMs remain fully usable and Commons browsing remains available. Sending messages, receiving messages, and browsing the discovery feed are allowed.
- R12. Before verification, the following actions are blocked and surface the backup gate:
  - Viewing or exporting the seed phrase from any surface.
  - Creating a new squad.
  - Accepting a squad invite (including channel-in-squad invites).
  - Interacting with squad treasury (Sponsor/Gov/Safe deploys, proposals, signing).
  - Sending or moving funds from any wallet.
- R13. The existing seed export modal in Settings (`src/components/settings/EvmAccountKeyExportModal.svelte`) must trigger the backup gate before it can reveal the seed; it becomes the post-verification view path, not the first-time backup path.
- R14. Imports with a recovery phrase (`src/lib/api/auth.ts:loginWithRecoveryPhrase`) set `backupVerified` to true and skip the ritual.

### Cross-cutting UX

- R15. The backup prompt and gate use plain, non-technical language that explains why backing up matters, without mentioning `npub`, `nsec`, `MLS`, or `BIP-39` unless the user explicitly navigates to advanced surfaces.
- R16. The flow is keyboard-navigable and accessible: the seed display is readable, word positions are announced clearly, and errors are specific (“Word #3 does not match” rather than “incorrect”).
- R17. No network calls are required for the backup flow; it operates entirely on local state and the encrypted seed already in memory after PIN unlock.

## Key flows

### F1. Fresh account reaches backup prompt

- **Trigger:** User creates a new account and completes PIN setup.
- **Actors:** New Pacto user.
- **Steps:**
  1. `Login.svelte` finishes `pin-confirm` and unlocks the main shell.
  2. The backup prompt appears as a modal or top banner.
  3. User can choose “Back up now” or “Remind me later.”
  4. If “Remind me later,” the prompt closes and the user lands on DMs.
- **Outcome:** Account is created; `backupVerified` remains false until the user completes the ritual.

### F2. Existing unverified account sees prompt on unlock

- **Trigger:** User unlocks an existing account after the feature ships.
- **Actors:** Existing Pacto user who has never verified backup.
- **Steps:**
  1. `checkAuthStatus` and `unlockWithPin` complete.
  2. App checks `backupVerified` for the current npub.
  3. If false, the backup prompt appears.
  4. User can dismiss and continue to DMs or start the ritual.
- **Outcome:** Existing users are pulled into the same safety net without re-creating accounts.

### F3. Gated action triggers backup gate

- **Trigger:** User clicks a gated action (e.g., “Accept invite” or “Send”) before verification.
- **Actors:** Any unverified user.
- **Steps:**
  1. The app intercepts the action before invoking the underlying command.
  2. A backup gate screen/modal explains the action requires a verified backup.
  3. User can start the ritual or cancel and return to the prior screen.
- **Outcome:** The risky action is deferred until verification completes.

### F4. Successful verification

- **Trigger:** User chooses “Back up now” from any prompt or gate.
- **Actors:** Unverified user.
- **Steps:**
  1. App shows the full seed with clear “write this down offline” messaging.
  2. User confirms they have written it down.
  3. App asks for a random subset of words by position.
  4. User enters the words correctly within 3 attempts.
  5. App sets `backupVerified` to true, removes all indicators, and closes the flow.
- **Outcome:** Risky actions are now unlocked for this npub on all devices.

### F5. Failed verification re-shows seed

- **Trigger:** User enters the wrong random-subset words three times.
- **Actors:** Unverified user.
- **Steps:**
  1. App shows an error: “Those words don’t match. Here is the seed again so you can re-check.”
  2. App returns to the seed display step.
  3. User re-copies and starts a new verification round.
- **Outcome:** No lockout; the loop is repeated until success or cancel.

## Acceptance examples

- AE1. Fresh account, user dismisses backup prompt, opens DMs, sends a message. **Covers:** R2, R4, R11.
- AE2. Fresh account, user accepts squad invite, app shows backup gate, user completes verification, invite accept resumes. **Covers:** R12, F3, F4.
- AE3. Existing unverified account, user unlocks, prompt appears, user dismisses, prompt does not reappear until next unlock or gated action. **Covers:** R3, R4.
- AE4. User exports seed from Settings before verification; app shows backup gate instead of revealing seed. **Covers:** R12, R13.
- AE5. User imports with recovery phrase, lands on main shell, no backup prompt appears, gated actions work immediately. **Covers:** R14.
- AE6. User fails random-subset verification twice, succeeds on third attempt. **Covers:** R9.
- AE7. User fails random-subset verification three times, app re-shows seed. **Covers:** R9, F5.

## Scope boundaries

### Deferred for later

- The other six onboarding ideas from issue #85: intent-based first-run router, unified onboarding checklist, invite-accept guided funnel, solo sandbox squad, one-click testnet treasury sandbox, and context-aware empty-state coach cards.
- Advanced backup forms: social recovery, encrypted cloud backup, hardware wallet integration, and multi-share schemes.
- A hard gate that blocks the main shell until backup is verified.
- Cooldowns, lockouts, or rate-limiting on verification attempts.
- Backup verification for accounts imported via nsec-only unlock (`src/lib/api/auth.ts:login`). The import-with-seed path skips; nsec-only unlock is a separate advanced case and is not in this milestone.

### Outside this product's identity

- Centralized recovery services that hold user keys.
- SMS/email backup reminders that depend on external identity.
- Any form of KYC or identity verification.

## Dependencies and assumptions

- The seed is available in memory after PIN unlock (`get_seed` in `src/lib/api/auth.ts`), so the backup flow can run without additional decryption.
- Per-account persistence (`src/stores/persistence-context.ts`) is the right place for the `backupVerified` flag. If backend state is preferred, it should be stored in the per-account SQLite `vector.db` and re-synced on unlock.
- The current squad invite flow (`src/lib/app/invites/accept-invite.ts`) can be wrapped to check the backup flag before calling `acceptMlsWelcome`.
- The current wallet/treasury commands can check the flag before signing or broadcasting.

## Outstanding questions

- **Resolved:** Commons browsing is available before verification, alongside DMs.
- **Deferred to planning:** Exact UI shape of the backup prompt (modal vs banner), the random-subset size (3 vs 4 words), and whether the persistent indicator is a banner, sidebar badge, or checklist entry.
- **Deferred to planning:** Whether the proactive prompt should be shown on every unlock until verified, or only once per session/day.

## Sources

- Issue #85: Onboarding: coordinated first-run experience so new users reach value before key, squad, and treasury cliffs.
- `STRATEGY.md` — target problem, key metrics, and tracks.
- `CONCEPTS.md` — definitions of npub, nsec, BIP-39 seed, squad, treasury, roster EVM, etc.
- `src/components/auth/Login.svelte` — existing auth steps (`checking`, `welcome`, `pin-create`, `pin-confirm`, `pin-unlock`).
- `src/lib/api/auth.ts` — `createAccount`, `loginWithRecoveryPhrase`, `exportRecoveryPhrase`, `get_seed`.
- `src/components/settings/EvmAccountKeyExportModal.svelte` and `ProfileSection.svelte` — existing seed export surfaces.
- `src/lib/app/invites/accept-invite.ts` and `src/lib/api/nostr.ts` — squad invite accept flow.
- Grounding dossier: `/tmp/compound-engineering/ce-brainstorm/2026-07-18-onboarding-coordinated-first-run/grounding.md`.
