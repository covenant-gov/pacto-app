#!/usr/bin/env bash
# Persist git safe.directory for exactly one checkout into $HOME/.gitconfig.
# Used by Prepare Release in a job container whose HOME is /github/home.
set -euo pipefail

usage() {
  echo "Usage: $0 <absolute-workspace-path>"
}

workspace="${1:-}"
if [[ -z "$workspace" || "$workspace" == "-h" || "$workspace" == "--help" ]]; then
  usage
  exit 1
fi

case "$workspace" in
  '*'|*'*'*|*'?'*|*'['*)
    echo "Error: refusing wildcard git safe.directory" >&2
    exit 1
    ;;
esac

if [[ "$workspace" != /* ]]; then
  echo "Error: workspace path must be absolute" >&2
  exit 1
fi

if [[ ! -d "$workspace" ]]; then
  echo "Error: workspace does not exist: $workspace" >&2
  exit 1
fi

if [[ -z "${HOME:-}" ]]; then
  echo "Error: HOME is unset; cannot persist git config --global" >&2
  exit 1
fi

logical="$(cd "$workspace" && pwd)"
physical="$(cd "$workspace" && pwd -P)"

add_dir() {
  local dir="$1"
  case "$dir" in
    '*'|*'*'*)
      echo "Error: refusing wildcard git safe.directory" >&2
      exit 1
      ;;
  esac
  if git config --global --get-all safe.directory 2>/dev/null | grep -Fxq "$dir"; then
    return 0
  fi
  git config --global --add safe.directory "$dir"
}

add_dir "$workspace"
add_dir "$logical"
if [[ "$physical" != "$logical" ]]; then
  add_dir "$physical"
fi

gitconfig="$HOME/.gitconfig"
if [[ ! -f "$gitconfig" ]]; then
  echo "Error: did not persist gitconfig at $gitconfig" >&2
  exit 1
fi

if git config --global --get-all safe.directory | grep -Fxq '*'; then
  echo "Error: wildcard safe.directory is present in $gitconfig" >&2
  exit 1
fi

if ! git config --global --get-all safe.directory | grep -Fxq "$workspace"; then
  echo "Error: failed to persist safe.directory $workspace in $gitconfig" >&2
  exit 1
fi

echo "Trusted git directory $workspace in $gitconfig"
