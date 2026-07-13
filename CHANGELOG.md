# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## Unreleased

## v0.2.0

### Highlights
- Delivered a full squad-centric governance experience: deploy flows, governance dashboard, squad-bot inbox join flow, polls, and sponsorship workflows.
- Significantly upgraded wallet capabilities: embedded/advanced wallet UX, signer flows, seed/export actions, Safe deployment paths, and better transaction visibility.
- Expanded communication features: stronger DM/squad inbox behavior, unread notifications, pinned inbox patterns, and improved message reliability/sorting.
- Improved multi-network support: better network selection/reads, relay compatibility for local development, and broader chain contract coverage.
- Released public distribution improvements, including architecture-aware downloads and native ARM64 CI support.

### Reliability & Quality
- Fixed key bugs across encryption, MLS membership/channel lifecycle, dashboard hydration, local storage/session recovery, and relay validation.
- Addressed major review findings (P1/P2/P3) and multiple PR follow-ups, including race/use-after-move fixes and stability hardening.
- Reduced frontend and Rust type/check noise by resolving svelte-check, ESLint, and cargo diagnostics issues.

### Developer Experience
- Improved local-dev workflow with Local Anvil support, dockerized dev wiring, safer defaults, and tighter dev/test gating.
- Strengthened CI quality gates (typecheck, lint, unit tests), split CI jobs for clearer failures, and expanded backend/frontend test coverage.
- Streamlined release/process tooling with changelog automation, version bump validation/shortcuts, submodule build handling, and dependency/action updates.

### Documentation
- Consolidated and expanded setup/architecture guidance (including local wallet/dev flows and agent-facing docs) for easier onboarding and maintenance.


## v0.1.0

- Init project.
