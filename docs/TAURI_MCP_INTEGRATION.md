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

## Step 4: Start the app in debug mode

The MCP bridge only exists in debug builds, so run the desktop app in dev mode:

```bash
make dev
# or
pnpm tauri dev
```

Wait for the app window to appear and the frontend to load.

## Step 5: Connect from the agent

With the app running, the agent can start an automation session. The MCP Bridge plugin listens on `localhost:9223` by default.

Example tool call (from the agent):

```json
{
  "action": "start"
}
```

If the session starts successfully, the agent will report the connected app. If it fails with "no Tauri app found at localhost:9223", the app is either not running or not built in debug mode.

## Step 6: Verify the integration

A quick smoke test sequence:

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
| `no Tauri app found at localhost:9223` | App is not running, or not built in debug mode | Run `make dev` and wait for the window |
| `Element not found` when clicking | Text selector matches multiple elements or ref is stale | Use a more specific CSS selector or `webview_execute_js` |
| Tools do not appear in agent | MCP server config is in the wrong file for your client | Check `.mcp.json` for OMP, `~/.claude/mcp.json` for Claude Code, `~/.cursor/mcp.json` for Cursor |
| Plugin not found in production | The bridge is intentionally `debug_assertions` only | Only use MCP against dev/debug builds |

## Multi-client notes

Because this team uses Claude, Cursor, OpenClaw, and OMP, each developer may need to configure the server in their own client config. The project-level `.mcp.json` covers OMP for anyone who opens the repo in that harness. Other editors should install the server once per user via `aix` and then override the command to use the direct `node` path.

Keep the same server version and the same direct `node` path across all clients to avoid "works on my machine" MCP failures.
