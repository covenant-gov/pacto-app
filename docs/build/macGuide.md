# macOS Prerequisites Guide

## 1. System Dependencies

Install Xcode Command Line Tools (required compiler toolchain):

```bash
xcode-select --install
```

Install Homebrew (if not already installed):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Install required packages for Tauri + Rust native dependencies:

```bash
brew update
brew install cmake llvm pkg-config openssl@3 git wget
```

Configure environment variables for `clang`/`bindgen` and OpenSSL:

```bash
echo 'export PATH="$(brew --prefix llvm)/bin:$PATH"' >> ~/.zshrc
echo 'export LIBCLANG_PATH="$(brew --prefix llvm)/lib"' >> ~/.zshrc
echo 'export PKG_CONFIG_PATH="$(brew --prefix openssl@3)/lib/pkgconfig:$PKG_CONFIG_PATH"' >> ~/.zshrc
source ~/.zshrc
```

| Package/Tool | Purpose |
|--------------|---------|
| Xcode Command Line Tools | Apple compiler and linker toolchain required for native builds |
| Homebrew | Package manager used to install macOS dependencies |
| `cmake` | Build system required by native Rust dependencies (for example `whisper-rs-sys`) |
| `llvm` | Provides `clang` and `libclang` needed by `bindgen` |
| `pkg-config` | Helper tool for finding and linking native libraries |
| `openssl@3` | OpenSSL headers/libraries for crates that need SSL development files |
| `git` / `wget` | Source control and download utilities |

Notes:
- WebKit is provided by macOS (no `webkit2gtk` package needed).
- Whisper acceleration uses Metal on macOS (no Vulkan package required).

## 2. Install Rust

Install Rust using rustup (official installer):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

When prompted, select the default installation (option 1).

After installation, load Rust into your current shell:

```bash
source "$HOME/.cargo/env"
```

Verify the installation:

```bash
rustc --version
cargo --version
```

## 3. Install Node.js

Install Node.js (v18 or later recommended).

Using Homebrew:

```bash
brew install node@20
```

Or using nvm (recommended for development):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.zshrc
nvm install 20
nvm use 20
```

Verify the installation:

```bash
node --version
```

## 4. Enable pnpm (via Corepack)

Enable and activate pnpm:

```bash
corepack enable
corepack prepare pnpm@latest --activate
pnpm --version
```

## 5. Install Node Dependencies

Install the project dependencies:

```bash
pnpm install
```

## 6. Run the App

Run the full desktop app (frontend + Rust backend):

```bash
pnpm run tauri:dev
```

Optional: run only the frontend in the browser:

```bash
pnpm dev
```

- The first `pnpm run tauri:dev` can take several minutes because Cargo downloads and compiles Rust dependencies.

## Troubleshooting

### Xcode Command Line Tools not found

```
error: linker `cc` not found
```

**Solution:** Install Xcode Command Line Tools:

```bash
xcode-select --install
```

### bindgen/libclang/cmake errors

```
error: failed to run custom build command for `...`
```

**Solution:** Ensure native build tools are installed and exported:

```bash
brew install cmake llvm
echo 'export PATH="$(brew --prefix llvm)/bin:$PATH"' >> ~/.zshrc
echo 'export LIBCLANG_PATH="$(brew --prefix llvm)/lib"' >> ~/.zshrc
source ~/.zshrc
```

### OpenSSL errors

```
error: failed to run custom build command for `openssl-sys`
```

**Solution:** Install and expose OpenSSL:

```bash
brew install openssl@3 pkg-config
echo 'export PKG_CONFIG_PATH="$(brew --prefix openssl@3)/lib/pkgconfig:$PKG_CONFIG_PATH"' >> ~/.zshrc
source ~/.zshrc
```

### Rust not found after installation

**Solution:** Source cargo environment:

```bash
source "$HOME/.cargo/env"
```

Or add to your `~/.zshrc`:

```bash
echo 'source "$HOME/.cargo/env"' >> ~/.zshrc
source ~/.zshrc
```

### Permission denied during pnpm install

**Solution:** Configure pnpm in user space:

```bash
pnpm setup
source ~/.zshrc
```

### Touch ID unlock toggle never appears in Settings > Security

Biometric-unlock storage (`tauri-plugin-biometry`'s `setData`/`getData`) uses a macOS Keychain API (`SecAccessControl` + `kSecUseDataProtectionKeychain`) that requires the app to be signed with a real Apple Developer Team ID. This project's macOS signing (`tauri.conf.json`'s `bundle.macOS.signingIdentity: "-"`) is ad-hoc-only — the same signing used for both local dev (`pnpm tauri dev`, `make dev-sandbox`) and the current CI release build (`.github/workflows/release.yaml` configures no Apple credentials). Ad-hoc signing never has a Team ID, so the app's own capability probe (`canPersistBiometricUnlockData` in `src/lib/api/biometry.ts`) always fails and the toggle stays hidden, everywhere, until this repo has a real Apple Developer ID Application certificate wired into signing (Apple Developer Program enrollment, then updating `bundle.macOS` and `release.yaml`).

A failed probe fails silently and hides the toggle by design — it is not a build error to fix. Windows Hello is unaffected: its storage backend is WebAuthn/Windows Credential Manager, which has no such requirement.
