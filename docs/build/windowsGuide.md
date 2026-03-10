# Windows Prerequisites Guide

## 1. System Dependencies

Use **PowerShell (Run as Administrator)** and install required tools:

```powershell
winget install --id Git.Git -e
winget install --id Kitware.CMake -e
winget install --id LLVM.LLVM -e
winget install --id Microsoft.EdgeWebView2Runtime -e
```

Install **Visual Studio 2022 Build Tools** and include:
- `Desktop development with C++`
- MSVC toolchain
- Windows 10/11 SDK

You can install Build Tools with `winget`:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e
```

Set `LIBCLANG_PATH` for `bindgen` (restart terminal after this):

```powershell
setx LIBCLANG_PATH "C:\Program Files\LLVM\bin"
```

| Package/Tool | Purpose |
|--------------|---------|
| Visual Studio Build Tools (C++) | Provides MSVC compiler/linker required by Rust on Windows |
| WebView2 Runtime | Required by Tauri to render the application UI |
| `CMake` | Build system required by native Rust dependencies (for example `whisper-rs-sys`) |
| `LLVM` (`clang`/`libclang`) | Required by `bindgen` to generate Rust FFI bindings |
| `Git` | Version control for cloning and updating repositories |

Notes:
- Whisper acceleration uses Vulkan on Windows.
- If Vulkan build errors appear, install the Vulkan SDK from LunarG.

## 2. Install Rust

Install rustup:

```powershell
winget install --id Rustlang.Rustup -e
```

Close and reopen PowerShell, then verify:

```powershell
rustc --version
cargo --version
```

## 3. Install Node.js

Install Node.js (v18 or later recommended).

Using nvm-windows (recommended):

```powershell
winget install --id CoreyButler.NVMforWindows -e
nvm install 20
nvm use 20
```

Or install Node.js directly:

```powershell
winget install --id OpenJS.NodeJS.LTS -e
```

Verify the installation:

```powershell
node --version
```

## 4. Enable pnpm (via Corepack)

Enable and activate pnpm:

```powershell
corepack enable
corepack prepare pnpm@latest --activate
pnpm --version
```

## 5. Install Node Dependencies

Install the project dependencies:

```powershell
pnpm install
```

## 6. Run the App

Run the full desktop app (frontend + Rust backend):

```powershell
pnpm run tauri:dev
```

Optional: run only the frontend in the browser:

```powershell
pnpm dev
```

- The first `pnpm run tauri:dev` can take several minutes because Cargo downloads and compiles Rust dependencies.

## Troubleshooting

### MSVC linker not found (`link.exe`)

```
error: linker `link.exe` not found
```

**Solution:** Install Visual Studio Build Tools with `Desktop development with C++`, then reopen terminal.
If needed, use **x64 Native Tools Command Prompt for VS 2022**.

### WebView2 runtime missing

```
WebView2 runtime not found
```

**Solution:** Install WebView2 Runtime:

```powershell
winget install --id Microsoft.EdgeWebView2Runtime -e
```

### bindgen/libclang/cmake errors

```
error: failed to run custom build command for `...`
```

**Solution:** Install CMake + LLVM and set `LIBCLANG_PATH`:

```powershell
winget install --id Kitware.CMake -e
winget install --id LLVM.LLVM -e
setx LIBCLANG_PATH "C:\Program Files\LLVM\bin"
```

Restart PowerShell after setting environment variables.

### Vulkan errors on Windows (Whisper)

```
error: failed to compile with Vulkan support
```

**Solution:** Install Vulkan SDK (LunarG), then restart terminal and rebuild.

### Rust not found after installation

**Solution:** Close and reopen your terminal.
If needed, ensure `%USERPROFILE%\.cargo\bin` is in PATH.

### Permission denied during pnpm install

**Solution:** Configure pnpm in user space and reopen terminal:

```powershell
pnpm setup
```
