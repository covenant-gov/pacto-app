# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## Unreleased

### Bug Fixes
- Use an eye-off icon for the commons hide action instead of an x
- Statically link liblzma to stop macos startup crash
- Report tor traffic live instead of only at connection close (privacy)
- Gate whisper import behind feature flag in cmds/storage and cmds/voice


### Documentation
- Research concord protocol migration feasibility


### Features
- Hide commons broadcasts and default categories the user is not interested in


### Refactor
- Split tauri commands out of lib.rs into domain modules


### Testing
- Cover progressive byte reporting in copy_and_count (privacy)

## v0.7.1

### Bug Fixes
- Sandbox cargo-test profile writes to a disposable temp dir (#348)
- Create new squad sticker packs instead of failing with pack_id is empty (#349)
- Consent-first mls acceptance (#346)
- Parallelize rust ci tests with cargo-nextest, report timing (#350)
- Close Tor routing leaks, cover avatars and link previews (privacy)


### Chores
- Bump version to 0.7.1 (release)


### Documentation
- Publish pacto design-system rules (#269) (ui)
- Note invoke-spy limitation in tauri mcp troubleshooting
- Document tor transport architecture (privacy)


### Features
- Gov guide built into hats tree display (#345)
- Add a presentational squad layout playground (#273) (shell)
- Add send-typing-indicators privacy setting
- Route traffic through an embedded Tor client (privacy)
- Add route-traffic-through-tor toggle to privacy settings (settings)
- Show live tor status and add a disconnect toggle in the nav bar (privacy)
- Add web-previews setting to gate link-preview fetching and rendering
- Add opt-in biometric unlock via touch id and windows hello

## v0.7.0

### Bug Fixes
- Ad-hoc sign macOS app builds (#307)
- Clear make build warnings by deleting dead code, not suppressing it (#306)
- Create squads when a member's key package is stale, and say so when creation fails (#313)
- Stop reclassifying failed MLS welcome retries as transient (#336)
- Stop mls welcome-delivery failures from orphaning groups (#339)


### Chores
- Bump version to 0.7.0 (#344) (release)


### Features
- Convert root layout to svelte 5 runes (#322) (pacto-app-a7r.21)
- Convert channel modals and roster item to svelte 5 runes (#323) (pacto-app-a7r.12)
- Convert parent/ dashboard-polls, create-poll, deploy-safe, my-dashboard, setting-up to svelte 5 runes (#324) (pacto-app-a7r.15)
- Convert governance treasury, roles, and security panels to svelte 5 runes (#325) (pacto-app-a7r.19)
- Convert commons/ components to svelte 5 runes (#326) (pacto-app-a7r.14)
- Convert settings components to svelte 5 runes (#327) (pacto-app-a7r.11)
- Convert governance deploy-and-launch modals to svelte 5 runes (#328) (pacto-app-a7r.17)
- Convert dm/ composer and thread to svelte 5 runes (#329) (pacto-app-a7r.26)
- Convert governance actions and proposals to svelte 5 runes (#330) (pacto-app-a7r.18)
- Convert small-file cluster to svelte 5 runes (#331) (pacto-app-a7r.10)
- Convert layout navbar/sidebar components to svelte 5 runes (#332) (pacto-app-a7r.20)
- Convert wallet/ components to svelte 5 runes (#333) (pacto-app-a7r.13)
- Convert parent dashboard tabs and modals to svelte-5 runes (#334) (pacto-app-a7r.16)
- Convert dm/ message-rendering components to svelte 5 runes (#335) (pacto-app-a7r.25)
- Dual-publish MLS key packages on kind 30443, accept legacy 443 (#338)
- Wargames (#305)
- Nostr-to-evm eip-712 cert (#342)
- Speed up two-window sandbox demo (#343)


### Refactor
- Dedupe commons-broadcast presentation logic (#308)
- Convert on: directives to Svelte 5 event attributes repo-wide (#309)
- Convert dm/ dispatchers to callback props (#310)
- Convert ui/ to Svelte 5 runes (#314)
- Convert announcements/ to Svelte 5 runes (#315)
- War-game (#341)

## v0.6.1

### Bug Fixes
- Size gif-picker thumbnails to a readable 3-column grid
- Close klipy and sticker egress holes found in review (#243)
- Recognize pre-0.6.0 migration checksums so upgrades don't trip the storage-format gate
- Reconcile legacy checksums for the MLS store too, not just pacto.db
- Reconcile MLS legacy checksums on every store open, not once per reset (#275)
- Patch nanoid and hono to close dependabot alerts (#287)
- Dm relay bug and error messaging in ui (#281)


### Chores
- Unblock two-account testing and stop migration tests pinning a version
- Bump version to 0.6.1 (#289) (release)


### Features
- Offer a refusable join for groups that added you without an invite dm
- Add squad sticker packs and an opt-in klipy gif picker to the composer
- Make squad governance process readable and actionable (#256)
- Relay connection diagnostics, pre-add probe, and TLS certificate inspection (#270)
- Squad pfp and pfp picker (#278)


### Other
- Address PR review feedback (#267)

- Persist engine-accepted bare welcomes so a persistSquad failure can retry without re-calling acceptMlsWelcome
- Keep the join card mounted during in-flight accept so Joining… is reachable
- Reset joiningWelcomeGroupIds on account clear and abort materialization if the npub changed
- Add referrerpolicy/lazy on unvetted welcome images and void the fire-and-forget accept handler
- Cover acceptOfferedWelcome and declineWelcomeForGroup, and log failed Catch up resolves
- Address PR review feedback (#267)

- Cap pending-welcome cards to the 20 newest; keep engine-accepted recovery rows uncapped
- Update pacto.app to Pacto.app (#288)


### Refactor
- Use squad-evm language and escuad slang in member copy (#280)

## v0.6.0

### Bug Fixes
- Clean up chat, messages, and cursor on voluntary group leave (mls)
- Durably remove mls_groups row on voluntary leave
- Make dm delete purge history and gate relay replay (#233)
- Switch refinery migration versions to UTC timestamps
- Recover mls on wake and route poll creates to announcements (#235)
- Treat the whole loopback range and .localhost aliases as local
- Give dev sandboxes a stable branch-scoped root and named personas
- Keep public default relays out of an overridden sandbox
- Mark dev-login identities backup-verified so sandboxes can act
- Retry account-wide sync and live subscriptions after an empty relay pool
- Make dev-ports index claims atomic across concurrent sandboxes
- Satisfy checkJs on the claim helpers
- Durable consent-first invite admit and Join inbox reliability (#241)
- Harden tailwind and shadcn foundation for review blockers (ui)
- Satisfy svelte-check for foundation test harness (ui)
- Let dev sandboxes run beside each other
- Stop the dev server watching sandbox and worktree trees
- Never derive a port set browsers refuse to fetch from
- Address review findings on the sandbox concurrency fix
- Run the harness CI steps under the image's dash shell
- Refuse a second launch against one sandbox root
- Fail closed on non-unix sandbox lock liveness (review)
- Address PR review feedback (#263)
- Default cargo run to pacto binary over relay-free-harness
- Seed a squads catalog row for the relay-free harness squad
- Restore the pr gate by quoting an unparseable ci step


### Chores
- Raise legacy sequential migration ceiling to V32
- Correct the deferral comment and drop tracker ids from source
- Drop tracker id from a test name
- Bump version to 0.6.0 (release)


### Features
- Add make new-migration generator plus CI format check
- Persist sponsored userop fee ledger for treasury (#242)
- Boot agent sandboxes authenticated, local-routed, and collision-free
- Let debug builds reach a locally-issued wss relay
- Refuse stale local-chain artifacts and delegate the world verb
- Seed a populated sandbox with no docker and no network
- Quarantine stale sandbox profiles instead of bricking boot
- Widen storage-doctor quarantine gate to non-io.pacto identifiers
- Add dev-sandbox-seeded for a one-command populated sandbox


### Other
- Add shared tailwind v4 and shadcn-svelte base (ui)
- Address PR review feedback (#262)

    Stamp fixture identities sandbox-only, embed local-only relays, harden
    sandbox-root/mnemonic policy, make mid-squad crashes recoverable, and
    scope CI network isolation with unshare plus stronger seed assertions.


### Refactor
- Give pacto tokens one clear meaning (#259) (theme)


### Testing
- Guard PRODUCTION_IDENTIFIER against tauri.conf.json drift

## v0.5.5

### Bug Fixes
- Local-only cleanup when leaving an mls-store-reset group
- Deploy the download page from the release run (ci)
- Avoid following symlinks when scanning profile directories (#230)
- Match any commit in the push for release auto-tagging


### Chores
- Bump version to 0.5.5 (release)


### Features
- Sponsor zero-eth squad gov writes via eip-7702 userops (#121)
- Expandable chat input (#231)


### Other
- Address PR review feedback (#218)

- Match typed mdk_core::Error::GroupNotFound variant in leave_group instead of substring-matching the display text, avoiding misclassification of other engine/provider failures as already-left
- Remove tracker ID from test doc comment, describe the store-reset scenario directly


### Refactor
- Rename app database from vector.db to pacto.db
- Rename MLS engine store from vector-mls.db to pacto-mls.db (#230)

## v0.5.4

### Chores
- Bump version to 0.5.4 (release)

## v0.5.3

### Bug Fixes
- Bump @tauri-apps npm packages to match cargo-updated tauri crates
- Install default rustls crypto provider to fix startup panic
- Eliminate svelte-check warnings across frontend components
- Enable additional TypeScript strictness checks and fix findings
- Recover channels after the mls store reset
- Harden mls store reset recovery and split reset module boundaries
- Expose mls restore access for post-upgrade members
- Prefill squad recreate with preserved mls members
- Harden mls harvest matching and post-reset prune
- Quarantine gift-wrap timeouts and harden mls reset floors
- Harden mls prune-test cleanup and clear unused rust imports


### Chores
- Record upgrade task completion
- Bump version to 0.5.3 (#204) (release)


### Documentation
- Explain the mls reset recovery model
- Clarify mls upgrade rollout and archive non-revocation


### Features
- Mandatory update gate for breaking releases (#202)


### Other
- Cargo update to patch mls-crypto, openssl, quinn-proto, tar, tauri cves
- Pnpm update to patch vitest critical + vite/kit/svelte/astro cascade
- Pnpm.overrides for residual cookie/esbuild/ws transitive pins
- Upgrade nostr and MDK dependencies


### Styling
- Run cargo fmt across src-tauri


### Testing
- Keep the archive-move failure gate honest under root

## v0.5.2

### Bug Fixes
- Recover missed dm/giftwrap traffic on long-lived sessions
- Harden session-recovery sync state machine against restart, panic, and clock races
- Close wake-sync race and relay-toggle staleness in the DM sync UI


### Chores
- Bump version to 0.5.2 (release)

## v0.5.1

### Bug Fixes
- Build linux amd64 release on ubuntu-22.04 to avoid appimage wayland egl crash
- Add canonical, og:image:alt, and twitter creator metadata to landing page
- Update create-pull-request action to v8
- Grant release workflow contents:write permission
- Sign commits created by create-pull-request action


### Chores
- Automate version-bump PR and homebrew tap update
- Bump version to 0.5.1 (release)
- Auto-tag releases after prepare-release PR merges


### Other
- Update signing public key

## v0.5.0

### Bug Fixes
- Add messaging namespace to i18n translation keys
- Consent-first squad admit, channel catch-up, and nav reorder
- Point to current deployment for squad-sponsor
- CR late-joiner findings for welcome fallback, i18n, nav persistence, and admit guard
- Add rich link previews and fix social icons on landing page (#163)
- Guard account cleanup scan against in-flight account creation
- Send groupId (not group_id) to sync_mls_groups_now invoke
- Guard evm ensure_ready against unset encryption key during restore
- Stop boot-time account scan from deleting valid accounts on query error
- Prevent relay input overflow from content-box width sizing
- Dedupe mls welcome wrapper events on resync
- Make relay refresh spinner visibly spin, drop flashing detail-loading text
- Account list no longer excludes the auto-selected account
- Retry transient mls welcome failures instead of discarding them
- Start relay health-check monitor and catch future orphaned tauri commands in ci
- Orphaned-tauri-commands scanner misses nested generic invoke<>()


### Chores
- Add i18n lint rule and locale parity tests
- Chore: ignore AppImage build artifacts
       - Fix issues with make lint
- Bump version to 0.5.0 (release)


### Documentation
- Plan the svelte-5-runes migration and require runes in new files
- Close out calm-notifications epic; dev tooling notes


### Features
- Scaffold svelte-i18n runtime, locale store, and persistence wiring
- Extract auth, navigation, and messaging strings for i18n
- Extract settings, profile, and wallet strings for i18n
- Extract governance, commons, and announcement strings for i18n
- Extract lib-module strings and backend error mapping for i18n
- Complete spanish i18n coverage across app ui
- Add missing spanish i18n locale catalogs
- Explain mls history limits with a local channel welcome
- Gov-event gossip for status view and custom squad-level rpc with backup to avoid rate limits (#140)
- Add backend-owned app-config with frontend validation and enforcement
- Messaging enhancements — reactions, attachments, image viewer, sync status (#157)
- Crop and resize avatar images before upload
- Cap squad and channel name length via app-config
- Instrument events_received/bytes_down on event receipt (relays)
- Instrument events_sent/bytes_up at send call sites (relays)
- Add relay metrics/logs API wrappers and health-state helper (relays)
- Add inline expandable relay health detail panel (relays)
- Notification core — per-chat levels, severity tiers, coalesced emit
- Notification settings, backend unread counts, catch-up store
- Catch-up destination — counts, filters, navigation & UI


### Other
- Add visual identity
- Simplify relay health instrumentation and detail panel (relays)
- Correct receive-count undercount, relay-detail retry dead end, and log flooding (review)


### Testing
- Expand frontend coverage

## v0.4.0

### Bug Fixes
- Update ai.json tauri mcp command to use direct node path
- Repair tauri-e2e job after docker image update (ci)
- Make updater relaunch restart the updated app on macOS


### Chores
- Record closures for pacto-app-ayq mention feature (beads)
- Bump version to 0.4.0 (release)


### Documentation
- Docs(mentions) - Add initial plan and idea files
- Add tauri mcp integration guide and ui validation policy


### Features
- Add @ mentions to squad channels (mentions)
- Add self-correcting AI testing architecture


### Other
- Capitalize product name
- Bd init: initialize beads issue tracking
- Update beads ignore file and create bead
- Add vulkan deps and rust/pnpm caches for faster linux builds
- Add prebuilt CI base image
- Switch backend-tests job to pacto-ci container image
- Switch release-symbol-check to pacto-ci container and add tauri-e2e diagnostics

## v0.3.2

### Bug Fixes
- Clarify install/relaunch state and error messages (#117) (updater)
- Sync squad MLS state across peers and stop raw JSON in UI (#111)


### Chores
- Bump version to 0.3.2 (#120) (release)


### Refactor
- Adopt refinery for SQLite migrations (#119)

## v0.3.1

### Chores
- Bump version to 0.3.1 (#115) (release)


### Documentation
- Add install instructions for macOS, Linux, and Windows (#107)


### Features
- Add automatic idle lock and migration gate for sensitive operations (#96) (session)
- Add verified seed-backup gate for risky actions (#114)


### Other
- Include install instructions in release notes (#108)
- Docs/install instructions (#109)

* docs: add install instructions for macOS, Linux, and Windows

* ci: include install instructions in release notes

## v0.3.0

### Bug Fixes
- Grant build job artifact write permission for landing deploy (ci)
- Resolve release tag from GITHUB_REF only for tag refs (ci)
- Add pages and id-token permissions to landing build job (ci)
- Replace withastro/action with explicit build/upload steps (#79) (ci)
- Keep payout addresses private to consent-based DM exchange
- In-app Check for Updates with build introspection (#104) (updater)


### Chores
- Bump version to 0.3.0 (#106) (release)


### Documentation
- Add macOS install quarantine note (#80) (readme)
- Document encryption architecture and user-facing cryptography guidance (#99)


### Features
- Operable governance UI with roles tree and module panels (#83) (squad)
- Per-device salt and migration to v2 (#95) (crypto)
- Hats-first sponsor deploy with ext ala carte and ungated safe (#86) (squad)
- Hats-first sponsor deploy, sponsored gov writes, and orchestrated launchpad (#100) (squad)

## v0.2.0

### Bug Fixes
- Pin encryption decryption
- Rm channel modal
- Logout restart
- Squad channel filter
- Track mls group membership across devices
- Path name correction
- Release workflow
- Workflow
- Workflow windows + delete android
- No key-package for member bug
- Poll rumor
- Add missing resetDashboardPrefetchSession import
- Balance read bug
- Allow-build
- Harden local-dev defaults and fix relay/env issues (review)
- Resolve P1/P2/P3 local-dev review findings (review)
- Restore missing lastDm localStorage read (persistence)
- Gate local Anvil to dev/test builds and tighten tests (dev)
- Squad-dashboard hydratation on-start
- Mls exit channel asymmetry
- Address Copilot PR review (PinInput, hub replay race, wallet dedupe)
- Backfill reply context for bot replies that beat original message persistence (dm)
- Clean up cargo check diagnostics (rust)
- Resolve svelte-check errors (frontend)
- Finish resolving svelte-check errors (frontend)
- Source testability tweaks for new frontend test coverage
- Resolve svelte-check type errors (frontend)
- Resolve ESLint errors and align config with legacy Svelte patterns (#67) (lint)
- Install xdg-utils for Ubuntu AppImage bundling (ci)


### Chores
- Init
- Remove mock data
- Change argon-2-id salt
- Update package
- Update lockfile
- Lock file update
- Delete docs from gitignore
- Add release workflow
- Rules
- Cleanup
- Add @vitest/coverage-v8@3.2.4 for test coverage reports (dev)
- Add coverage npm scripts (dev)
- Restore missing android module stubs (android)
- Land safe mechanical lint fixes so lint stays green (#71) (lint)
- Add changelog automation and align package version (#75) (release)
- V0.2.0 changelog and ARM64 CI fix (#76) (release)


### Documentation
- Update README
- Add all OS guides
- Add sub-folder
- Rename windows guide
- Agent docs
- Edit
- Update
- Consolidate
- Update squads
- Mark P1/P2/P3 findings as resolved (review)
- Document Local Anvil dev setup (wallet)
- Rename local setup doc and consolidate dev guidance (wallet)
- Add AGENTS.md repository guidelines and Tauri v2 agent skills (agents)
- Add strategy, concepts, and architecture docs for humans and agents
- Update
- Add value-based-pr skill and reference in AGENTS.md
- Split out documentation and skills from PR #59
- Correct NIP-17 terminology, read-plane split, storage nuance, and remove Aztec (ARCHITECTURE)


### Features
- Add vector backend logic
- Nav/tab button
- Icons
- Community channels
- Messages and input
- Message channel filter
- Profile page
- Key encryption and retrieval
- New cp
- Create and export keys
- Avatar pull and offline logic
- Profile fetching from relays
- Auto profile pull on start
- Direct messenger UX
- Message to relay
- Message fetching
- Fetch msgs w/ notifs
- Message sorting
- Pfp and nostr account network changes from app
- Mls channel creation
- Invite to squad modal
- Exit squad
- Pin dms
- Emoji library
- Storage wipe on logout
- Mls group invite card
- Network invite card
- Network & channel handling & storage
- Break network into squad
- Exit modal
- Evm key derivation
- Add viem
- Squad dashboard
- Embedded evm wallet and viem read functions
- Backend evm signatures
- Wallet sidebar
- Etherscan tx hash tracking
- Private key exchange
- Multisig-safe deployment
- Themes
- Seed-phrase-based accounts
- Block user
- Resizable wallet bar
- Safe deployer
- Deployer modal
- Backend and nostr rumors for poll voting
- Governance launch pad
- Mod squad infra
- Contract api
- Squad-sponsor flow
- Generic chain reads
- Hat tree
- Dm deployment update
- Gov modal deployment flow
- Deploy stand-alone safes
- Advanced wallet
- Signer for advanced wallet
- Chat date-n-time
- Network selector
- Rpc setup
- Pinned internal app inbox
- Commons
- Common card
- Common filter
- Commons modal
- Commons ux
- Export nsec button
- Export seed button
- Sponsor-contract deploy modal
- Optimistic payment request
- Unread notifications
- Add Local Anvil chain (31337) for dockerized dev stack (wallet)
- Auto-wire local Docker dev stack in dev mode
- Add commons categories
- Mls squad-inbox gossip
- Backend network snapshot extraction
- Add gnosis-safe contracts on arbitrum
- Squad-wide network selection
- Allow ws:// localhost/127.0.0.1 dev relay URLs (relays)
- Pacto Gov deploy flow, squad-bot join inbox, and governance dashboard (#68) (governance)
- Public download site with arch-aware downloads and native ARM64 CI (#74)


### Other
- Edit capabilities and config
- Rm template code
- Vector backend pull
- Vector mini-apps pull
- Cargo toml
- Vector sound pull
- Packages
- Add init-finished logic
- Error handling
- Communities => squads
- Add dm error handling
- Message pagination
- Typing notif & fetching notif
- Persistent last message
- Sort dms into friends, requests, & pending
- Icon update
- Squad & default channel creation
- Allow 1-member mls groups on squad creation
- Optional themes
- Typing improvement
- Typing improvement
- Flow
- Improvements
- Mls groups from friends & pinned
- Fix
- Fix
- Mls invites
- Comments
- Sync channel names
- Notifications
- Improvements
- State persistance from settings view
- Enhance README with platform details and features

Expanded the README to include detailed platform features, architecture, and technology stack.
- Simplify Pacto description in README

Removed redundant mention of cryptographic and database management logic in the Pacto description.
- Sidebar wallet
- Clear sessions on logout-in
- Comments
- Aztec theme
- Dms
- Tx notifications
- Safe-deploy modal
- Dm wallet exchange
- Poll voting
- Add pacto-gov as pinned submodule under third_party/pacto-gov

Document clone/init and bump policy in docs/wallet/PACTO_GOV_SUBMODULE.md;
link from root README and wallet docs index.

Co-authored-by: Cursor <cursoragent@cursor.com>
- Checkout pacto-gov submodule recursively before Tauri build
- Hydration standardization
- Commons mode
- Key mgmt
- View squad signer
- Upgrade pnpm to 11.7.0 and update action versions
- Add typecheck, lint, and unit test quality gate
- Squad dashboard & polls
- Potential fix for pull request finding

Co-authored-by: Copilot Autofix powered by AI <175728472+Copilot@users.noreply.github.com>
- Potential fix for pull request finding

Co-authored-by: Copilot Autofix powered by AI <175728472+Copilot@users.noreply.github.com>
- Potential fix for pull request finding

Co-authored-by: Copilot Autofix powered by AI <175728472+Copilot@users.noreply.github.com>
- Potential fix for pull request finding

Co-authored-by: Copilot Autofix powered by AI <175728472+Copilot@users.noreply.github.com>
- Address PR review feedback (#54)

- Fix use-after-move in message.rs backfill emit loop by cloning reply.id
- Fix use-after-move and remove stderr spam in lib.rs backfill emit loop
- Allow ws://127.0.0.1 without port in relay validation to match error message
- Update relay validation tests for loopback without port

Note: pre-existing failure in npm run check (unrelated TypeScript/vite errors) not addressed by this PR.
- Add Makefile for app lifecycle commands
- Address PR review feedback (#58)

- Reorder import type before export re-exports in src/lib/commons/types.ts to match codebase convention.
- Fix indentation of parseSupportedChainId import in src/routes/+page.svelte to align with surrounding imports.
- Split CI into frontend and backend jobs and remove ignore-failure gates (ci)


### Refactor
- Reduce aargon2id iterations for faster decryption
- Rm pivx payments
- Cache trusted relays
- Simplify code
- Rm PROFILE_CACHE_DEBUG.md
- Enforce >1 mls group creation
- Rm packages in favor of minified files
- Separate squad invite from channel invite
- Networks functionality
- Remove bloat
- Modular re-usable approach to squads and networks
- Ux components to match backend refactor
- Reveal evm address in update account creation
- Virtual channel buckets
- Governance modes
- Evm alloy
- Dashboard tabs
- Monitor to inbox
- User settings
- Cleanup
- Reduce loc
- Dashboard onchain fetching
- Chain refreshing
- Settings
- Hydrate
- Squad channel life-cycle
- Optimistic dm-wallet announcements
- Add timeout guard to local-dev relay setup
- Chain network optionality
- Replace anvil term with local


### Revert
- Mls proposal handling


### Styling
- Collaspable settings sections
- Chains selector
- Ux


### Testing
- Scaffold smoke
- Add coverage for Local Anvil chain (31337) (wallet)
- Add backend unit tests for crypto, EVM, storage, and catalog helpers (rust)
- Add frontend unit tests for stores, utils, API, app, dashboard, governance, and parent flows (#65) (frontend)



## v0.1.0

- Init project.
