# Rust target directory disk use

`src-tauri/target` grows without bound on a debug checkout. Reclaim it
periodically; nothing in the build deletes superseded artifacts for you.
Common desktop-dev Make entrypoints refuse to start when the tree exceeds a
documented cap (see [Auto size gate](#auto-size-gate)).

## Why it grows

Cargo names every compiled crate with a hash of its inputs: crate version,
enabled features, profile, target, and rustc version. When any of those
change, Cargo writes a new hashed copy and never deletes the old one. Pulls
that bump `Cargo.lock`, toolchain updates, and switching feature sets each
leave a full set of superseded artifacts in `target/debug/deps`. Large crates
make this expensive: `libpacto_lib` builds as a staticlib, cdylib, and rlib
(the `.a` alone is around 1 GB), and `tauri-plugin-mcp-bridge` and `tauri`
are hundreds of MB per copy.

Two feature sets in this repo keep separate copies of most dependencies side
by side, so the steady-state footprint is roughly double a single build:

- **Default features** (`whisper`, `tor`): `make dev`, `pnpm tauri:dev`.
  Adding `local-relay-tls` or `--all-features` does not change the shared
  dependency graph.
- **`--no-default-features`**: `make test`, `make rust-test`,
  `make relay-free-harness-seed`. Dropping `tor` changes features on
  low-level crates such as `libc`, so every crate above them, including
  `tauri` and `tauri-plugin-mcp-bridge`, is compiled again under a new hash.

Both sets stay valid, so alternating between them costs disk rather than
rebuild time. `make rust-check` and `make rust-clippy` add a smaller
metadata-only set of their own.

## Auto size gate

These targets call `make check-cargo-cap` before launching the app:

`dev`, `dev-isolated` (`pnpm tauri:dev:iso`), `dev-sandbox` (and
fresh/seeded via that path), `dev-sandbox-pair`, `dev-account`, `dev-buddy`,
`dev-world`.

Default cap is **25 GiB** (`CARGO_TARGET_CAP_GB`). Over the cap the script
prints the path, size, and reclaim hints, then exits non-zero.

| Override | Effect |
|----------|--------|
| `CARGO_TARGET_CAP_GB=30 make dev` | Raise (or lower) the refuse threshold |
| `PACTO_ALLOW_LARGE_CARGO_TARGET=1 make dev` | Warn and continue once |

Bare `pnpm tauri:dev` and IDE/rust-analyzer Cargo builds do **not** run this
gate.

Regression checks for `check` / `cap`: `node --test scripts/cargo-target-clean.test.mjs`.

## Reclaiming space

| Command | Effect |
|---------|--------|
| `make check-cargo-cap` | Refuse (exit 1) if the target exceeds `CARGO_TARGET_CAP_GB` |
| `make cap-cargo` / `pnpm cap:cargo` | `cargo sweep --maxsize` down to `CARGO_TARGET_CAP_GB` (default 25). Needs cargo-sweep. |
| `make clean-cargo` / `pnpm clean:cargo` | Runs `cargo clean` on `src-tauri`. Frees everything; the next build is a full rebuild. |
| `make sweep-cargo` / `pnpm sweep:cargo [DAYS]` | Runs `cargo sweep --time DAYS` (default 7). Keeps what recent builds used. Change the window with `CARGO_SWEEP_DAYS=14 make sweep-cargo`. |
| `cd src-tauri && cargo clean -p tauri-plugin-mcp-bridge` | Drops every copy of one crate. |
| `make clean` | Also deletes `test_sandbox/` and frontend build output. Use `clean-cargo` when you only want disk back. |

Both scripts print the target directory size before and after reclaim, and
honor `CARGO_TARGET_DIR`, so they work with per-client target directories such
as the demo deployer's.

`sweep-cargo` and `cap-cargo` need [`cargo-sweep`](https://github.com/holmgr/cargo-sweep):

```bash
cargo install cargo-sweep --locked
```

Without it, those modes remove nothing and print the install hint. Age is
the last access time of each crate's fingerprint files, which Cargo reads on
every build, so artifacts the current builds still use are kept. Other
`cargo-sweep` modes are useful run directly from the repo root:

```bash
cargo sweep --maxsize 20GB src-tauri   # drop least-recently-used until under 20 GB
cargo sweep --installed src-tauri      # drop artifacts from uninstalled toolchains
```

On Windows without a POSIX shell, run `cargo clean` or `cargo sweep --time 7`
in `src-tauri` directly.

## Multi-checkout / worktrees

Each git clone and each git worktree has its own `src-tauri/target` (unless
you override `CARGO_TARGET_DIR`). Juggling several checkouts multiplies disk:
three trees at ~40 GB each are ~120 GB before any one of them looks unusual.
Removing a worktree frees its default target with it. On long-lived parallel
trees, run `make cap-cargo` or `make clean-cargo` periodically in each, or
point them at a shared `CARGO_TARGET_DIR` and sweep that one tree.

## IDE / rust-analyzer

Opening the repo in rust-analyzer or Cursor without `CARGO_TARGET_DIR` writes
the default `src-tauri/target`, even when you never run `make dev`. That path
bypasses the auto size gate. Prefer a shared target-dir override for the
workspace, or run `make sweep-cargo` / `make cap-cargo` regularly so analyzer
rebuilds do not silently add tens of GB.
