#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

INPUT="../fixtures/bigvideo.mp4"

if [ ! -f "$INPUT" ]; then
  echo "ERROR: bigvideo.mp4 not found. Create a symlink:"
  echo "  ln -s /path/to/your/video.mp4 tests/fixtures/bigvideo.mp4"
  exit 1
fi

GOLDEN_DIR="output"
rm -rf "$GOLDEN_DIR"
mkdir -p "$GOLDEN_DIR"

echo "Generating golden HLS reference..."
echo "This may take a few minutes for audio transcode..."

# Generate fMP4 HLS with video copy + audio transcode to AAC
ffmpeg -hide_banner -i "$INPUT" \
  -c:v copy \
  -c:a aac -ac 2 -b:a 160k \
  -f hls \
  -hls_time 4 \
  -hls_list_size 0 \
  -hls_segment_type fmp4 \
  -hls_fmp4_init_filename init.mp4 \
  -hls_segment_filename "$GOLDEN_DIR/seg-%03d.m4s" \
  -y "$GOLDEN_DIR/playlist.m3u8"

echo ""
echo "Verifying golden output is playable..."
ffmpeg -hide_banner -loglevel error \
  -i "$GOLDEN_DIR/playlist.m3u8" -f null - 2>&1 || true

echo ""
echo "Golden reference stats:"
echo "  Segments: $(ls "$GOLDEN_DIR"/seg-*.m4s 2>/dev/null | wc -l | tr -d ' ')"
echo "  Init size: $(du -h "$GOLDEN_DIR/init.mp4" | cut -f1)"
echo "  Total size: $(du -sh "$GOLDEN_DIR" | cut -f1)"
echo ""
echo "First 20 lines of playlist:"
head -20 "$GOLDEN_DIR/playlist.m3u8"
echo "..."
echo ""
echo "Done. Golden reference in: $GOLDEN_DIR/"
