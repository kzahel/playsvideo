#!/usr/bin/env bash
set -euo pipefail

# Release script for playsvideo
# Usage: bash scripts/release.sh <version>
# Example: bash scripts/release.sh 0.1.0

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  echo "Usage: bash scripts/release.sh <version>"
  echo "Example: bash scripts/release.sh 0.1.0"
  exit 1
fi

# Validate version format (must start with a digit, no "v" prefix)
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+'; then
  echo "Error: Version must be in semver format (e.g. 0.1.0), got: $VERSION"
  exit 1
fi

TAG="v${VERSION}"

# Check for clean working tree
if ! git diff-index --quiet HEAD --; then
  echo "Error: Working tree is not clean. Commit or stash changes first."
  exit 1
fi

# Check that tag doesn't already exist
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: Tag $TAG already exists."
  exit 1
fi

# Require changelog entry
CHANGELOG="CHANGELOG.md"
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

# Build library to verify it compiles
echo "Building library..."
pnpm run build:lib

# Update version in package.json
echo "Updating package.json version to ${VERSION}..."
npm version "$VERSION" --no-git-tag-version --allow-same-version

# Commit and tag
git add package.json pnpm-lock.yaml
git commit -m "Release ${TAG}"
git tag "$TAG"

echo ""
echo "Release ${TAG} ready. To publish:"
echo "  git push && git push origin ${TAG}"
echo ""
echo "CI will run green gates again and publish to npm."
