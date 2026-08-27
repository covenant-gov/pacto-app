# Tauri MCP Integration for AI-Driven Verification

This guide wires the Pacto Tauri desktop app into an AI harness (Oh My Pi, Claude, Cursor, Claude Code, OpenClaw, etc.) via the [Tauri MCP Bridge](https://crates.io/crates/tauri-plugin-mcp-bridge). Once connected, the LLM can see, click, type, and read the live app — enabling automated self-verification of UI changes without a human in the loop.

## What you get

- **Live DOM snapshots** of the running app via `webview_dom_snapshot`.
- **Screenshots** of any screen state via `webview_screenshot`.
- **UI automation**: clicks, scrolls, typing, and key events via `webview_interact` and `webview_keyboard`.
- **Tauri IPC inspection**: execute commands, emit events, and monitor backend traffic via `ipc_*` tools.
- **Console/system logs** via `read_logs`.

## Why this matters for the AI harness

Today, an agent verifies code by reading files and running tests. UI work is the exception: the only way to know if a button looks right, a channel opens, or a message sends is to have a human look at the app. The Tauri MCP bridge removes that bottleneck.

The LLM can now:

1. Make a change to the frontend or backend.
2. Build and run the app in debug mode.
3. Connect to the live app, navigate through real screens, and assert behavior visually and structurally.
4. Capture evidence (screenshots, DOM snapshots) alongside the code change.

This is **self-verification**: the same agent that writes the code can observe the result in the actual product, not just in a test file or a mock. It compresses the write → verify → fix loop from hours to minutes, and removes the human screenshot reviewer from routine UI checks.

Removing the human from the verification loop is not about replacing judgment; it is about **next-generation iteration velocity**. The LLM can explore 10 variations of a layout, compare screenshots, catch regressions across tabs, and confirm that a backend change actually surfaces in the UI — all without pulling a teammate away from deep work. The human remains the architect and the approver; the machine handles the tedious verification at machine speed.

## Prerequisites

- Pacto repo cloned and dependencies installed (`pnpm install`, `cargo fetch`).
- The Tauri MCP Bridge plugin is already wired into the project (see Step 1). You only need to enable/configure it if something is missing.

## Step 1: Confirm the Tauri MCP Bridge plugin is in the project

The plugin is included in `src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri-plugin-mcp-bridge = "0.12"
```

And it is initialized in `src-tauri/src/lib.rs` inside the debug desktop build path:

```rust
#[cfg(all(debug_assertions, desktop))]
{
    builder = builder.plugin(tauri_plugin_mcp_bridge::init());
}
```

> **Note:** The plugin is intentionally debug-only and desktop-only. It does not ship in production or mobile builds. If you want MCP support in another build, guard it with the same `cfg` flags.

## Step 2: Install the MCP server

The MCP server lives in the frontend dependency tree. From the project root:

```bash
pnpm add -D @hypothesi/tauri-mcp-server
```

If you prefer a global CLI for standalone scripting, install the companion package:

```bash
npm install -g @hypothesi/tauri-mcp-cli
```

You do not need the CLI for the agent integration, but it is useful for debugging outside the agent.

## Step 3: Configure your AI client

Every MCP client needs the same server information, but the config file and shape differ slightly. The important part is always the same:

- **Transport:** `stdio`
- **Command:** `node`
- **Args:** `./node_modules/@hypothesi/tauri-mcp-server/dist/index.js`

### Oh My Pi / OMP

Create or edit `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "tauri": {
      "type": "stdio",
      "command": "node",
      "args": [
        "./node_modules/@hypothesi/tauri-mcp-server/dist/index.js"
      ]
    }
  }
}
```

### Claude Code / Cursor / Windsurf / VS Code / OpenClaw

Use [`aix`](https://aix.a1st.dev/cli/add/#aix-add-mcp) to install to the editor's user config:

```bash
npx -y @a1st/aix add mcp tauri --command 'npx @hypothesi/tauri-mcp-server' --user
```

Then **override the command** in your editor's MCP config to use the direct `node` path. `aix` may emit a slow `pnpm exec` or `npx` wrapper that times out on startup. Replace it with the direct `node` path shown above. For example, in Claude Code's `~/.claude/mcp.json` or Cursor's `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "tauri": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/Users/you/src/covenant-gov/pacto-app/node_modules/@hypothesi/tauri-mcp-server/dist/index.js"
      ]
    }
  }
}
```

Use an absolute path here because many editors run the MCP server from a different working directory.

### Why the direct `node` path?

`pnpm exec mcp-server-tauri` triggers pnpm's workspace lockfile verification on every startup. That verification took ~3.8 seconds in this project, causing the client to close the transport with a `Transport closed` error before the server could respond. Running the server directly with `node` starts in ~0.1 seconds and avoids the timeout.

### Avoid these common mistakes

- Do not use `"type": "local"`. The MCP schema expects `"stdio"` or `"http"`.
- Do not use `pnpm exec` unless your MCP client has a very long startup timeout.
- Do not point to the binary wrapper (`node_modules/.bin/mcp-server-tauri`); use the `dist/index.js` entry point directly.

## Step 4: Start the app in a sandbox

The MCP bridge only exists in debug builds, so run the desktop app in dev mode — but **never** point it at the default dev data directory with a plain `make dev` / `pnpm tauri dev`. That directory tends to carry a real account from prior manual testing, and if nobody remembers its PIN the app just sits on the login screen forever, blocking every step after it.

Use the sandbox target instead, which redirects `app_data_dir`/`app_local_data_dir` to `test_sandbox/<branch-slug>/<persona>/` and sets `PACTO_ALLOW_TEST_AUTH=1`:

```bash
make dev-sandbox
```

To land already authenticated (see Step 6), also export a recovery phrase before launching:

```bash
PACTO_DEV_LOGIN_MNEMONIC="word1 word2 ... word12" make dev-sandbox
```

Wait for the app window to appear and the frontend to load.

The sandbox is **stable, not throwaway**: relaunching returns to the same
account, so MLS group membership and the key store holding your keypackage
private key survive a restart. That matters — a root that changed each launch
would orphan the key store, and a welcome issued against the previous run's
keypackage then fails with `No matching key package was found in the key
store`, which looks like a delivery bug and is not one.

Set `PERSONA` to run a second identity on the same branch, with its own
account, data directory, and derived ports, so two sandboxes can run side by
side and invite each other:

```bash
PERSONA=alice make dev-sandbox
```

For a two-window Host+Guest demo with distinct autologin mnemonics (not the
Anvil fixture), `make dev-sandbox-pair` starts `solo` then `alice`, waits
until both `sandbox-handle.json` files carry an `npub`, and prints each
`ports.mcpBridge`. Ctrl+C stops both. See `.agents/sandbox-multi-instance-demo-prompt.md`.

To start that persona over from an empty account — when the account-creation
flow is itself what you are testing — use `make dev-sandbox-fresh`, which
wipes just that persona's directory first. `make clean` removes all of them.

## Step 5: Connect from the agent

With the app running, the agent can start an automation session. The MCP Bridge plugin listens on `localhost:9223` by default — each worktree/branch derives its own bridge port instead (base `9223`, `+100` per resolved port index), recorded in `<sandbox root>/sandbox-handle.json`. Read the handle rather than assuming `9223` once more than one sandbox may be running.

Example tool call (from the agent):

```json
{
  "action": "start"
}
```

If the session starts successfully, the agent will report the connected app. If it fails with "no Tauri app found at localhost:9223", the app is either not running, not built in debug mode, or bound to a different derived port — check the handle.

### Security note: the bridge is an unauthenticated control surface

The MCP bridge accepts any local connection with no authentication and grants full IPC access to the running app — it is a debug convenience, not a sandboxed API. It is bound to loopback only, so it is not reachable off-host, but every local process (and, on a shared machine, every local user) can drive it. Each concurrent sandbox opens its own bridge port, so running N sandboxes multiplies this surface by N. Per-sandbox bridge authentication is out of scope for this plan; treat every debug build as fully controllable by anything running locally.

## Step 6: Get into an authenticated state

### Zero-keystroke path (default)

If the sandbox was launched with `PACTO_ALLOW_TEST_AUTH=1` and `PACTO_DEV_LOGIN_MNEMONIC` set (Step 4), the app is **already authenticated on first paint** — no account-creation wait, no PIN entry, no DOM input at all. Start a driver session (Step 5) and take a DOM snapshot: the main navbar (Commons/DMs/Squads/Catch up tabs) is there immediately.

Under the hood, `+layout.svelte`'s startup hook calls the debug-only `dev_login` command at full depth: it logs in through the same recovery-phrase path `importAccount` uses, persists a real PIN-encrypted key, opens the connection, and hydrates the frontend session exactly like a human login. If `PACTO_DEV_LOGIN_MNEMONIC` is unset, this is a clean no-op and the app falls through to the welcome screen below.

### Fallback: create a fresh account through the UI

Only reach for this when the fresh-account UI flow itself is what you're testing (e.g. onboarding changes) — every other scenario should use the zero-keystroke path above.

1. Snapshot the DOM (`webview_dom_snapshot`), then click the button matching text `Create Account`.
2. Snapshot again to get the six PIN-digit input refs under the "Create your PIN" heading. **Type one digit per input, in six separate `webview_keyboard` `type` calls** — each digit box has `maxlength="1"`, so a single call with `"text": "123456"` only fills the first box and silently drops the rest. Use PIN `123456` (the project's throwaway dev PIN, also used by `e2e/login.spec.ts`).
3. Snapshot again — a fresh "Confirm your PIN" screen renders with new input refs. Repeat step 2's six single-digit calls against the new refs.
4. Account creation runs for real: Argon2id key derivation plus a live MLS keypackage publish to a Nostr relay. Expect a "Processing…" status for **20–30 seconds** before the main navbar appears — poll with `webview_dom_snapshot` rather than assuming failure early.

### Backend-only assertions: `dev_login` at backend depth

For IPC-level assertions with no UI involvement (the pattern `pnpm test:e2e:tauri` uses), call `dev_login` with `{"depth": "backend"}` instead. It creates a fresh account and returns its `npub` almost instantly, but only writes backend state — it does not persist a PIN-encrypted key or hydrate any frontend session, so `Login.svelte` keeps showing the welcome screen. Use full depth (above) whenever you need the authenticated UI.

It cannot be called through `ipc_execute_command` — that tool only forwards to the bridge plugin's own built-ins (`get_window_info`, `get_backend_state`, etc.) and returns `Unsupported Tauri command` for any app command, verified against both `dev_login` and ordinary commands like `get_relays`. `e2e-tauri/message-send.spec.mjs` documents this and works around it by calling `window.__TAURI__.core.invoke(...)` directly through `webview_execute_js`, polling a window-scoped slot since a single `execute_js` call is capped around 5 seconds. Reuse that `invokeTauri` helper if you need backend-depth auth for a backend-only assertion.

## Step 7: Verify the integration

A quick smoke test sequence (run once authenticated, via either path in Step 6):

1. **Start a driver session** → `driver_session` with `"action": "start"`.
2. **Take a screenshot** → `webview_screenshot`.
3. **Snapshot the DOM** → `webview_dom_snapshot` with `"type": "accessibility"`.
4. **Click a tab** → `webview_interact` with `"action": "click"`, `"selector": "Squads"`, `"strategy": "text"`.
5. **Type a message** → `webview_keyboard` with `"action": "type"`, `"selector": "Message #pacto-app"`, `"strategy": "text"`, `"text": "Hello from the MCP bridge"`.

If the DOM updates, the screenshot reflects the change, and the typed text appears in the input, the integration is live.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Transport closed` on startup | `pnpm exec` is too slow, or `type` is not `stdio` | Use `node ./node_modules/@hypothesi/tauri-mcp-server/dist/index.js` directly and set `type` to `stdio` |
| `no Tauri app found at localhost:9223` | App is not running, not built in debug mode, or bound to a different derived bridge port | Run `make dev-sandbox` and wait for the window; check `<sandbox root>/sandbox-handle.json` for the actual bound port |
| App stuck on the login screen; PIN unknown | Connected to the default dev data directory, which carries a real account from prior manual testing | Stop it and restart with `make dev-sandbox`; add `PACTO_DEV_LOGIN_MNEMONIC` to land authenticated, or `make dev-sandbox-fresh` for an empty account |
| Sandbox lands on the welcome screen despite `PACTO_ALLOW_TEST_AUTH=1` | `PACTO_DEV_LOGIN_MNEMONIC` is unset — `dev_login` full depth is a clean no-op without a configured identity | Export `PACTO_DEV_LOGIN_MNEMONIC` before launching (Step 4), or use the Fallback UI flow in Step 6 |
| `No matching key package was found in the key store` after an invite | The MLS key store was orphaned — a sandbox root that changes between runs leaves the keypackage private key behind | Keep one root per persona (the default since `dev-sandbox` became branch-scoped); do not override `PACTO_TEST_SANDBOX_ROOT` with a per-run path |
| `Element not found` when clicking | Text selector matches multiple elements or ref is stale | Use a more specific CSS selector or `webview_execute_js` |
| Tools do not appear in agent | MCP server config is in the wrong file for your client | Check `.mcp.json` for OMP, `~/.claude/mcp.json` for Claude Code, `~/.cursor/mcp.json` for Cursor |
| Plugin not found in production | The bridge is intentionally `debug_assertions` only | Only use MCP against dev/debug builds |
| `webview_keyboard type` fills only the first PIN digit | Each digit box has `maxlength="1"`; a multi-character `text` value gets truncated | Send one `type` call per digit, targeting that digit's own ref (Fallback flow only) |
| `ipc_execute_command` returns `Unsupported Tauri command: <name>` | The tool only proxies the bridge plugin's own built-ins, not app commands | Call `window.__TAURI__.core.invoke(...)` via `webview_execute_js` instead (see Step 6's backend-depth note) |
| Monkey-patching `window.__TAURI_INTERNALS__.invoke` via `webview_execute_js` to spy on IPC calls never fires | `@tauri-apps/api/core`'s bundled `invoke` wrapper resolves its reference at module load, before the patch runs | Verify IPC side effects through `read_logs` (`source: "console"`) against the app's own `dmLog`/console output instead of intercepting `invoke` |

## Multi-client notes

Because this team uses Claude, Cursor, OpenClaw, and OMP, each developer may need to configure the server in their own client config. The project-level `.mcp.json` covers OMP for anyone who opens the repo in that harness. Other editors should install the server once per user via `aix` and then override the command to use the direct `node` path.

Keep the same server version and the same direct `node` path across all clients to avoid "works on my machine" MCP failures.
