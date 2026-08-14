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
non-`main` `make dev` too, since that target sets a per-branch root. Two
processes sharing *one* root are not prevented; each concurrent instance
needs its own root.

Used today by the per-branch `make dev` target so concurrent worktrees never
share an account. See `src-tauri/src/test_sandbox.rs` (`sandbox_root`,
`test_data_dir`, `test_local_data_dir`).

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
