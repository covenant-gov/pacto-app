#!/usr/bin/env bash
set -euo pipefail

ARG=""
NO_COMMIT=""
SKIP_CHECKS=""

usage() {
  echo "Usage: $0 <version|patch|minor|major> [--no-commit] [--skip-checks]"
  echo "Examples:"
  echo "  $0 0.2.1"
  echo "  $0 patch"
  echo "  $0 patch --no-commit --skip-checks"
}

for raw in "$@"; do
  case "$raw" in
    --no-commit) NO_COMMIT="--no-commit" ;;
    --skip-checks) SKIP_CHECKS=1 ;;
    --help|-h)
      usage
      exit 0
      ;;
    --*)
      echo "Error: unknown option $raw"
      usage
      exit 1
      ;;
    *)
      if [[ -n "$ARG" ]]; then
        echo "Error: unexpected argument $raw"
        usage
        exit 1
      fi
      ARG="$raw"
      ;;
  esac
done

if [[ -z "$ARG" ]]; then
  usage
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

if ! git_inside="$(git rev-parse --is-inside-work-tree 2>&1)"; then
  echo "Error: cannot use this directory as a git work tree."
  echo "$git_inside"
  exit 1
fi
if [[ "$git_inside" != "true" ]]; then
  echo "Error: cannot use this directory as a git work tree."
  exit 1
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: tag $TAG already exists"
  exit 1
fi

diff_status=0
git diff --quiet HEAD || diff_status=$?
if [[ "$diff_status" -eq 1 ]]; then
  echo "Error: working tree has uncommitted changes to tracked files. Commit or stash them first."
  git diff --stat HEAD
  exit 1
elif [[ "$diff_status" -ne 0 ]]; then
  echo "Error: git diff failed (exit $diff_status)."
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

# Keep Cargo.lock's workspace package version in sync without resolving crates.
node -e '
const fs = require("fs");
const version = process.argv[1];
const path = "src-tauri/Cargo.lock";
const lock = fs.readFileSync(path, "utf8");
const next = lock.replace(
  /(\[\[package\]\]\nname = "pacto"\n)version = "[^"]+"/,
  `$1version = "${version}"`
);
if (!new RegExp(`\\[\\[package\\]\\]\\nname = "pacto"\\nversion = "${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(next)) {
  console.error("Error: could not update pacto version in Cargo.lock");
  process.exit(1);
}
if (next !== lock) fs.writeFileSync(path, next);
' "$VERSION"

# Verify sync
NEW_PKG="$(node -p "require('./package.json').version")"
NEW_CARGO="$(sed -n '/^\[package\]$/,/^\[/p' src-tauri/Cargo.toml | sed -n 's/^version = "\([^"]*\)"/\1/p')"
NEW_TAURI="$(node -p "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json')).version")"
NEW_LOCK="$(node -e '
const lock = require("fs").readFileSync("src-tauri/Cargo.lock", "utf8");
const match = lock.match(/\[\[package\]\]\nname = "pacto"\nversion = "([^"]+)"/);
process.stdout.write(match ? match[1] : "");
')"

if [[ "$NEW_PKG" != "$VERSION" || "$NEW_CARGO" != "$VERSION" || "$NEW_TAURI" != "$VERSION" || "$NEW_LOCK" != "$VERSION" ]]; then
  echo "Error: version files are not in sync after bump"
  echo "  package.json:             $NEW_PKG"
  echo "  src-tauri/Cargo.toml:       $NEW_CARGO"
  echo "  src-tauri/tauri.conf.json:  $NEW_TAURI"
  echo "  src-tauri/Cargo.lock:       $NEW_LOCK"
  exit 1
fi

# Regenerate changelog; --tag titles the new section before the tag exists.
node scripts/changelog.mjs --tag "$TAG" --output CHANGELOG.md
./scripts/post-process-changelog.sh

if [[ -n "$SKIP_CHECKS" ]]; then
  # Refresh the lockfile if package.json identity changed; do not install or
  # compile. Full frontend/Rust checks run on the release PR via ci.yaml.
  pnpm install --lockfile-only --ignore-scripts
else
  pnpm install
  pnpm check
  pnpm test
  cd src-tauri
  cargo check
  cargo test
  cd "$ROOT_DIR"
fi

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

if [[ "$NO_COMMIT" == "--no-commit" ]]; then
  git add "${FILES_TO_STAGE[@]}"
  echo ""
  echo "Version $VERSION staged (not committed)."
else
  git add "${FILES_TO_STAGE[@]}"
  git commit -m "chore(release): bump version to $VERSION"
  git tag -a "$TAG" -m "Release $TAG"

  echo ""
  echo "Version $VERSION is ready. Tag $TAG created."
  echo "Next steps:"
  echo "  git push origin $(git branch --show-current)"
  echo "  git push origin $TAG"
fi
