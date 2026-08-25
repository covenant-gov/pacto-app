# Multi-sandbox demo driver

You are driving a **live Pacto desktop demo** with the **Tauri MCP** tools. Two debug sandboxes are (or will be) running as separate app windows. Act as the operator: connect, DM, create squad **Sandbox Demo**, join, open channel **welcome**, exchange two chat lines, then have Guest send a GIF. If GIF fails, send the Chuck Norris fallback. Stop the moment success is visible.

This is a demo, not a test report. Keep the UI moving. Narrate only when a wait is real (MLS invite, GIF load). Do not edit source. Do not use `make dev` or the persistent `dev-account` identity. Do not assume MCP bridge port `9223`.

## Fast path (do this, in this order)

1. If **both** windows already show `#welcome` with **two chat messages** and a **GIF** (or the Chuck Norris fallback), **stop**. No reconnect, no extra snapshots, no Settings.
2. Start (or reuse) two autologged windows with **two distinct mnemonics**. Never use the Anvil/relay-free-harness fixture (`test test … junk`) for both personas. Prefer `make dev-sandbox-pair`.
3. Read each `sandbox-handle.json`. Connect with that persona's `ports.mcpBridge`. **Always pass `appIdentifier`** (the bridge port) on every later call.
4. Fill text fields with JS (`value` + `input`/`change`), then click the labeled button. Keyboard only for PIN digits, as strings (`"1"` not `1`).
5. Host DMs Guest → Guest replies → Host **Organize Squad** `Sandbox Demo` → Guest **Accept** in the **Host DM thread** (not Catch up) → Host **+ Create channel** `welcome` → **Open channel** → two messages → Guest GIF.

## Cast

| Role | Makefile | Default data dir pattern | Notes |
|------|----------|--------------------------|--------|
| **Host** | `make dev-sandbox` (`PERSONA` defaults to `solo`) | `test_sandbox/<branch-slug>/solo/` | Creates the squad, invites, creates `#welcome` |
| **Guest** | `PERSONA=alice make dev-sandbox` | `test_sandbox/<branch-slug>/alice/` | Accepts invites, chats, sends the GIF |

If those windows are not running yet, start them with **distinct** `PACTO_DEV_LOGIN_MNEMONIC` values (or `make dev-sandbox-pair`). Wait until each window paints and is authenticated — main tabs **Commons / DMs / Squads / Catch up** visible. Use `make dev-sandbox-fresh` only if a persona is stuck on a forgotten PIN.

**Auth policy:** mnemonic autologin is mandatory for this demo. If Host is on Create Account, wipe/retry `dev-sandbox` with the mnemonic env set — do not finish onboarding unless you are testing onboarding. Skip the backup quiz unless an invite Accept does nothing.

Personas are stable across reruns. If Guest DMs show a thread that is **not** the Host npub from *this* run, ignore it.

## Connect (do this first)

1. Read each persona's `sandbox-handle.json`. Path: `test_sandbox/<branch-slug>/<persona>/sandbox-handle.json`.
2. Use `ports.mcpBridge` from that file. After login, `npub` is written onto the same handle — prefer it over hunting Settings. If `npub` is still null, wait ~10s and re-read (UI signup now writes it too).
3. `driver_session` `action: "start"` **once per app**, passing that persona's `mcpBridge` port. Two connections. **Always pass `appIdentifier`** (the bridge port) on every later webview/ipc call.
4. `driver_session` `action: "status"` and confirm both apps are connected.
5. Snapshot each window. If both are already on the main shell, continue. If either is on Create Account / PIN, prefer restarting that sandbox with autologin rather than clicking through signup.

Label the apps: Host = solo's port, Guest = alice's port.

## Click map (English)

Snapshot before almost every click. Prefer `strategy: "text"` against these strings.

- Tabs: `DMs`, `Squads`, `Catch up`
- Host add on DMs: `Start DM` — recipient `npub1…`, message, `Send`
- Host add on Squads: `Organize Squad` — name `Sandbox Demo`, check Guest, `Create`
- In a squad: `Invite to Squad` only if the member picker was empty
- `+ Create channel` — name `welcome`, then **Open channel** (not Add everyone + Create; the other button is **Closed channel**)
- Invite card in the **Host DM thread**: `Accept` (Catch up also has Accept now; do not use it unless the DM card is missing)
- Composer: `Insert emoji or GIF` → `GIFs` → `Enable GIF search` → first fun `gridcell`. Do **not** wait-for with a short cap; snapshot until a cell exists, then click.

## Scene

### 0. Identities

From each handle (or Settings → Profile → **Copy nPub** only if the handle has no npub), record `HOST_NPUB` and `GUEST_NPUB`.

### 1. DM

On **Host**: DMs → Start DM → paste `GUEST_NPUB` → `hey — sandbox demo kicking off` → Send.

On **Guest**: DMs (and **Requests** if not in Friends) → open the Host thread → `hello from the other sandbox`.

Wait until both windows show the two-message thread. Do not create a squad until Guest is a selectable DM friend.

### 2. Squad

On **Host**: Squads → Organize Squad → name `Sandbox Demo` → check Guest → Create. Wait for `Sandbox Demo is ready!` or the list row.

On **Guest**: open the **Host DM thread** and click **Accept** on `{inviter} invited you to join this squad.` Wait until Squads lists `Sandbox Demo`. Host must stay online.

If Organize Squad's member list is empty after the DM: Host, open `Sandbox Demo` if it exists and **Invite to Squad** with `GUEST_NPUB`.

### 3. Channel `welcome`

On **Host**, inside `Sandbox Demo`: `+ Create channel` → name `welcome` → **Open channel**. Open `#welcome`.

On **Guest**: Accept any channel invite if shown, then open `#welcome`.

### 4. Chat

- Host: `welcome to the sandbox demo`
- Guest: `made it — both windows are live`

Confirm Host shows Guest's message before the GIF beat.

### 5. Guest GIF

On **Guest** in `#welcome`: Insert emoji or GIF → GIFs → Enable GIF search (if shown) → click a clearly fun result so it **sends as a GIF message**. Confirm it renders on Guest, then on Host.

**Fallback (any GIF failure):** do not debug Klipy. On Guest send:

> Chuck Norris can unit-test the universe. The universe fails.

Then one sentence that you fell back, and continue.

### 6. Close

Screenshot both windows on `#welcome` (GIF or joke visible). **Stop.** Do not create more squads, do not touch Settings, do not reclaim sandboxes unless asked.

## MCP operating rules

- Always pass `appIdentifier` matching that persona's `mcpBridge` port.
- Fill fields with JS (`native value setter` + `input`/`change` events), then click the button. `webview_keyboard` `type` into Svelte-bound inputs often no-ops.
- PIN boxes: one character each, string digits.
- Do not call app Tauri commands through `ipc_execute_command` (bridge built-ins only). Drive the UI.
- Do not point either instance at the real OS app-data directory.
- If `driver_session` cannot find an app, re-read `sandbox-handle.json` — the bound port may have scanned forward.
- MLS invites are async. Poll 10–30s (sometimes longer). Do not fail on the first empty Catch up.
- If a click hits the wrong window, you omitted `appIdentifier` or used the stale default. Fix the id, snapshot, retry.

## Success

Done when Host and Guest are both in squad **Sandbox Demo**, channel **welcome**, have exchanged at least two chat messages, and Guest has either a GIF in that channel or the Chuck Norris fallback. Capture a screenshot of each window as the last frame, then stop.
