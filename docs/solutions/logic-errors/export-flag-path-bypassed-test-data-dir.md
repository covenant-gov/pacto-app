---
title: Export tests wrote into the real home directory because the flag path bypassed test_data_dir
date: 2026-10-21
category: docs/solutions/logic-errors
module: export-clipboard
problem_type: logic_error
component: backend_rust
symptoms:
  - "cargo test / cargo nextest: `Failed to write pending export flag at /github/home/.local/share/pending_clipboard_export-<pid>: No such file or directory (os error 2)`."
  - "Green on a developer machine, red in CI — the difference is only whether ~/.local/share already exists."
root_cause: wrong_path_resolver
resolution_type: code_fix
severity: medium
tags: [rust, tauri, app-data-dir, test-sandbox, ci, clipboard-export]
---

# Export tests wrote into the real home directory because the flag path bypassed test_data_dir

## Problem

`export.rs::pending_export_flag_path` resolved the uncleared-export flag with `handle.path().app_data_dir()`. Under `cargo test`, `tauri::test::mock_app()` builds its context with an empty identifier, so that call returns the bare OS data directory — `~/.local/share` on Linux — instead of any app profile. On a developer machine that directory already exists and the tests pass. In the CI container `$HOME` is `/github/home` with no `.local/share`, and `std::fs::write` does not create parents, so four export tests failed with `os error 2`.

## Solution

Resolve through `crate::test_sandbox::test_data_dir(handle)`, which every other module already uses: the configured sandbox root when `PACTO_TEST_SANDBOX_ROOT` is set, a per-process disposable temp root in test builds, the real Tauri app data dir in production. `set_pending_export_flag` also `create_dir_all`s the parent before writing — the flag is written before anything else creates the data directory, so a first run had the same hole.

Verified by running the tests with `HOME` pointed at an empty directory: they fail on the old code and pass on the new one, leaving that directory untouched.

## Prevention

- Never call `handle.path().app_data_dir()` / `app_local_data_dir()` directly in this crate. `test_sandbox::test_data_dir` / `test_local_data_dir` is the only correct resolver; a direct call silently writes to the developer's real home in test builds (issue #347 is the earlier instance of the same mistake).
- A file write to a directory the code did not create needs `create_dir_all` first; "it exists on my machine" is not a guarantee in CI containers or on first run.
