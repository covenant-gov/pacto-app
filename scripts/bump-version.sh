#!/usr/bin/env bash
set -euo pipefail

ARG="${1:-}"

if [[ -z "$ARG" ]]; then
  echo "Usage: $0 <version|patch|minor|major>"
  echo "Examples:"
  echo "  $0 0.2.1"
  echo "  $0 patch"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

CURRENT_VERSION="$(node -p "require('./package.json').version")"

if [[ "$ARG" == "patch" || "$ARG" == "minor" || "$ARG" == "major" ]]; then
  BASE="${CURRENT_VERSION%%-*}"
  MAJOR="${BASE%%.*}"
  REST="${BASE#*.}"
  MINOR="${REST%%.*}"
  PATCH="${REST#*.}"
  case "$ARG" in
    patch) VERSION="$MAJOR.$MINOR.$((PATCH + 1))" ;;
    minor) VERSION="$MAJOR.$((MINOR + 1)).0" ;;
    major) VERSION="$((MAJOR + 1)).0.0" ;;
  esac
elif [[ "$ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]]; then
  VERSION="$ARG"
else
  echo "Error: argument must be a version number (e.g. 0.2.1) or one of: patch, minor, major"
  exit 1
fi

TAG="v$VERSION"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: tag $TAG already exists"
  exit 1
fi

if ! git diff --quiet HEAD; then
  echo "Error: working tree has uncommitted changes to tracked files. Commit or stash them first."
  git diff --stat
  exit 1
fi

CURRENT_CARGO="$(sed -n '/^\[package\]$/,/^\[/p' src-tauri/Cargo.toml | sed -n 's/^version = "\([^"]*\)"/\1/p')"
CURRENT_TAURI="$(node -p "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json')).version")"

echo "Current versions:"
echo "  package.json:             $CURRENT_VERSION"
echo "  src-tauri/Cargo.toml:       $CURRENT_CARGO"
echo "  src-tauri/tauri.conf.json:  $CURRENT_TAURI"
echo ""
echo "Bumping to $VERSION..."

# Update package.json
node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
p.version = '$VERSION';
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
"

# Update tauri.conf.json
node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
p.version = '$VERSION';
fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(p, null, 2) + '\n');
"

# Update Cargo.toml
sed -i.bak -E '/^\[package\]$/,/^\[/ s/^version = "[^"]+"/version = "'"$VERSION"'"/' src-tauri/Cargo.toml
rm -f src-tauri/Cargo.toml.bak

# Verify sync
NEW_PKG="$(node -p "require('./package.json').version")"
NEW_CARGO="$(sed -n '/^\[package\]$/,/^\[/p' src-tauri/Cargo.toml | sed -n 's/^version = "\([^"]*\)"/\1/p')"
NEW_TAURI="$(node -p "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json')).version")"

if [[ "$NEW_PKG" != "$VERSION" || "$NEW_CARGO" != "$VERSION" || "$NEW_TAURI" != "$VERSION" ]]; then
  echo "Error: version files are not in sync after bump"
  echo "  package.json:             $NEW_PKG"
  echo "  src-tauri/Cargo.toml:       $NEW_CARGO"
  echo "  src-tauri/tauri.conf.json:  $NEW_TAURI"
  exit 1
fi

# Regenerate changelog
pnpm changelog

# Install dependencies with the new version
pnpm install

# Frontend checks and tests
pnpm check
pnpm test

# Rust checks and tests
cd src-tauri
cargo check
cargo test
cd "$ROOT_DIR"

# Validate release workflow exists and contains expected commands
if [[ ! -f ".github/workflows/release.yaml" ]]; then
  echo "Error: .github/workflows/release.yaml not found"
  exit 1
fi

if ! grep -q "tauri-apps/tauri-action" ".github/workflows/release.yaml"; then
  echo "Error: tauri-action not found in release workflow"
  exit 1
fi

# Stage all version-related changes
FILES_TO_STAGE=(
  package.json
  src-tauri/Cargo.toml
  src-tauri/tauri.conf.json
  CHANGELOG.md
)

if [[ -f "pnpm-lock.yaml" ]]; then
  FILES_TO_STAGE+=(pnpm-lock.yaml)
fi

if [[ -f "src-tauri/Cargo.lock" ]]; then
  FILES_TO_STAGE+=(src-tauri/Cargo.lock)
fi

git add "${FILES_TO_STAGE[@]}"

git commit -m "chore(release): bump version to $VERSION"
git tag -a "$TAG" -m "Release $TAG"

echo ""
echo "Version $VERSION is ready. Tag $TAG created."
echo "Next steps:"
echo "  git push origin $(git branch --show-current)"
echo "  git push origin $TAG"
