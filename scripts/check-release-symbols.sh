#!/usr/bin/env bash
set -euo pipefail

# Verify that the release binary does not contain debug-only test-auth,
# MCP-bridge, or relay-override symbols. This is a safety net to ensure
# #[cfg(debug_assertions)] gating and capability removal keep these out of
# shipped builds.

cd "$(dirname "$0")/.."

echo "Building Tauri release binary..."
cd src-tauri
cargo build --release --no-default-features
cd ..

BINARY="src-tauri/target/release/pacto"
if [[ "${OSTYPE:-}" == "msys" || "${OSTYPE:-}" == "win32" || "${OS:-}" == "Windows_NT" ]]; then
  BINARY="${BINARY}.exe"
fi

if [[ ! -f "$BINARY" ]]; then
  echo "Error: release binary not found at $BINARY" >&2
  exit 1
fi

echo "Checking release binary for forbidden symbols..."
FORBIDDEN=(
  "dev_login"
  "mcp_bridge"
  "PACTO_TRUSTED_RELAYS"
)

FAILED=0
for symbol in "${FORBIDDEN[@]}"; do
  if command -v nm >/dev/null 2>&1; then
    if nm "$BINARY" 2>/dev/null | grep -q "$symbol"; then
      echo "FAILED: found forbidden symbol '$symbol' in release binary" >&2
      FAILED=1
    fi
  fi
  if strings "$BINARY" 2>/dev/null | grep -q "$symbol"; then
    echo "FAILED: found forbidden string '$symbol' in release binary" >&2
    FAILED=1
  fi
done

if [[ "$FAILED" -eq 0 ]]; then
  echo "OK: release binary does not contain forbidden symbols."
  exit 0
else
  exit 1
fi
