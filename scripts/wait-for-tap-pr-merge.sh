#!/usr/bin/env bash
# Waits for the Homebrew tap's cask bump PR to be merged by the tap's own
# release-bump workflow. Exits non-zero if the PR is closed unmerged or the
# wait times out, so the release job goes red instead of finishing with brew
# users on the previous version.
#
# Usage: wait-for-tap-pr-merge.sh <pr-number>
# Env:   TAP_REPO (default covenant-gov/homebrew-pacto), TIMEOUT_SECONDS
#        (default 1800), POLL_SECONDS (default 30), GH_TOKEN with read access
#        to the tap.
set -euo pipefail

PR="${1:-}"
if [ -z "$PR" ]; then
  echo "usage: wait-for-tap-pr-merge.sh <pr-number>" >&2
  exit 2
fi

TAP_REPO="${TAP_REPO:-covenant-gov/homebrew-pacto}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-1800}"
POLL_SECONDS="${POLL_SECONDS:-30}"
PR_URL="https://github.com/${TAP_REPO}/pull/${PR}"

emit() {
  [ -n "${GITHUB_OUTPUT:-}" ] || return 0
  printf '%s=%s\n' "$1" "$2" >>"$GITHUB_OUTPUT"
}

# Link to the tap-side check that was supposed to merge the PR, when there is one.
tap_run_url() {
  gh run list --repo "$TAP_REPO" --branch "chore/bump-${TAG:-}" --limit 1 \
    --json url --jq '.[0].url // ""' 2>/dev/null || true
}

fail() {
  local reason="$1"
  emit pr_url "$PR_URL"
  emit run_url "$(tap_run_url)"
  emit reason "$reason"
  echo "$reason" >&2
  exit 1
}

emit pr_url "$PR_URL"

deadline=$(($(date +%s) + TIMEOUT_SECONDS))
while :; do
  if state="$(gh pr view "$PR" --repo "$TAP_REPO" --json state --jq .state 2>/dev/null)"; then
    case "$state" in
      MERGED)
        echo "Tap PR #$PR merged: $PR_URL"
        exit 0
        ;;
      CLOSED)
        fail "Tap PR #$PR was closed without merging: $PR_URL"
        ;;
      *)
        echo "Tap PR #$PR is $state; waiting."
        ;;
    esac
  else
    echo "Could not read the state of tap PR #$PR; retrying."
  fi

  if [ "$(date +%s)" -ge "$deadline" ]; then
    fail "Tap PR #$PR was not merged within ${TIMEOUT_SECONDS}s: $PR_URL"
  fi
  sleep "$POLL_SECONDS"
done
