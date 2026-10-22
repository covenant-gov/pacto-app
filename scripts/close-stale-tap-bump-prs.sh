#!/usr/bin/env bash
# Closes open cask bump PRs in the Homebrew tap that are older than the release
# being published, so a superseded PR can never merge over a newer cask.
#
# Usage: close-stale-tap-bump-prs.sh <tag>
# Env:   TAP_REPO (default covenant-gov/homebrew-pacto), GH_TOKEN with
#        pull-requests:write on the tap.
set -euo pipefail

TAG="${1:-}"
if [ -z "$TAG" ]; then
  echo "usage: close-stale-tap-bump-prs.sh <tag>" >&2
  exit 2
fi

TAP_REPO="${TAP_REPO:-covenant-gov/homebrew-pacto}"
BRANCH_PREFIX="chore/bump-"

# True when $1 sorts strictly before $2 under version ordering.
is_older() {
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n 1)" = "$1" ]
}

open_bump_prs="$(
  gh pr list --repo "$TAP_REPO" --state open --limit 100 \
    --json number,headRefName \
    --jq ".[] | select(.headRefName | startswith(\"${BRANCH_PREFIX}v\")) | [.number, .headRefName] | @tsv"
)"

if [ -z "$open_bump_prs" ]; then
  echo "No open ${BRANCH_PREFIX}v* PRs in $TAP_REPO."
  exit 0
fi

while IFS=$'\t' read -r number head_ref; do
  [ -n "$number" ] || continue
  other_tag="${head_ref#"$BRANCH_PREFIX"}"
  case "$head_ref" in
    "${BRANCH_PREFIX}v"*) ;;
    *)
      echo "Skipping #$number ($head_ref): not a cask bump branch."
      continue
      ;;
  esac
  if [ "$other_tag" = "$TAG" ]; then
    echo "Keeping #$number ($head_ref): same tag as this release."
    continue
  fi
  if ! is_older "$other_tag" "$TAG"; then
    echo "Keeping #$number ($head_ref): not older than $TAG."
    continue
  fi
  echo "Closing superseded #$number ($head_ref)."
  gh pr close "$number" --repo "$TAP_REPO" --delete-branch \
    --comment "Superseded by the cask bump for $TAG. Closing so the newer version is the one that lands."
done <<EOF
$open_bump_prs
EOF
