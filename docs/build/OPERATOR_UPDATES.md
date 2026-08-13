# Operator Guide: In-App Updates

The Pacto desktop app uses the Tauri v2 updater plugin. This document covers how release operators publish signed updates so the in-app **Check for Updates** flow can discover and install them.

## What gets published

The Tauri GitHub Action uploads platform installers and a `latest.json` manifest to the GitHub release. The app reads `latest.json` from:

```
https://github.com/covenant-gov/pacto-app/releases/latest/download/latest.json
```

That URL is configured in `src-tauri/tauri.conf.json` under `plugins.updater.endpoints`.

## Release workflow

1. Tag a release in the form `vX.Y.Z`, e.g. `v0.2.1`.
2. Push the tag: `git push origin v0.2.1`.
3. `.github/workflows/release.yaml` runs the `publish-tauri` job for:
   - macOS (`aarch64-apple-darwin`, `x86_64-apple-darwin`)
   - Linux (`x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`)
   - Windows (`x86_64-pc-windows-msvc`)
4. The workflow uploads installers and `latest.json` to the GitHub release.
   - `uploadUpdaterJson: true` tells the Tauri action to generate and attach `latest.json`.
5. Once the **entire** platform matrix finishes, `release.yaml` fans out three
   follow-up jobs, all gated on `needs: publish-tauri`:
   - `update-homebrew-tap` — opens a Cask bump PR against `covenant-gov/homebrew-pacto`.
   - `stamp-updater-compatibility` — stamps `minimum_compatible_version` onto `latest.json`.
   - `deploy-landing` — refreshes the public download page (see below).

## Download page (release → landing deploy)

The public download page at <https://covenant-gov.github.io/pacto-app/> is a
static Astro site in `landing/`. It renders `pacto-release.json`, which
`scripts/generate-release-manifest.mjs` builds from the GitHub release's actual
assets.

`release.yaml`'s `deploy-landing` job calls `.github/workflows/deploy-landing.yaml`
as a reusable workflow with `release_tag: ${{ github.ref_name }}`, so a tagged
release refreshes the download page with **no manual step**. Because the job
needs `publish-tauri`, the manifest is only generated after every platform has
uploaded its installers — the page never advertises a partial asset set. After
deploying, a `verify` job polls the live `pacto-release.json` and fails the run
if the served `tag` does not match the tag that was built.

`deploy-landing.yaml` intentionally has **no** `release: published` trigger.
tauri-action publishes the release using `GITHUB_TOKEN`, and runs authenticated
with `GITHUB_TOKEN` do not reliably fire other workflows' `release` listeners.
Depending on that event is what left the site serving v0.5.1 across the v0.5.2
and v0.5.4 releases (#213).

### Emergency republish

To rebuild the page outside a release — a Pages outage, a landing-site fix on
`main`, or a manifest that needs regenerating:

```bash
# Publish whatever release is currently `latest`:
gh workflow run deploy-landing.yaml

# Or pin a specific tag:
gh workflow run deploy-landing.yaml -f release_tag=v0.5.4
```

Leaving `release_tag` blank resolves to `releases/latest`. Deploys are
serialized by the `deploy-landing` concurrency group, so a dispatch issued
during a release deploy queues behind it rather than cancelling it.

## Signing key

The updater requires an Ed25519 key pair. The public key is embedded in `src-tauri/tauri.conf.json` at `plugins.updater.pubkey`. The private key is used at build time to sign the update bundles.

Set the private key as a repository secret **and never commit it to source control or expose it in the frontend bundle**:

- **Secret name:** `TAURI_SIGNING_PRIVATE_KEY`
- **Optional password secret:** `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

The release job reads these secrets in the `tauri-apps/tauri-action` step:

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

### Generating the key pair

If you need to rotate or create the updater signing key:

```bash
tauri signer generate
```

Save the public key for `tauri.conf.json` and store the private key in the repository secret.

## Manual smoke test

1. Build and install a signed release for the current platform, e.g. `v0.2.0`.
2. Push a new tag `v0.2.1` and wait for the release workflow to complete.
3. Open the installed `v0.2.0` app, go to **Settings > App > Updates**, and click **Check for Updates**.
4. Confirm the app reports `Update 0.2.1 available`.
5. Click **Download and install**, wait for the progress bar to complete, and click **Relaunch now**.
6. After restart, verify the app is running the new version (shown in the same Updates section).

Repeat on at least one additional desktop platform before promoting a release broadly.

## Troubleshooting

- **No update found when one exists:** verify the tag, the release workflow completion, and that `latest.json` is attached to the release.
- **Signature mismatch:** confirm the public key in `src-tauri/tauri.conf.json` matches the private key used to sign the release.
- **Missing platform asset:** the workflow must produce an installer for the running platform. Check the release assets and platform matrix in `.github/workflows/release.yaml`.
- **Download page shows an older version than the latest release:** check the `deploy-landing` job on the tag's `publish` run. If it never ran, the release predates the chained job; republish with `gh workflow run deploy-landing.yaml`. If it ran but the `verify` job failed, the Pages deployment did not serve the new manifest — re-run the workflow and confirm `curl -s https://covenant-gov.github.io/pacto-app/pacto-release.json | jq -r .tag`.
- **macOS: app closes but does not relaunch after updating:** this can happen when the process exits before the updater's spawned replacement is fully launched (tauri-apps/tauri#11392). The in-app relaunch now routes through a backend command that runs `cleanup_before_exit()` followed by `tauri::process::restart()` directly, which avoids the race.
- **macOS: update downloads but fails to install with "Failed to move the new app into place":** the app is likely sandboxed or installed with permissions that prevent replacing `/Applications/pacto.app`. Ensure the app is installed by dragging to `/Applications`, run `xattr -r -d com.apple.quarantine /Applications/pacto.app`, and approve any system prompt for administrator privileges.
- **Unsigned builds and Gatekeeper:** Pacto is currently unsigned. On macOS, removing the quarantine attribute before first launch is required; otherwise Gatekeeper translocation can cause the updater to modify a temporary copy instead of the app in `/Applications`. On Windows, unsigned installers may trigger SmartScreen; users should choose "More info" → "Run anyway".
- **Linux AppImage: blank window / `Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...` on Wayland (Fedora, Arch, NixOS):** the AppImage bundles its own `libwebkit2gtk`; newer Ubuntu-built copies hit an upstream webkit2gtk EGL platform-detection bug on non-Ubuntu Wayland compositors, while the `.deb`/`.rpm` (which use the host's system `libwebkit2gtk`) are unaffected. `publish-tauri` now builds the `x86_64-unknown-linux-gnu` target on `ubuntu-22.04` — the oldest LTS still shipping `libwebkit2gtk-4.1-dev` — per Tauri's own guidance to build on the oldest supported base system. The `aarch64-unknown-linux-gnu` target stays on `ubuntu-24.04-arm` because the `glslc` apt package `whisper-rs`/`ggml-vulkan` needs at build time is not published for Ubuntu 22.04 (LunarG's Vulkan SDK, used on x86_64 instead, has no arm64 build); arm64 AppImage users may still hit this bug until an arm64-compatible `glslc` source is found.

## Marking a release as breaking

A release that ships an incompatible on-disk change (a new database migration older builds cannot read) must raise the update floor so older clients are told to update instead of failing to unlock their data. This is separate from ordinary version bumps — most releases do not need it.

### Raising the floor ahead of a release

1. Edit `scripts/release-compatibility.json` and raise `minimumCompatibleVersion` to the lowest version that can still safely open the on-disk data this release writes, e.g.:
   ```json
   { "minimumCompatibleVersion": "0.6.0" }
   ```
2. Commit it on the branch that will be tagged.
3. Tag and push as usual (see **Release workflow** above). After the whole platform matrix in `publish-tauri` finishes, the `stamp-updater-compatibility` job in `.github/workflows/release.yaml` runs `node scripts/stamp-updater-compatibility.mjs`, downloads the just-published `latest.json`, merges in the tracked value as `minimum_compatible_version`, and re-uploads it to the same release. No separate step is required.

**The tracked value must not exceed the version being released.** The stamping job validates the candidate against the release's own `version` field before it uploads anything; if `minimumCompatibleVersion` is higher than the tag, the job throws and refuses to publish the stamped manifest — the release keeps its installers but its `latest.json` is left unstamped (or stamped with whatever it already had), rather than being written with an impossible floor.

**What clients below the floor experience:** on launch, a client whose installed version compares lower than `minimum_compatible_version` is shown a non-dismissible update-required screen — not a crash, and not a silent failure. The user cannot proceed into the app until they update.

### Correcting a wrong value

Use these in priority order.

**1. Primary: re-run the dispatchable workflow.** `.github/workflows/release-compatibility.yaml` re-stamps an already-published tag's `latest.json` without a new signed release. Trigger it either from the GitHub Actions UI (`release-compatibility` workflow → **Run workflow**, fill in `tag` and optionally `override`), or from the CLI:
   ```bash
   gh workflow run release-compatibility.yaml -f tag=v0.6.0 -f override=0.5.4
   ```
   Omitting `override` re-stamps using whatever `minimumCompatibleVersion` is currently tracked in `scripts/release-compatibility.json` on the default branch. This runs the identical validator as the automatic post-release step, so an out-of-range value is refused the same way.

**2. Emergency fallback: run the script locally.** If GitHub Actions itself is unavailable, someone with `gh` authenticated and push access to the repository can run the exact same script directly:
   ```bash
   node scripts/stamp-updater-compatibility.mjs v0.6.0 0.5.4
   ```
   The first argument is the tag, the second is the override value. This local invocation calls the same exported `validateMinimumVersion` / `mergeMinimumVersion` functions the automated job uses — it is not a bypass, and an out-of-range value fails the same validation.

   **After using either path to correct a value, mirror the final value back into the tracked `scripts/release-compatibility.json` and commit it.** The workflow and the local script both operate on the *published* `latest.json` only; they never write the tracked file. If the tracked file is left at the old value, the next tagged release re-runs the automatic stamping job with that stale value and silently regresses the correction.

## Automatic recovery from a stale sandbox profile

This is a **different** trigger from the minimum-version check above: it never touches the network. It fires when the app opens a profile's `pacto.db` on launch and finds a migration history this build doesn't recognize -- for example, a profile last opened by a newer or divergent build. Because the check runs before account selection, one bad profile blocks **every** account on that machine, not just the one it belongs to.

**Inside any sandbox** (`make dev` on a branch other than `main`, `make dev-sandbox`, `make dev-world`, or anywhere else `PACTO_TEST_SANDBOX_ROOT` is set), this is handled automatically. The storage doctor moves the offending profile directory aside under `<sandbox_root>/quarantine/` before the compatibility check runs, and boot proceeds against a fresh profile -- no manual step, and no other account on that sandbox is blocked. What moved and why is recorded in `<sandbox_root>/quarantine-record.json` (the profile, the verdict, and the offending schema version), appended to on every quarantine so the full history survives across boots.

**On `main` (the real OS data directory), quarantine never runs.** This is by construction: the doctor only acts inside a sandbox root, so it can never touch the real account. Hitting this block on `main` means the installed build is older than the schema its own account database was last written with (most commonly after downgrading, or running a newer build against it once) -- the fix is to install a build that recognizes that schema. Profile directories live under `<app_data_dir>/npub1…/pacto.db` -- see [`../storage-layout/SQLITE_AND_FILES.md`](../storage-layout/SQLITE_AND_FILES.md) for the on-disk layout and each platform's `<app_data_dir>`.

**Local dev cause and prevention:** the most common trigger isn't a shipped release at all -- it's checking out a branch with newer migrations, running it against a sandbox, then switching back to a branch that doesn't have those migrations yet. Every non-`main` branch already gets its own sandboxed data directory (`make dev`'s per-branch isolation), which is exactly what the doctor above now cleans up automatically instead of blocking the branch's next launch.

## Limits of this gate

- **The manifest is unsigned.** `latest.json`, including `minimum_compatible_version`, carries no signature — only the platform installers themselves are Ed25519-signed. Anyone who can write to the release's assets can alter the manifest.
- **The gate is forward-only.** It cannot reach installs from before this feature shipped; those clients have no code path that reads `minimum_compatible_version`.
- **The remote (minimum-version) trigger fails open by design**, so anyone able to interfere with the manifest fetch — blackholing it or corrupting the response — can suppress it entirely for a given client. The local storage-format trigger above is the one that survives this: it never depends on the network, so it cannot be defeated the same way.

## Dev-world sandbox aliases

`make dev-world` and `make dev-world-reclaim` in this repo delegate to the sibling `pacto-dev-env` checkout (`PACTO_DEV_ENV_DIR`, defaults to `../pacto-dev-env`) to populate or tear down this worktree's isolated sandbox — squad, identities, and the `world` marker in its sandbox handle. Neither target carries orchestration logic itself; that lives in `pacto-dev-env`'s `dev-world` / `dev-world-reclaim` targets. A missing sibling checkout fails fast, naming the expected path.
