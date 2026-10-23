#!/usr/bin/env bash
# Upload PR screenshots to covenant-gov/pacto-pr-assets and print Markdown to embed them.
# Images never enter the code repo's git history.
#
# Usage: pr-screenshot.sh <pr-number|feature-name> <image>... [--width N] [--source NAME]
#
# Layout follows the assets repo README: assets/<source>/pr-<number>/<file>
# (or assets/<source>/<feature-name>/ before a PR exists). File names are
# lowercased and hyphenated. Existing files are never overwritten: give an
# updated screenshot a new name. URLs are pinned to the upload commit.
#
# Env: PR_ASSETS_REPO (default covenant-gov/pacto-pr-assets)
set -euo pipefail

repo="${PR_ASSETS_REPO:-covenant-gov/pacto-pr-assets}"
source_name="pacto"
width=""
target=""
files=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --width) width="$2"; shift 2 ;;
    --source) source_name="$2"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *)
      if [[ -z "$target" ]]; then target="$1"; else files+=("$1"); fi
      shift ;;
  esac
done

slug() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9.]+/-/g; s/^-+//; s/-+$//'; }

if [[ -z "$target" || ${#files[@]} -eq 0 ]]; then
  echo "usage: $(basename "$0") <pr-number|feature-name> <image>... [--width N] [--source NAME]" >&2
  exit 2
fi
if [[ "$target" =~ ^[0-9]+$ ]]; then folder="pr-${target}"; else folder="$(slug "$target")"; fi
dir="assets/$(slug "$source_name")/${folder}"

for f in "${files[@]}"; do
  [[ -f "$f" ]] || { echo "not a file: $f" >&2; exit 2; }
  case "$(slug "$(basename "$f")")" in
    *.png|*.jpg|*.jpeg|*.gif|*.webp) ;;
    *) echo "not an image: $f" >&2; exit 2 ;;
  esac
done

for f in "${files[@]}"; do
  name="$(slug "$(basename "$f")")"
  path="${dir}/${name}"
  if gh api "repos/${repo}/contents/${path}" --silent 2>/dev/null; then
    echo "already exists: ${path} (use a new file name for an updated screenshot)" >&2
    exit 1
  fi

  commit="$(gh api -X PUT "repos/${repo}/contents/${path}" \
    -f "message=add ${path}" \
    -f "content=$(base64 < "$f" | tr -d '\n')" \
    --jq .commit.sha)"
  url="https://raw.githubusercontent.com/${repo}/${commit}/${path}"
  alt="${name%.*}"
  alt="${alt//-/ }"

  if [[ -n "$width" ]]; then
    printf '<img width="%s" alt="%s" src="%s" />\n' "$width" "$alt" "$url"
  else
    printf '![%s](%s)\n' "$alt" "$url"
  fi
done
