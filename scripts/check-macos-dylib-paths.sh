#!/usr/bin/env bash
# Fails if the given macOS binary's LC_LOAD_DYLIB paths reach outside the
# system, @rpath, @executable_path, or @loader_path. Catches a build
# machine's Homebrew (or other local) path getting baked into a shipped
# binary -- the end user's Mac won't have it, and dyld aborts at launch
# with "Library not loaded" before the app ever draws a window.
#
# Regression coverage for the 0.7.1 startup crash: dyld tried to load
# /opt/homebrew/*/liblzma.5.dylib, which only exists on machines with
# Homebrew's xz installed.
set -euo pipefail

BINARY="${1:?usage: check-macos-dylib-paths.sh <path-to-macho-binary>}"

if [ ! -f "$BINARY" ]; then
  echo "error: no such file: $BINARY" >&2
  exit 1
fi

bad=0
while IFS= read -r path; do
  [ -n "$path" ] || continue
  case "$path" in
    /usr/lib/*|/System/*|@rpath/*|@executable_path/*|@loader_path/*) ;;
    *)
      echo "error: $BINARY links a non-system dylib: $path" >&2
      bad=1
      ;;
  esac
done < <(otool -L "$BINARY" | tail -n +2 | awk '{print $1}')

if [ "$bad" -ne 0 ]; then
  echo "A dylib path outside /usr/lib, /System, @rpath, @executable_path, or @loader_path will not resolve on an end user's Mac." >&2
  exit 1
fi

echo "ok: $BINARY only links system/bundled dylibs"
