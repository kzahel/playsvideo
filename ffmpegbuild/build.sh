#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Building minimal ffmpeg.wasm (audio-only: AC3/EAC3/DTS → AAC)..."
docker buildx build \
  -f "$SCRIPT_DIR/Dockerfile.ffmpeg-audio" \
  -o "$SCRIPT_DIR/out" \
  "$PROJECT_DIR"

echo ""
echo "Output:"
ls -lh "$SCRIPT_DIR/out/"

# Copy to vendor directory
mkdir -p "$PROJECT_DIR/src/vendor/ffmpeg-core-audio"
cp "$SCRIPT_DIR/out/ffmpeg-core.js" "$SCRIPT_DIR/out/ffmpeg-core.wasm" \
   "$PROJECT_DIR/src/vendor/ffmpeg-core-audio/"

echo ""
echo "Installed to src/vendor/ffmpeg-core-audio/"
ls -lh "$PROJECT_DIR/src/vendor/ffmpeg-core-audio/"
