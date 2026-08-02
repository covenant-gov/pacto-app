# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## Unreleased

### Bug Fixes
- Recover missed dm/giftwrap traffic on long-lived sessions
- Harden session-recovery sync state machine against restart, panic, and clock races
- Close wake-sync race and relay-toggle staleness in the DM sync UI

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
