#!/bin/bash
# Aztec Sidecar Launcher
# This script launches the Node.js sidecar with the correct path

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="${NODE_BIN:-node}"

exec "$NODE_BIN" "$SCRIPT_DIR/server.js" "$@"
