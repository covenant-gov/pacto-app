# Rust target directory disk use

`src-tauri/target` grows without bound on a debug checkout. Reclaim it
periodically; nothing in the build does it for you.

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

## Reclaiming space

| Command | Effect |
|---------|--------|
| `make clean-cargo` / `pnpm clean:cargo` | Runs `cargo clean` on `src-tauri`. Frees everything; the next build is a full rebuild. |
| `make sweep-cargo` / `pnpm sweep:cargo [DAYS]` | Runs `cargo sweep --time DAYS` (default 7). Keeps what recent builds used. Change the window with `CARGO_SWEEP_DAYS=14 make sweep-cargo`. |
| `cd src-tauri && cargo clean -p tauri-plugin-mcp-bridge` | Drops every copy of one crate. |
| `make clean` | Also deletes `test_sandbox/` and frontend build output. Use `clean-cargo` when you only want disk back. |

Both scripts print the target directory size before and after, and honor
`CARGO_TARGET_DIR`, so they work with per-client target directories such as
the demo deployer's.

`sweep-cargo` needs [`cargo-sweep`](https://github.com/holmgr/cargo-sweep):

```bash
cargo install cargo-sweep --locked
```

Without it, `sweep-cargo` removes nothing and prints the install hint. Age is
the last access time of each crate's fingerprint files, which Cargo reads on
every build, so artifacts the current builds still use are kept. Other
`cargo-sweep` modes are useful run directly from the repo root:

```bash
cargo sweep --maxsize 20GB src-tauri   # drop least-recently-used until under 20 GB
cargo sweep --installed src-tauri      # drop artifacts from uninstalled toolchains
```

On Windows without a POSIX shell, run `cargo clean` or `cargo sweep --time 7`
in `src-tauri` directly.

## Worktrees

Each git worktree has its own `src-tauri/target`, so parallel worktrees each
carry their own multi-GB copy. Removing a worktree frees its target with it;
run `make sweep-cargo` in long-lived ones.
