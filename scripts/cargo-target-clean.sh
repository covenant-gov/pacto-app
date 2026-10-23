#!/usr/bin/env bash
# Reclaims disk from the Rust target directory. See docs/build/CARGO_TARGETS.md.
#
#   cargo-target-clean.sh clean          remove the whole target dir (cargo clean)
#   cargo-target-clean.sh sweep [DAYS]   drop artifacts unused for DAYS days (default 7);
#                                        needs cargo-sweep, otherwise a no-op with a hint
#
# Honors CARGO_TARGET_DIR, because cargo resolves the target dir itself.
set -euo pipefail

manifest_dir="$(cd "$(dirname "$0")/../src-tauri" && pwd)"
mode="${1:-}"

usage() {
	echo "usage: $0 clean | sweep [DAYS]" >&2
	exit 2
}

target_dir() {
	cargo metadata --no-deps --format-version 1 --manifest-path "$manifest_dir/Cargo.toml" \
		| sed -n 's/.*"target_directory":"\([^"]*\)".*/\1/p'
}

size_of() {
	if [ -d "$1" ]; then du -sh "$1" 2>/dev/null | cut -f1; else echo "0B"; fi
}

dir="$(target_dir)"
if [ -z "$dir" ]; then
	echo "could not resolve the cargo target directory for $manifest_dir" >&2
	exit 1
fi

case "$mode" in
clean)
	echo "cargo target: $dir ($(size_of "$dir"))"
	cargo clean --manifest-path "$manifest_dir/Cargo.toml"
	echo "cargo target: $dir ($(size_of "$dir")) after clean"
	;;
sweep)
	days="${2:-7}"
	case "$days" in '' | *[!0-9]*) echo "DAYS must be a whole number, got '$days'" >&2; exit 2 ;; esac
	if ! cargo sweep --version >/dev/null 2>&1; then
		echo "cargo-sweep is not installed; nothing removed."
		echo "  install it: cargo install cargo-sweep --locked"
		echo "  or wipe the whole target dir: make clean-cargo"
		exit 0
	fi
	echo "cargo target: $dir ($(size_of "$dir"))"
	cargo sweep --time "$days" "$manifest_dir"
	echo "cargo target: $dir ($(size_of "$dir")) after sweeping artifacts unused for $days days"
	;;
*)
	usage
	;;
esac
