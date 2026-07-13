#!/usr/bin/env bash
set -euo pipefail

# This script inserts a concise, value-based summary for the v0.1.0 release
# after git-cliff regenerates CHANGELOG.md. v0.1.0 is ignored by git-cliff
# because its raw commit history is too noisy for an initial release.

CHANGELOG="CHANGELOG.md"
V010_SUMMARY="## v0.1.0

- Init project."

if [[ ! -f "$CHANGELOG" ]]; then
  echo "Error: $CHANGELOG not found"
  exit 1
fi

# If the changelog already has a v0.1.0 section, leave it alone.
if grep -q '^## v0.1.0$' "$CHANGELOG"; then
  exit 0
fi

# Append the v0.1.0 summary at the end of the file.
{
  echo ""
  echo "$V010_SUMMARY"
} >> "$CHANGELOG"
