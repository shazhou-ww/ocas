#!/usr/bin/env bash
set -euo pipefail

# OCAS Publish
# Builds, publishes to npm, tags, and pushes.
#
# Usage: ./scripts/publish.sh         # publish final release
#        ./scripts/publish.sh --rc    # publish prerelease (rc tag)
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

# --- Parse flags ---

RC_MODE=false
if [[ "${1:-}" == "--rc" ]]; then
  RC_MODE=true
fi

# --- Pre-flight checks ---

echo -e "\n${BOLD}OCAS Publish${NC}\n"

# Must be on release/* branch
BRANCH=$(git branch --show-current)
[[ "$BRANCH" == release/* ]] || error "Must be on a release/* branch (currently on $BRANCH)"

# Clean working tree
[[ -z "$(git status --porcelain)" ]] || error "Working tree is not clean. Commit changes first."

# Extract base version from package.json
BASE_VERSION=$(python3 -c "import json; print(json.load(open('packages/core/package.json'))['version'])")

# Determine publish version and npm tag
if [[ "$RC_MODE" == "true" ]]; then
  # Find next rc number
  EXISTING_RC=$(npm view "@ocas/core" versions --json 2>/dev/null | python3 -c "
import json, sys, re
versions = json.load(sys.stdin)
if not isinstance(versions, list): versions = [versions]
rc_nums = [int(m.group(1)) for v in versions if (m := re.match(r'^${BASE_VERSION}-rc\.(\d+)$', v))]
print(max(rc_nums) + 1 if rc_nums else 1)
" 2>/dev/null || echo 1)
  VERSION="${BASE_VERSION}-rc.${EXISTING_RC}"
  NPM_TAG="rc"
  info "Prerelease mode: $VERSION (npm tag: rc)"
else
  VERSION="$BASE_VERSION"
  NPM_TAG="latest"

  # No pending changesets (should have been consumed by prepare-release.sh)
  CHANGESETS=$(ls .changeset/*.md 2>/dev/null | grep -v README.md || true)
  if [[ -n "$CHANGESETS" ]]; then
    error "Pending changesets found. Run prepare-release.sh first."
  fi
fi

# npm auth check
npm whoami &>/dev/null || error "Not authenticated with npm. Run 'npm login' first."
NPM_USER=$(npm whoami)
info "npm user: $NPM_USER"

# --- Set version in all packages ---

info "Setting version: $VERSION"
for pkg in core fs cli; do
  python3 -c "
import json
path = 'packages/$pkg/package.json'
data = json.load(open(path))
data['version'] = '$VERSION'
# Fix workspace:* to actual version for publishing
for dep in list(data.get('dependencies', {})):
    if data['dependencies'][dep] == 'workspace:*':
        data['dependencies'][dep] = '$VERSION'
json.dump(data, open(path, 'w'), indent=2)
open(path, 'a').write('\n')
"
done

# --- Final validation ---

info "Running final validation..."

echo "  → bun run build"
bun run build

echo "  → bun test"
bun test || error "Tests failed! Fix before publishing."

# --- Publish (order matters: core → fs → cli) ---

echo ""
echo -e "${BOLD}Will publish:${NC}"
for pkg in core fs cli; do
  PKG_NAME=$(python3 -c "import json; print(json.load(open('packages/$pkg/package.json'))['name'])")
  echo "  $PKG_NAME@$VERSION (tag: $NPM_TAG)"
done

for pkg in core fs cli; do
  PKG_NAME=$(python3 -c "import json; print(json.load(open('packages/$pkg/package.json'))['name'])")
  echo ""
  info "Publishing $PKG_NAME@$VERSION..."
  (cd "packages/$pkg" && bun publish --access public --tag "$NPM_TAG")
  info "$PKG_NAME@$VERSION published ✓"
done

# --- Commit version changes ---

git add -A
if [[ -n "$(git diff --cached --name-only)" ]]; then
  git commit -m "chore(release): set version $VERSION"
fi

# --- For final release: tag, push, merge back ---

if [[ "$RC_MODE" == "false" ]]; then
  TAG="v$VERSION"
  git tag -a "$TAG" -m "Release $TAG"
  git push origin "$BRANCH" --tags
  git push github "$BRANCH" --tags 2>/dev/null || true
  info "Tag $TAG pushed"

  # Merge back to main
  echo ""
  info "Merging release into main..."
  git checkout main
  git merge "$BRANCH" --no-ff -m "chore: merge release $TAG"

  # Restore workspace:* on main
  for pkg in fs cli; do
    python3 -c "
import json
path = 'packages/$pkg/package.json'
data = json.load(open(path))
for dep in list(data.get('dependencies', {})):
    if dep.startswith('@ocas/'):
        data['dependencies'][dep] = 'workspace:*'
json.dump(data, open(path, 'w'), indent=2)
open(path, 'a').write('\n')
"
  done
  git add -A
  git commit -m "chore: restore workspace:* deps on main" || true

  git push origin main
  git push github main 2>/dev/null || true
  info "Merged to main"

  # Clean up release branch
  git branch -d "$BRANCH"
  git push origin --delete "$BRANCH" 2>/dev/null || true
  git push github --delete "$BRANCH" 2>/dev/null || true
  info "Release branch cleaned up"

  echo ""
  info "Release $TAG complete! 🎉"
  echo ""
  echo "  Published:"
  for pkg in core fs cli; do
    PKG_NAME=$(python3 -c "import json; print(json.load(open('packages/$pkg/package.json'))['name'])")
    echo "    https://www.npmjs.com/package/$PKG_NAME"
  done
else
  # RC: just push the branch
  git push origin "$BRANCH"
  git push github "$BRANCH" 2>/dev/null || true

  echo ""
  info "Prerelease $VERSION published! 🏷️"
  echo ""
  echo "  Install for testing:"
  echo "    bun add -g @ocas/cli@rc"
  echo ""
  echo "  When verified, run final release:"
  echo "    ./scripts/publish.sh"
fi
echo ""
