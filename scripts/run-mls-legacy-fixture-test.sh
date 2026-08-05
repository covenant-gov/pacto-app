#!/usr/bin/env bash
# Optional operator check: real pre-upgrade mls/ directory with hot WAL.
# Synthetic V100/V104 fixtures already gate CI; this is for local/ops validation only.
set -euo pipefail

if [[ -z "${MLS_LEGACY_FIXTURE:-}" ]]; then
  echo "MLS_LEGACY_FIXTURE unset; skipping real legacy store fixture test."
  exit 0
fi

if [[ ! -d "$MLS_LEGACY_FIXTURE" ]]; then
  echo "MLS_LEGACY_FIXTURE is not a directory: $MLS_LEGACY_FIXTURE" >&2
  exit 1
fi

cd "$(dirname "$0")/../src-tauri"
exec cargo test --lib \
  mls_store_reset::tests::real_legacy_store_copy_archives_with_hot_wal_and_fresh_store_opens \
  -- --ignored --exact
