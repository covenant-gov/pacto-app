# CI and supply-chain hardening

Protective controls for dependency installs and GitHub Actions in this repo.
This document does **not** claim the repository is free of compromise or fully
safe — it records what was hardened in-tree, what still depends on org/repo
admin settings, and known isolation limits.

## Goals (in-tree)

| Control | Where |
|--------|--------|
| Untrusted PR / dependency builds on disposable GitHub-hosted runners | All CI jobs use `ubuntu-latest` / `ubuntu-24.04` (or the Linux CI container). No self-hosted runners are configured in workflows. |
| Minimal default `GITHUB_TOKEN` permissions | Workflow `permissions:` default to read; write only on jobs that publish, tag, label, or deploy. |
| No checkout credential persistence where safe | `actions/checkout` uses `persist-credentials: false` except `tag-release.yaml` (must push tags). |
| Third-party Actions pinned to full commit SHAs | All `uses:` refs are 40-char SHAs with version comments; `pnpm check:actions-pinned` / CI enforces this. |
| `pull_request_target` must not run PR-controlled code with privileged creds | `labeler.yaml` never checks out PR code. `whats-new.yaml` checks out the **base** SHA only, installs with `--ignore-scripts`, then validates via the GitHub API. |
| Explicit dependency build-script approval + frozen lockfiles | `pnpm-workspace.yaml` `allowBuilds` + `strictDepBuilds`; CI uses `pnpm install --frozen-lockfile` (script tests also pass `--ignore-scripts`). |
| Bounded release-age with security-patch escape hatch | `minimumReleaseAge: 1440` with `minimumReleaseAgeExclude` for a small set of frequently patched toolchain packages. |
| Prod secrets off install steps | CI does not inject Alchemy / signing / tap secrets. Release signing keys and `HOMEBREW_TAP_TOKEN` are step-scoped on publish jobs after install. |

## Editor / agent execution surfaces (review only)

These can run local commands when a developer or agent opens the repo. None were
executed as part of the hardening change set; treat unexpected remote payloads
as untrusted.

| Path | Role |
|------|------|
| `.mcp.json` | Starts the local Tauri MCP server from `node_modules/@hypothesi/tauri-mcp-server` (stdio). Requires a prior install. |
| `.codex/hooks.json` | Codex session hooks that invoke `bd codex-hook …` (Beads context). |
| `.beads/hooks/*` | Beads git-hook wrappers (`pre-commit`, `pre-push`, …). |
| `.vscode/settings.json` / `extensions.json` | Editor settings and extension recommendations only — no task auto-run configured here. |
| `.cursor/rules/*.mdc` | Policy text for agents; not executable workflows. |

## Native / non-Linux release runners

`release.yaml` builds and signs on GitHub-hosted `macos-latest` and
`windows-latest` as well as Linux. Those jobs are still ephemeral hosted VMs,
but they are **not** the same as Linux CI containers:

- Signing material (`TAURI_SIGNING_PRIVATE_KEY` / password) is present on the
  `tauri-action` step of each matrix leg.
- Dependency install runs earlier on the same job without those secrets in the
  environment; `allowBuilds` still limits which package scripts may run.
- Hosted macOS runners cost more than Linux; the optional
  `macos-dylib-check` CI job remains **disabled** (`if: false`) and was not
  re-enabled by hardening.

Do not pretend a Linux-only substitute covers macOS/Windows signing isolation.

## Fork / contributor behavior preserved

- `pull_request` CI continues to run on fork PRs with read-only `contents`.
- Labeler / release-notes checks still support fork PRs via
  `pull_request_target` without checking out PR heads.
- Disabled e2e / macOS dylib jobs stay disabled (no cost or behavior widening).

## Owner-side prerequisites (YAML alone does not enforce)

Not verified in this environment (API returned insufficient permission or the
setting is org-level). An admin should confirm and enable as appropriate:

1. **Branch protection / rulesets on `main`**
   - Require PR before merge.
   - Require the existing CI status checks (typecheck, lint, frontend-tests,
     backend-tests, scripts-test, etc.).
   - Require review from CODEOWNERS for `.github/workflows/**` (CODEOWNERS file
     lists verified collaborators `@logicminds` and `@thebeyondr` only — no
     invented org teams).
2. **Actions settings**
   - Prefer disallowing self-hosted runners for this repo if not required.
   - Keep fork PR workflows on read-only tokens (GitHub default for
     `pull_request` from forks).
3. **Environment protection** for `github-pages` (landing deploy) — required
   reviewers / wait timer if desired; not configured by this PR.
4. **Secret hygiene** — signing and tap tokens only on release/publish
   environments; never add them to the PR `CI` workflow.
5. **Hosted runner cost** — release matrix already uses macOS + Windows;
   hardening does not add runners. Re-enabling `macos-dylib-check` would add a
   full macOS `--release` build per PR and should stay a conscious cost decision.

## What this hardening is not

- Not evidence of an active infection or worm in this repository.
- Not a substitute for dependency review, `pnpm audit`, or Rust crate review.
- Not a change to account, org, or Actions admin settings (those stay
  owner-operated).
- Not an unrelated dependency/framework upgrade.

## Related open work (do not duplicate)

At the time of the hardening PR, open PRs such as
[PR 472](https://github.com/covenant-gov/pacto-app/pull/472) (beta prereleases)
touched release workflows for product reasons. Merge conflicts on shared YAML
should keep both the product change and these pins/permissions.
