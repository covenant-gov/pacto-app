#!/usr/bin/env bash
# Reclaims disk from the Rust target directory. See docs/build/CARGO_TARGETS.md.
#
#   cargo-target-clean.sh clean          remove the whole target dir (cargo clean)
#   cargo-target-clean.sh sweep [DAYS]   drop artifacts unused for DAYS days (default 7);
#                                        needs cargo-sweep, otherwise a no-op with a hint
#   cargo-target-clean.sh check          refuse if target exceeds CARGO_TARGET_CAP_GB (default 25)
#   cargo-target-clean.sh cap            drop LRU until under CARGO_TARGET_CAP_GB (needs cargo-sweep)
#
# Honors CARGO_TARGET_DIR, because cargo resolves the target dir itself.
set -euo pipefail

manifest_dir="$(cd "$(dirname "$0")/../src-tauri" && pwd)"
mode="${1:-}"
cap_gb="${CARGO_TARGET_CAP_GB:-25}"

usage() {
	echo "usage: $0 clean | sweep [DAYS] | check | cap" >&2
	exit 2
}

target_dir() {
	cargo metadata --no-deps --format-version 1 --manifest-path "$manifest_dir/Cargo.toml" \
		| sed -n 's/.*"target_directory":"\([^"]*\)".*/\1/p'
}

size_of() {
	if [ -d "$1" ]; then du -sh "$1" 2>/dev/null | cut -f1; else echo "0B"; fi
}

# Whole KiB from du -sk (portable); 0 if the dir is missing.
size_kib() {
	if [ -d "$1" ]; then du -sk "$1" 2>/dev/null | cut -f1; else echo 0; fi
}

require_cap_gb() {
	case "$cap_gb" in '' | *[!0-9]*) echo "CARGO_TARGET_CAP_GB must be a whole number, got '$cap_gb'" >&2; exit 2 ;; esac
	if [ "$cap_gb" -eq 0 ]; then
		echo "CARGO_TARGET_CAP_GB must be >= 1, got '$cap_gb'" >&2
		exit 2
	fi
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
check)
	require_cap_gb
	kib="$(size_kib "$dir")"
	# Cap in KiB: GiB * 1024^2
	cap_kib=$((cap_gb * 1024 * 1024))
	if [ "$kib" -le "$cap_kib" ]; then
		exit 0
	fi
	human="$(size_of "$dir")"
	echo "cargo target over cap: $dir ($human > ${cap_gb} GiB)" >&2
	echo "  reclaim: make sweep-cargo | make cap-cargo | make clean-cargo" >&2
	echo "  override cap: CARGO_TARGET_CAP_GB=${cap_gb} (raise) or PACTO_ALLOW_LARGE_CARGO_TARGET=1 (skip once)" >&2
	if [ -n "${PACTO_ALLOW_LARGE_CARGO_TARGET:-}" ]; then
		echo "  PACTO_ALLOW_LARGE_CARGO_TARGET set; continuing" >&2
		exit 0
	fi
	exit 1
	;;
cap)
	require_cap_gb
	if ! cargo sweep --version >/dev/null 2>&1; then
		echo "cargo-sweep is not installed; nothing removed."
		echo "  install it: cargo install cargo-sweep --locked"
		echo "  or wipe the whole target dir: make clean-cargo"
		exit 0
	fi
	echo "cargo target: $dir ($(size_of "$dir"))"
	cargo sweep --maxsize "${cap_gb}GB" "$manifest_dir"
	echo "cargo target: $dir ($(size_of "$dir")) after capping to ${cap_gb} GiB"
	;;
*)
	usage
	;;
esac
