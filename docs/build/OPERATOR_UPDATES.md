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
- **macOS: app closes but does not relaunch after updating:** this can happen when the process exits before the updater's spawned replacement is fully launched (tauri-apps/tauri#11392). The in-app relaunch now routes through a backend command that runs `cleanup_before_exit()` followed by `tauri::process::restart()` directly, which avoids the race.
- **macOS: update downloads but fails to install with "Failed to move the new app into place":** the app is likely sandboxed or installed with permissions that prevent replacing `/Applications/pacto.app`. Ensure the app is installed by dragging to `/Applications`, run `xattr -r -d com.apple.quarantine /Applications/pacto.app`, and approve any system prompt for administrator privileges.
- **Unsigned builds and Gatekeeper:** Pacto is currently unsigned. On macOS, removing the quarantine attribute before first launch is required; otherwise Gatekeeper translocation can cause the updater to modify a temporary copy instead of the app in `/Applications`. On Windows, unsigned installers may trigger SmartScreen; users should choose "More info" → "Run anyway".
- **Linux AppImage: blank window / `Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...` on Wayland (Fedora, Arch, NixOS):** the AppImage bundles its own `libwebkit2gtk`; newer Ubuntu-built copies hit an upstream webkit2gtk EGL platform-detection bug on non-Ubuntu Wayland compositors, while the `.deb`/`.rpm` (which use the host's system `libwebkit2gtk`) are unaffected. `publish-tauri` now builds the `x86_64-unknown-linux-gnu` target on `ubuntu-22.04` — the oldest LTS still shipping `libwebkit2gtk-4.1-dev` — per Tauri's own guidance to build on the oldest supported base system. The `aarch64-unknown-linux-gnu` target stays on `ubuntu-24.04-arm` because the `glslc` apt package `whisper-rs`/`ggml-vulkan` needs at build time is not published for Ubuntu 22.04 (LunarG's Vulkan SDK, used on x86_64 instead, has no arm64 build); arm64 AppImage users may still hit this bug until an arm64-compatible `glslc` source is found.
