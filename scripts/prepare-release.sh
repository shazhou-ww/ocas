#!/usr/bin/env bash
set -euo pipefail

# OCAS Release Preparation
# Creates a release branch, runs changeset version, and validates.
#
# Usage: ./scripts/prepare-release.sh
#
# Prerequisites:
#   - Clean working tree on main branch
#   - Pending changesets in .changeset/

BOLD='\033[1m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

info()  { echo -e "${BOLD}${GREEN}✓${NC} $1"; }
warn()  { echo -e "${BOLD}${YELLOW}⚠${NC} $1"; }
error() { echo -e "${BOLD}${RED}✗${NC} $1"; exit 1; }

# --- Pre-flight checks ---

echo -e "\n${BOLD}OCAS Release Preparation${NC}\n"

# Must be on main
BRANCH=$(git branch --show-current)
[[ "$BRANCH" == "main" ]] || error "Must be on main branch (currently on $BRANCH)"

# Clean working tree
[[ -z "$(git status --porcelain)" ]] || error "Working tree is not clean. Commit or stash changes first."

# Check for pending changesets
CHANGESETS=$(ls .changeset/*.md 2>/dev/null | grep -v README.md || true)
if [[ -z "$CHANGESETS" ]]; then
  error "No pending changesets found. Run 'bunx changeset' to add one first."
fi

info "Found pending changesets:"
for cs in $CHANGESETS; do
  echo "    $(basename "$cs")"
done

# --- Determine version ---

# Dry-run to peek at the version bump
echo ""
info "Previewing version changes..."
bunx changeset status

# --- Create release branch ---

echo ""
read -rp "Proceed with release branch? [y/N] " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

# Get current version to name the branch
CURRENT_VERSION=$(python3 -c "import json; print(json.load(open('packages/core/package.json'))['version'])")
info "Current version: $CURRENT_VERSION"

git fetch origin
git checkout -b release/next

# --- Run changeset version ---

info "Running changeset version..."
bunx changeset version

# Show what changed
NEW_VERSION=$(python3 -c "import json; print(json.load(open('packages/core/package.json'))['version'])")
info "New version: $NEW_VERSION"

# Rename branch to include actual version
git branch -m "release/next" "release/$NEW_VERSION"
info "Release branch: release/$NEW_VERSION"

# --- Validate ---

echo ""
info "Running validation..."

echo "  → bun install"
bun install --no-cache

echo "  → bun run build"
bun run build

echo "  → bun run check"
bun run check || warn "Lint warnings found (review above)"

echo "  → bun test"
bun test || error "Tests failed!"

info "All checks passed"

# --- Commit ---

git add -A
git commit -m "chore(release): prepare v$NEW_VERSION"

echo ""
info "Release branch ready: release/$NEW_VERSION"
echo ""
echo "  Next steps:"
echo "    1. Review changes:  git diff main...HEAD"
echo "    2. Fix issues if needed, commit to this branch"
echo "    3. When ready:      ./scripts/publish.sh"
echo ""
