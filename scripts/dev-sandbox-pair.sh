#!/usr/bin/env bash
# Launch Host (solo) + Guest (alice) sandboxes with distinct autologin
# mnemonics, wait until both sandbox-handle.json files carry an npub, then
# print connection details. Foreground: Ctrl+C stops both.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# BIP-39 official test vectors — never the Anvil/relay-free-harness fixture
# ("test test … junk"), which would collapse both windows onto one identity.
# Override with HOST_MNEMONIC / GUEST_MNEMONIC if you need stable personas.
HOST_PERSONA="${HOST_PERSONA:-solo}"
GUEST_PERSONA="${GUEST_PERSONA:-alice}"
HOST_MNEMONIC="${HOST_MNEMONIC:-legal winner thank year wave sausage worth useful legal winner thank yellow}"
GUEST_MNEMONIC="${GUEST_MNEMONIC:-letter advice cage absurd amount doctor acoustic avoid letter advice cage above}"

if [[ "$HOST_MNEMONIC" == "$GUEST_MNEMONIC" ]]; then
  echo "dev-sandbox-pair: HOST_MNEMONIC and GUEST_MNEMONIC must differ" >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo detached)"
slug="$(node -e "import('./scripts/dev-ports.mjs').then(m => process.stdout.write(m.slugForBranch(process.argv[1])))" "$branch")"
host_root="$ROOT/test_sandbox/$slug/$HOST_PERSONA"
guest_root="$ROOT/test_sandbox/$slug/$GUEST_PERSONA"
mkdir -p "$host_root" "$guest_root"

host_log="$(mktemp -t pacto-sandbox-host.XXXXXX)"
guest_log="$(mktemp -t pacto-sandbox-guest.XXXXXX)"
host_pid=""
guest_pid=""

cleanup() {
  local code=$?
  if [[ -n "$host_pid" ]] && kill -0 "$host_pid" 2>/dev/null; then
    kill "$host_pid" 2>/dev/null || true
  fi
  if [[ -n "$guest_pid" ]] && kill -0 "$guest_pid" 2>/dev/null; then
    kill "$guest_pid" 2>/dev/null || true
  fi
  wait "$host_pid" "$guest_pid" 2>/dev/null || true
  exit "$code"
}
trap cleanup INT TERM EXIT

echo "dev-sandbox-pair: branch '$branch' slug '$slug'"
echo "  host  persona=$HOST_PERSONA  log=$host_log"
echo "  guest persona=$GUEST_PERSONA log=$guest_log"

# make dev-sandbox already sets PACTO_ALLOW_TEST_AUTH=1. Distinct mnemonics
# must be passed in: the Anvil/relay-free-harness fixture would collapse both
# windows onto one identity. Start Host first so Guest does not compile
# against a locked target/.
PACTO_DEV_LOGIN_MNEMONIC="$HOST_MNEMONIC" \
  PERSONA="$HOST_PERSONA" make -C "$ROOT" dev-sandbox >"$host_log" 2>&1 &
host_pid=$!

echo "waiting for host handle (so Guest does not compile against a busy target/)..."
handle_wait_deadline=$((SECONDS + 180))
while (( SECONDS < handle_wait_deadline )); do
  if ! kill -0 "$host_pid" 2>/dev/null; then
    echo "host sandbox exited early; last log:" >&2
    tail -n 40 "$host_log" >&2
    exit 1
  fi
  if [[ -f "$host_root/sandbox-handle.json" ]]; then
    break
  fi
  sleep 2
done
if [[ ! -f "$host_root/sandbox-handle.json" ]]; then
  echo "timed out waiting for $host_root/sandbox-handle.json" >&2
  tail -n 40 "$host_log" >&2
  exit 1
fi

PACTO_DEV_LOGIN_MNEMONIC="$GUEST_MNEMONIC" \
  PERSONA="$GUEST_PERSONA" make -C "$ROOT" dev-sandbox >"$guest_log" 2>&1 &
guest_pid=$!

handle_field() {
  local file="$1/sandbox-handle.json"
  local field="$2"
  if [[ ! -f "$file" ]]; then
    echo ""
    return
  fi
  node -e "
    const fs = require('fs');
    try {
      const h = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      const parts = process.argv[2].split('.');
      let v = h;
      for (const p of parts) v = v?.[p];
      process.stdout.write(v == null ? '' : String(v));
    } catch { process.stdout.write(''); }
  " "$file" "$field"
}

echo "waiting for both handles to carry npub (first compile can take a minute)..."
deadline=$((SECONDS + 240))
while (( SECONDS < deadline )); do
  if ! kill -0 "$host_pid" 2>/dev/null; then
    echo "host sandbox exited early; last log:" >&2
    tail -n 40 "$host_log" >&2
    exit 1
  fi
  if ! kill -0 "$guest_pid" 2>/dev/null; then
    echo "guest sandbox exited early; last log:" >&2
    tail -n 40 "$guest_log" >&2
    exit 1
  fi
  host_npub="$(handle_field "$host_root" npub)"
  guest_npub="$(handle_field "$guest_root" npub)"
  if [[ -n "$host_npub" && -n "$guest_npub" ]]; then
    break
  fi
  sleep 2
done

host_npub="$(handle_field "$host_root" npub)"
guest_npub="$(handle_field "$guest_root" npub)"
if [[ -z "$host_npub" || -z "$guest_npub" ]]; then
  echo "timed out waiting for npub on both sandbox handles" >&2
  echo "  host  $host_root/sandbox-handle.json npub=${host_npub:-null}" >&2
  echo "  guest $guest_root/sandbox-handle.json npub=${guest_npub:-null}" >&2
  exit 1
fi

echo
echo "both sandboxes authenticated:"
echo "  Host  persona=$HOST_PERSONA  mcpBridge=$(handle_field "$host_root" ports.mcpBridge)  npub=$host_npub"
echo "  Guest persona=$GUEST_PERSONA mcpBridge=$(handle_field "$guest_root" ports.mcpBridge) npub=$guest_npub"
echo "logs: $host_log  $guest_log"
echo "Ctrl+C to stop both."

wait "$host_pid" "$guest_pid"
