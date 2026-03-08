#!/usr/bin/env bash
set -euo pipefail

# Release script for playsvideo Chrome extension
# Usage: bash scripts/release-extension.sh <version>
# Example: bash scripts/release-extension.sh 0.1.0

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  echo "Usage: bash scripts/release-extension.sh <version>"
  echo "Example: bash scripts/release-extension.sh 0.1.0"
  exit 1
fi

# Validate version format (must start with a digit, no "v" prefix)
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+'; then
  echo "Error: Version must be in semver format (e.g. 0.1.0), got: $VERSION"
  exit 1
fi

TAG="extension-v${VERSION}"
MANIFEST="extension/manifest.json"
CHANGELOG="extension/CHANGELOG.md"

# Check for clean working tree
if ! git diff-index --quiet HEAD --; then
  echo "Error: Working tree is not clean. Commit or stash changes first."
  git diff --stat
  exit 1
fi

# Check that tag doesn't already exist
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: Tag $TAG already exists."
  exit 1
fi

# Require changelog entry
if ! grep -q "## \[${VERSION}\]" "$CHANGELOG" 2>/dev/null; then
  echo "Error: $CHANGELOG doesn't have an entry for version ${VERSION}"
  echo "Please add a '## [${VERSION}]' section before releasing."
  exit 1
fi

# Run green gates
echo "Running green gates..."
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run test:unit

# Build extension to verify it compiles
echo "Building extension..."
pnpm run build:extension

# Update manifest.json version
CURRENT_VERSION=$(grep -o '"version": "[^"]*"' "$MANIFEST" | grep -o '[0-9][^"]*')
echo "Updating manifest version: $CURRENT_VERSION -> $VERSION"
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$MANIFEST"

# Commit and tag
git add "$MANIFEST"
git commit -m "Release Extension v${VERSION}"
git tag "$TAG"

echo ""
echo "Release Extension v${VERSION} ready. To publish:"
echo "  git push && git push origin ${TAG}"
echo ""
echo "CI will build and create GitHub release."
