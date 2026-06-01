#!/usr/bin/env bash
set -euo pipefail

# OCAS Publish
# Builds, publishes to npm, tags, and pushes.
#
# Usage: ./scripts/publish.sh
#
# Prerequisites:
#   - On a release/* branch (created by prepare-release.sh)
#   - npm authenticated (`npm whoami` works)
#   - All checks passing

BOLD='\033[1m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

info()  { echo -e "${BOLD}${GREEN}✓${NC} $1"; }
warn()  { echo -e "${BOLD}${YELLOW}⚠${NC} $1"; }
error() { echo -e "${BOLD}${RED}✗${NC} $1"; exit 1; }

# --- Pre-flight checks ---

echo -e "\n${BOLD}OCAS Publish${NC}\n"

# Must be on release/* branch
BRANCH=$(git branch --show-current)
[[ "$BRANCH" == release/* ]] || error "Must be on a release/* branch (currently on $BRANCH)"

# Clean working tree
[[ -z "$(git status --porcelain)" ]] || error "Working tree is not clean. Commit changes first."

# Extract version
VERSION=$(python3 -c "import json; print(json.load(open('packages/core/package.json'))['version'])")
info "Publishing version: $VERSION"

# No pending changesets (should have been consumed by prepare-release.sh)
CHANGESETS=$(ls .changeset/*.md 2>/dev/null | grep -v README.md || true)
if [[ -n "$CHANGESETS" ]]; then
  error "Pending changesets found. Run prepare-release.sh first."
fi

# npm auth check
npm whoami &>/dev/null || error "Not authenticated with npm. Run 'npm login' first."
NPM_USER=$(npm whoami)
info "npm user: $NPM_USER"

# --- Final validation ---

info "Running final validation..."

echo "  → bun run build"
bun run build

echo "  → bun test"
bun test || error "Tests failed! Fix before publishing."

# --- Confirm ---

echo ""
echo -e "${BOLD}Will publish:${NC}"
for pkg in core fs cli; do
  PKG_NAME=$(python3 -c "import json; print(json.load(open('packages/$pkg/package.json'))['name'])")
  echo "  $PKG_NAME@$VERSION"
done
# --- Publish (order matters: core → fs → cli) ---

for pkg in core fs cli; do
  PKG_NAME=$(python3 -c "import json; print(json.load(open('packages/$pkg/package.json'))['name'])")
  echo ""
  info "Publishing $PKG_NAME@$VERSION..."
  (cd "packages/$pkg" && bun publish --access public)
  info "$PKG_NAME@$VERSION published ✓"
done

# --- Tag and push ---

echo ""
TAG="v$VERSION"
git tag -a "$TAG" -m "Release $TAG"
git push origin "$BRANCH"
git push origin "$TAG"
info "Tag $TAG pushed"

# --- Merge back to main ---

echo ""
info "Merging release into main..."
git checkout main
git merge "$BRANCH" --no-ff -m "chore: merge release $TAG"
git push origin main
info "Merged to main"

# Clean up release branch
git branch -d "$BRANCH"
git push origin --delete "$BRANCH" 2>/dev/null || true
info "Release branch cleaned up"

echo ""
info "Release $TAG complete! 🎉"
echo ""
echo "  Published:"
for pkg in core fs cli; do
  PKG_NAME=$(python3 -c "import json; print(json.load(open('packages/$pkg/package.json'))['name'])")
  echo "    https://www.npmjs.com/package/$PKG_NAME"
done
echo ""
