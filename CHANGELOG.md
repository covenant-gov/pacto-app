# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## v0.7.4

### Bug Fixes
- Start publish when the release tag is created (ci) (#399) by @logicminds, closes #397
- Restore green CI and wire the clipboard clear action (export) (#404) by @logicminds
- Harden trusted-relay dm delivery and heal stuck pending threads (#402) by @daopunk
- Prove kind-0 relay storage and autofocus reply composer (#406) by @daopunk
- Keep dm threads pinned to the newest message (#403) by @logicminds, closes #401
- Isolate polls hub badge and restore squads after storage wipe (#412) by @daopunk
- Authenticate squad rejoin requests and harden restore after wipe (#414) by @daopunk
- Start live subscriptions from login, not a racy startup event (relays) (#417) by @logicminds


### Chores
- Bump astro from 7.1.6 to 7.2.8 (deps) (#408) by @dependabot[bot]
- Bump proxy-addr from 2.0.7 to 2.0.8 (deps) (#409) by @dependabot[bot]
- Bump devalue from 5.9.0 to 5.9.4 (deps) (#415) by @dependabot[bot]


### Features
- Strip tracking markers from message urls (#388) by @logicminds, closes #171
- Backend-mediated clipboard export for sensitive secrets (export) (#97) by @logicminds
- Show new broadcasts live instead of on a 60s poll (commons) (#413) by @logicminds, closes #396
- Surface standalone Squad Admin deploys on Status (dashboard) (#418) by @logicminds, closes #380


### Other
- Finish the release with the homebrew tap already updated (release) (#410) by @logicminds, closes #398


### Refactor
- Keep shell retry working under forced runes (svelte5) (#400) by @logicminds, closes #391

## v0.7.3

### Chores
- Isolate feature-branch app data and move Catch up off the mode switch (#389) by @daopunk


### Features
- Name-claim nft-gated gas sponsorship (#375) by @daopunk, closes #369, #371, #372, #373, #374, #377
- Global-tophat gas routing for username-nft-eligible members (#378) by @daopunk, closes #379
- Rebuild landing as branded long-scroll marketing page (#383) by @daopunk
- Add how-it-works explainer to landing site (#384) by @daopunk
- Add theme toggle, blog banner, and overscroll colors (website) (#386) by @daopunk
- Gallery onboarding splash across themes (auth) (#385) by @thebeyondr
- Invite designers to shape pacto's next identity (website) (#387) by @logicminds

## v0.7.2

### Bug Fixes
- Statically link liblzma to stop macos startup crash (#362) by @logicminds
- Show live tor transfer stats in the status popover (privacy) (#365) by @logicminds


### Documentation
- Research concord protocol migration feasibility (#364) by @logicminds


### Features
- Hide commons broadcasts and categories the user is not interested in (#357) by @logicminds, closes #134


### Refactor
- Split tauri commands out of lib.rs into domain modules (#366) by @logicminds

## v0.7.1

### Bug Fixes
- Sandbox cargo-test profile writes to a disposable temp dir (#348) by @logicminds, closes #347
- Create new squad sticker packs instead of failing with pack_id is empty (#349) by @logicminds, closes #285
- Consent-first mls acceptance (#346) by @daopunk
- Parallelize rust ci tests with cargo-nextest, report timing (#350) by @logicminds, closes #279
- Translate remaining hardcoded aria-label and toast strings (#353) by @logicminds


### Documentation
- Publish pacto design-system rules (ui) (#269) by @thebeyondr


### Features
- Gov guide built into hats tree display (#345) by @daopunk
- Add a presentational squad layout playground (shell) (#273) by @thebeyondr
- Add send-typing-indicators privacy setting (#354) by @logicminds, closes #170
- Route traffic through an embedded tor client (privacy) (#355) by @logicminds, closes #173
- Add web-previews setting to gate link-preview fetching (#359) by @logicminds, closes #172
- Add opt-in biometric unlock via touch id and windows hello (#356) by @logicminds, closes #179

## v0.7.0

### Bug Fixes
- Ad-hoc sign macOS app builds (#307) by @logicminds
- Clear make build warnings by deleting dead code, not suppressing it (#306) by @logicminds
- Create squads when a member's key package is stale, and say so when creation fails (#313) by @logicminds, closes #311
- Stop reclassifying failed MLS welcome retries as transient (#336) by @logicminds
- Stop mls welcome-delivery failures from orphaning groups (#339) by @logicminds, closes #321


### Features
- Convert root layout to svelte 5 runes (pacto-app-a7r.21) (#322) by @logicminds
- Convert channel modals and roster item to svelte 5 runes (pacto-app-a7r.12) (#323) by @logicminds
- Convert parent/ dashboard-polls, create-poll, deploy-safe, my-dashboard, setting-up to svelte 5 runes (pacto-app-a7r.15) (#324) by @logicminds
- Convert governance treasury, roles, and security panels to svelte 5 runes (pacto-app-a7r.19) (#325) by @logicminds
- Convert commons/ components to svelte 5 runes (pacto-app-a7r.14) (#326) by @logicminds
- Convert settings components to svelte 5 runes (pacto-app-a7r.11) (#327) by @logicminds
- Convert governance deploy-and-launch modals to svelte 5 runes (pacto-app-a7r.17) (#328) by @logicminds
- Convert dm/ composer and thread to svelte 5 runes (pacto-app-a7r.26) (#329) by @logicminds
- Convert governance actions and proposals to svelte 5 runes (pacto-app-a7r.18) (#330) by @logicminds
- Convert small-file cluster to svelte 5 runes (pacto-app-a7r.10) (#331) by @logicminds
- Convert layout navbar/sidebar components to svelte 5 runes (pacto-app-a7r.20) (#332) by @logicminds
- Convert wallet/ components to svelte 5 runes (pacto-app-a7r.13) (#333) by @logicminds
- Convert parent dashboard tabs and modals to svelte-5 runes (pacto-app-a7r.16) (#334) by @logicminds
- Convert dm/ message-rendering components to svelte 5 runes (pacto-app-a7r.25) (#335) by @logicminds
- Dual-publish MLS key packages on kind 30443, accept legacy 443 (#338) by @logicminds, closes #312
- Wargames (#305) by @daopunk, closes #138, #290, #291, #292, #293, #294, #295, #296, #297, #298, #299, #300, #301, #302, #303, #304, #316, #317, #318, #319
- Nostr-to-evm eip-712 cert (#342) by @daopunk
- Speed up two-window sandbox demo (#343) by @logicminds


### Refactor
- Dedupe commons-broadcast presentation logic (#308) by @logicminds
- Convert on: directives to Svelte 5 event attributes repo-wide (#309) by @logicminds
- Convert dm/ dispatchers to callback props (#310) by @logicminds
- Convert ui/ to Svelte 5 runes (#314) by @logicminds
- Convert announcements/ to Svelte 5 runes (#315) by @logicminds
- War-game (#341) by @daopunk

## v0.6.1

### Bug Fixes
- Stop 0.5.x upgrades from tripping the storage-format gate (#275) by @logicminds
- Patch nanoid and hono to close dependabot alerts (#287) by @logicminds
- Dm relay bug and error messaging in ui (#281) by @daopunk, closes #158


### Features
- Offer a refusable join for groups that added you without an invite dm (#267) by @logicminds
- Add sticker packs and an opt-in klipy gif picker to composer (#243) by @logicminds, closes #200
- Make squad governance process readable and actionable (#256) by @daopunk, closes #221, #223
- Relay connection diagnostics, pre-add probe, and TLS certificate inspection (#270) by @logicminds
- Squad pfp and pfp picker (#278) by @daopunk, closes #209, #276


### Other
- Update pacto.app to Pacto.app (#288) by @logicminds


### Refactor
- Use squad-evm language and escuad slang in member copy (#280) by @daopunk, closes #257

## v0.6.0

### Bug Fixes
- Clean up chat rows and cursor on voluntary group leave (mls) (#234) by @logicminds, closes #219
- Make dm delete purge history and gate relay replay (#233) by @daopunk, closes #220
- Switch refinery migration versions to UTC timestamps (#240) by @logicminds, closes #238
- Recover mls on wake and route poll creates to announcements (#235) by @daopunk, closes #139
- Recover the event stream when relays arrive after login (#254) by @logicminds
- Make the sandbox port claim atomic across concurrent launches (#255) by @logicminds
- Durable consent-first invite admit and Join inbox reliability (#241) by @daopunk, closes #210, #211
- Let two dev sandboxes run at once (#261) by @logicminds
- Refuse a second launch against one sandbox root (#264) by @logicminds
- Seed a reachable squad and add a one-command dev sandbox (#265) by @logicminds
- Restore the pr gate by quoting an unparseable ci step (#268) by @logicminds


### Features
- Persist sponsored userop fee ledger for treasury (#242) by @daopunk, closes #222
- Seed a populated sandbox with no docker and no network (#262) by @logicminds
- Quarantine stale sandbox profiles instead of bricking boot (#263) by @logicminds


### Other
- Boot agent sandboxes authenticated, local-routed, and collision-free (#244) by @logicminds
- Let debug builds reach a locally-issued wss relay (#248) by @logicminds
- Give dev sandboxes a stable branch-scoped root and named personas (#249) by @logicminds
- Keep public default relays out of an overridden sandbox (#250) by @logicminds
- Let dev-login sandboxes act: mark the identity backup-verified (#251) by @logicminds
- Refuse stale local-chain artifacts instead of failing inside a contract call (#252) by @logicminds
- Add shared tailwind v4 and shadcn-svelte base (ui) (#258) by @thebeyondr


### Refactor
- Give pacto tokens one clear meaning (theme) (#259) by @thebeyondr

## v0.5.5

### Bug Fixes
- Allow leaving mls groups with lost store-reset state (#218) by @logicminds, closes #216
- Deploy the download page from the release run (ci) (#229) by @logicminds, closes #213
- Auto-tag releases regardless of merge strategy (ci) (#232) by @logicminds


### Features
- Sponsor zero-eth squad gov writes via eip-7702 userops (#121) by @daopunk
- Expandable chat input (#231) by @daopunk, closes #212


### Refactor
- Rename app database from vector.db to pacto.db (#230) by @logicminds, closes #217

## v0.5.3

### Bug Fixes
- Eliminate svelte-check warnings across frontend components (#195) by @logicminds
- Enable additional TypeScript strictness checks and fix findings (#196) by @logicminds


### Features
- Mandatory update gate for breaking releases (#202) by @logicminds


### Other
- Patch mls-crypto, openssl, quinn-proto, tar, tauri cves (#192) by @logicminds
- Pnpm update patches vitest critical + vite/kit/svelte/astro cascade (#193) by @logicminds
- Pnpm.overrides for residual cookie/esbuild/ws pins (#194) by @logicminds
- Upgrade nostr and recover incompatible mls state (#198) by @logicminds, closes #53


### Styling
- Run cargo fmt across src-tauri (#201) by @logicminds

## v0.5.2

### Bug Fixes
- Recover missed dm/giftwrap traffic on long-lived sessions (#189) by @logicminds

## v0.5.1

### Bug Fixes
- Build linux amd64 release on ubuntu-22.04 to avoid appimage wayland egl crash (#184) by @logicminds, closes #81
- Landing OpenGraph metadata and workflow permissions (#186) by @logicminds


### Chores
- Automate version-bump PR and homebrew tap update (#183) by @logicminds
- Auto-tag releases after prepare-release PR merges (#188) by @logicminds


### Other
- Update signing public key (#185) by @logicminds

## v0.5.0

### Bug Fixes
- Channel sync (#155) by @daopunk, closes #149
- Add rich link previews and fix social icons on landing page (#163) by @logicminds, closes #151
- Stop invite-to-channel modal hanging on a full-account MLS sync (#177) by @logicminds, closes #150


### Documentation
- Plan the svelte-5-runes migration and require runes in new files (#167) by @logicminds
- Add visual identity and commons dashboard ideation artifacts (#168) by @logicminds


### Features
- Complete spanish i18n coverage across app ui (#153) by @logicminds
- Gov-event gossip for status view and custom squad-level rpc with backup to avoid rate limits (#140) by @daopunk
- Add backend-owned app-config with frontend validation and enforcement (#161) by @logicminds, closes #154
- Messaging enhancements — reactions, attachments, image viewer, sync status (#157) by @logicminds, closes #143
- Cap squad and channel name length via app-config (#164) by @logicminds, closes #152
- Crop and resize avatar images before upload (#166) by @logicminds, closes #127
- Add per-relay health detail to Nostr settings (relays) (#169) by @logicminds
- Calm notifications with unified counts and Catch up review (#176) by @logicminds, closes #148

## v0.4.0

### Bug Fixes
- Capitalize product name in desktop app config (#123) by @logicminds
- Ensure updater relaunch restarts the updated app on macOS (#133) by @logicminds


### Features
- Add beads issue tracking for persistent agent task management (#128) by @logicminds
- Add @ mentions to squad channels (mentions) (#129) by @logicminds
- Add self-correcting AI testing architecture (#131) by @logicminds, closes #47


### Other
- Fix linux tauri build and add reusable CI base image (#132) by @logicminds

## v0.3.2

### Bug Fixes
- Clarify install/relaunch state and error messages (updater) (#117) by @logicminds
- Sync squad MLS state across peers and stop raw JSON in UI (#111) by @daopunk


### Refactor
- Adopt refinery for SQLite migrations (#119) by @logicminds

## v0.3.1

### Documentation
- Add install instructions for macOS, Linux, and Windows (#107) by @logicminds


### Features
- Add automatic idle lock and migration gate for sensitive operations (session) (#96) by @logicminds
- Add verified seed-backup gate for risky actions (#114) by @logicminds, closes #112


### Other
- Include install instructions in release notes (#108) by @logicminds
- Docs/install instructions (#109) by @logicminds

## v0.3.0

### Bug Fixes
- Grant build job artifact write permission for landing deploy (ci) by @logicminds
- Resolve release tag from GITHUB_REF only for tag refs (ci) by @logicminds
- Add pages and id-token permissions to landing build job (ci) by @logicminds
- Replace withastro/action with explicit build/upload steps (ci) (#79) by @logicminds
- Keep payout addresses private to consent-based DM exchange (#77) by @daopunk
- In-app Check for Updates with build introspection (updater) (#104) by @logicminds, closes #70


### Documentation
- Add macOS install quarantine note (readme) (#80) by @logicminds
- Document encryption architecture and user-facing cryptography guidance (#99) by @logicminds


### Features
- Operable governance UI with roles tree and module panels (squad) (#83) by @daopunk
- Per-device salt and migration to v2 (crypto) (#95) by @logicminds
- Hats-first sponsor deploy with ext ala carte and ungated safe (squad) (#86) by @daopunk, closes #89
- Hats-first sponsor deploy, sponsored gov writes, and orchestrated launchpad (squad) (#100) by @daopunk

## v0.2.0

### Bug Fixes
- Path name correction by @daopunk
- Release workflow by @exo404
- Workflow by @exo404
- Workflow windows + delete android by @exo404
- Add missing resetDashboardPrefetchSession import (#39) by @logicminds
- Ux bugs (#38) by @daopunk
- Resolve svelte-check errors (frontend) (#58) by @logicminds
- Source testability tweaks for new frontend test coverage (#64) by @logicminds
- Resolve svelte-check type errors (frontend) (#66) by @logicminds
- Resolve ESLint errors and align config with legacy Svelte patterns (lint) (#67) by @logicminds
- Install xdg-utils for Ubuntu AppImage bundling (ci) by @logicminds


### Chores
- Init by @daopunk
- Land safe mechanical lint fixes so lint stays green (lint) (#71) by @logicminds


### Documentation
- Add sub-folder by @daopunk
- Add AGENTS.md repository guidelines and Tauri v2 agent skills (agents) (#52) by @logicminds
- Add strategy, concepts, and architecture docs (#55) by @logicminds
- Make contributor guidance accurate and discoverable (#60) by @logicminds


### Features
- Frontend (#2) by @daopunk
- Login (#4) by @daopunk
- Create and export keys (#6) by @daopunk
- Dms (#8) by @daopunk
- DM UX improvements (#12) by @daopunk
- Pfp and nostr account network changes from app (#13) by @daopunk
- Dm-ux (#14) by @daopunk
- Mls-channel creation (#15) by @daopunk
- Emoji library (#16) by @daopunk
- Mls invites (#18) by @daopunk
- Networks (#19) by @daopunk
- Network-deconstruction (#20) by @daopunk
- Evm wallet (#23) by @daopunk
- Backend evm signatures (#25) by @daopunk
- Chain and network selectors (#27) by @daopunk
- Basic payment on-chain transaction (#28) by @daopunk
- Multisig-safe deployment (#29) by @daopunk
- Ux (#30) by @daopunk
- Dm-wallet (#31) by @daopunk
- Resizable wallet bar by @daopunk
- Safe deployer by @daopunk
- Deployer modal (#34) by @daopunk
- Gov core (#35) by @daopunk
- Ux improvements (#36) by @daopunk
- Commons ux (#37) by @daopunk
- Gov ui (#41) by @daopunk
- Auto-wire local Docker dev stack and add Local Anvil chain (dev) (#44) by @logicminds, closes #40
- Sponsor squad flow (#51) by @daopunk
- Pacto Gov deploy flow, squad-bot join inbox, and governance dashboard (governance) (#68) by @daopunk
- Public download site with arch-aware downloads and native ARM64 CI (#74) by @logicminds


### Other
- Feat/login (#3) by @daopunk
- Update/vector-backend-pull (#5) by @daopunk
- Feat/avatar (#7) by @daopunk
- Update README with all OS prerequisites (#24) by @exo404
- Enhance README with platform details and features by @daopunk
- Update docs and release workflow (#26) by @exo404
- Simplify Pacto description in README by @daopunk
- Add typecheck, lint, and unit test quality gate (#46) by @logicminds
- Message handling improvements + codebase audit doc (#54) by @logicminds
- Add Makefile and clean up cargo check diagnostics (#57) by @logicminds
- Split CI into frontend and backend jobs and remove ignore-failure gates (ci) (#62) by @logicminds


### Refactor
- Reduce aargon2id iterations for faster decryption by @daopunk
- Minified files (#17) by @daopunk
- Squad & network channels (#22) by @daopunk
- Sqlite squad catalog (#42) by @daopunk


### Testing
- Add backend unit tests for crypto, EVM, storage, and catalog helpers (rust) (#63) by @logicminds
- Add frontend unit tests for stores, utils, API, app, dashboard, governance, and parent flows (frontend) (#65) by @logicminds



## v0.1.0

- Init project.
