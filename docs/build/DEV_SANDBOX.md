# Dev sandbox data directories

Debug-only. Governs where the app resolves its account/profile data
directory (the `app_data_dir` / `app_local_data_dir` equivalents) during
local development.

## `PACTO_TEST_SANDBOX_ROOT`

Points the app at a sandboxed data root instead of the real OS app-data
directory. When set to a non-blank path, `<root>/data` and `<root>/local`
replace the normal Tauri paths everywhere account, profile, database, and
cache state is read or written — nothing under that root touches the
machine's real profile.

A configured root also relaxes the single-instance guard — debug builds
only — so parallel sandboxes can run side by side; a release build always
registers the guard (`multi_instance_allowed`). Note this applies to any
non-`main` `make dev` too, since that target sets a per-branch root.

Two processes sharing *one* root **are** prevented: see
[Per-root launch lock](#per-root-launch-lock) below. Each concurrent
instance still needs its own root — the lock stops two launches from
corrupting one root's store, it does not let them share it.

Used today by the per-branch `make dev` target so concurrent worktrees never
share an account. See `src-tauri/src/test_sandbox.rs` (`sandbox_root`,
`test_data_dir`, `test_local_data_dir`).

## Per-root launch lock

Debug-only, exactly like `multi_instance_allowed` (`cfg!(debug_assertions)`;
a release build has no sandbox concept to honor and never acquires it).

Skipping the single-instance guard for sandboxes (above) removed the thing
that incidentally stopped two processes from sharing one sandbox root.
Without a separate guard, a second launch against a root still held by a
live first instance would silently overwrite `<root>/sandbox-handle.json`
while that first instance keeps running against the same SQLite/MLS store —
real corruption, not just a confusing handle.

`test_sandbox::acquire_sandbox_launch_lock()` closes that gap with a
per-root lockfile (`<root>/sandbox.lock`), acquired once at startup and held
for the process's whole run:

- No sandbox root configured: no-op, same as every other sandbox-only
  behavior on a plain `main` launch.
- Root's lock is unheld, or its recorded holder pid no longer exists: this
  launch claims it and proceeds.
- Root's lock is held by a pid that is still alive: this launch refuses
  immediately, naming the holder pid and the lockfile path.

Staleness reuses the exact reasoning `scripts/dev-ports.mjs` already proves
out for its own claim files — `O_EXCL`-style exclusive creation, pid
liveness via a `kill(pid, 0)` probe (`EPERM` counts as alive: the pid exists,
it just isn't ours), and a small grace window so a liveness read can't race
the exact instant of process death. The lock releases cleanly on normal exit
(dropped when `run()` returns), so a released root is immediately
relaunchable without waiting out that grace window.

## Per-sandbox window geometry

`tauri_plugin_window_state` always persists under the shared
`app_config_dir`, which `test_sandbox` does not redirect (only
`app_data_dir`/`app_local_data_dir` are sandboxed). Left unkeyed, two
concurrent sandboxes would restore geometry from the same file and land
stacked on top of each other. `test_sandbox::window_state_filename()` keys
the plugin's filename off the sandbox root (debug builds only), so each root
gets its own state file in that shared directory; a release build, or a run
with no sandbox root, gets the plugin's own default filename unchanged.

## `PACTO_DEV_WORLD`

World-boot marker, set by orchestration — not by hand — to `1`. At startup,
before any account or database work, the app calls
`test_sandbox::enforce_dev_world_root()`:

- Marker unset: no-op. Behavior is identical to plain `make dev`, whether or
  not a sandbox root happens to be set.
- Marker set and `PACTO_TEST_SANDBOX_ROOT` unset: refuses immediately,
  naming both variables. This is what makes it structurally impossible for a
  world boot to fall through to the real OS app-data account — the account
  that holds a real developer's actual keys and message history.
- Marker set and a root is present: the root's own placement is validated
  through the same escape check `test_data_dir`/`test_local_data_dir` rely
  on — a `..` traversal or a symlink whose target escapes the root's parent
  directory is refused, not silently followed. The root directory is
  created if it doesn't exist yet, since a fresh worktree's sandbox
  legitimately hasn't been used before.

On refusal the process prints the error and exits before touching any
account state.

## Recovering from a refusal

- Forgot `PACTO_TEST_SANDBOX_ROOT`: set it to a sandbox directory (a fresh
  temp path is fine) and re-run.
- Root path rejected as escaping: point it at a plain directory with no
  `..` segments and no symlink in the final path component.
- Just want plain `make dev` (no world boot): leave `PACTO_DEV_WORLD` unset.
- Refused with "already in use by a live process": another instance is
  genuinely still running against that root — stop it, or point
  `PACTO_TEST_SANDBOX_ROOT` at a different root. If the named pid is
  actually gone (e.g. it was killed without a clean shutdown) the next
  launch reclaims the root itself; deleting `<root>/sandbox.lock` by hand
  works too and is always safe once the holder is confirmed dead.


## Relay-free harness seed

`make relay-free-harness-seed` builds a populated per-account sandbox with
**zero network and no docker**, through the real ingest path
(`rumor::process_rumor`, an in-process MLS welcome, `db::*`). The binary is
gated behind the non-default `relay-free-harness` feature and is absent from
default / release builds.

- Root must sit under `test_sandbox/` or `test_fixtures/` (enforced by the
  binary, not just the Makefile).
- The seeded identity is the public Anvil/Hardhat fixture by default. Prefer
  `PACTO_DEV_LOGIN_MNEMONIC` over `--mnemonic` so a phrase never appears on
  argv; a non-fixture phrase requires `--allow-non-fixture-mnemonic`.
- The harness stamps `.pacto_dev_identity_sandbox_only` under the root and a
  matching SQL setting. Opening that DB in the live app still requires
  `PACTO_TRUSTED_RELAYS` (local) and `PACTO_DEV_IDENTITY_SANDBOX_ONLY=1` (or
  the on-disk stamp) -- the same KD9 / R25 refusal `dev_login` already
  enforces.
- MLS group metadata embeds a loopback placeholder relay, never the compiled
  production set.
- `SEED_MARKER_VERSION` in `src-tauri/src/harness.rs` is the idempotency
  handshake across contributors; bump it when seed semantics change, and wipe
  old roots rather than reseeding over an unexpected marker.
- Treat this binary as an ingest + MLS + migrations canary: later `rumor` /
  `MlsService` / `db` / MDK changes can break the CI job without touching the
  harness files.
