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
