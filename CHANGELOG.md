# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## Unreleased

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
- Set up CHANGELOG.md and automated changelog generation (release)
- Align package.json version with tauri/cargo (0.2.0) (release)
- Add version bump script with validation (release)
- Support patch/minor/major shortcuts in bump script (release)
- Collapse v0.1.0 and compact changelog format (release)


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
