# Ubuntu Prerequisites Guide

## 1. System Dependencies

Install the required system packages for Tauri development:

```bash
sudo apt update
sudo apt install -y \
  build-essential \
  cmake \
  clang \
  libclang-dev \
  curl \
  wget \
  file \
  git \
  pkg-config \
  libvulkan-dev \
  libwebkit2gtk-4.1-dev \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libasound2-dev
```

| Package | Purpose |
|---------|---------|
| `build-essential` | C/C++ compiler and build tools (gcc, g++, make) |
| `cmake` | Build system required by native Rust dependencies (for example `whisper-rs-sys`) |
| `clang` / `libclang-dev` | Required by `bindgen` to generate Rust FFI bindings during build |
| `curl` / `wget` | Network utilities for downloading |
| `git` | Version control for cloning the repository |
| `pkg-config` | Helper tool for compiling libraries |
| `libvulkan-dev` | Vulkan headers/libraries used by Whisper acceleration on Linux |
| `libwebkit2gtk-4.1-dev` | WebKit rendering engine for Tauri UI |
| `libxdo-dev` | X11 input simulation library |
| `libssl-dev` | OpenSSL development headers |
| `libayatana-appindicator3-dev` | System tray integration |
| `librsvg2-dev` | SVG rendering library |
| `libasound2-dev` | ALSA audio library for sound support |

## 2. Install Rust

Install Rust using rustup (the official Rust toolchain installer):

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

Install Node.js (v18 or later recommended). Using NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Or using nvm (Node Version Manager) - recommended for development:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
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

```bash
pnpm tauri:dev
```

Optional: run only the frontend in the browser:

```bash
pnpm dev
```

- The first `pnpm run tauri:dev` can take several minutes because Cargo downloads and compiles Rust dependencies.

## Troubleshooting

### WebKit not found

```
error: could not find system library 'webkit2gtk-4.1'
```

**Solution:** Install the WebKit development package:
```bash
sudo apt install libwebkit2gtk-4.1-dev
```

### OpenSSL errors

```
error: failed to run custom build command for `openssl-sys`
```

**Solution:** Install OpenSSL development headers:
```bash
sudo apt install libssl-dev pkg-config
```

### bindgen/libclang/cmake errors

```
error: failed to run custom build command for `...`
```

**Solution:** Install native build tooling used by some Rust crates:
```bash
sudo apt install cmake clang libclang-dev
```

### Vulkan errors on Linux (Whisper)

```
error: failed to compile with Vulkan support
```

**Solution:** Install Vulkan development libraries:
```bash
sudo apt install libvulkan-dev
```

### Rust not found after installation

**Solution:** Source the cargo environment:
```bash
source "$HOME/.cargo/env"
```

Or add to your `~/.bashrc`:
```bash
echo 'source "$HOME/.cargo/env"' >> ~/.bashrc
source ~/.bashrc
```

### Permission denied during pnpm install

**Solution:** Configure pnpm in user space:
```bash
pnpm setup
source ~/.bashrc
```