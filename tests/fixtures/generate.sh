#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Generating test fixtures..."

# 3-second H.264+AAC MP4 (baseline, no transcode needed)
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i "color=c=blue:size=320x240:rate=30:duration=3" \
  -f lavfi -i "sine=frequency=440:duration=3:sample_rate=48000" \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
  -c:a aac -b:a 128k \
  -movflags +faststart -y test-h264-aac.mp4

echo "  test-h264-aac.mp4"

# 3-second H.264+AC3 MKV (audio transcode needed)
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i "color=c=green:size=320x240:rate=30:duration=3" \
  -f lavfi -i "sine=frequency=660:duration=3:sample_rate=48000" \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
  -c:a ac3 -b:a 192k \
  -y test-h264-ac3.mkv

echo "  test-h264-ac3.mkv"

# 10-second H.264+AC3 MKV with predictable keyframes every 1s
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i "color=c=red:size=320x240:rate=30:duration=10" \
  -f lavfi -i "sine=frequency=880:duration=10:sample_rate=48000" \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 30 -keyint_min 30 \
  -c:a ac3 -b:a 192k \
  -y test-h264-ac3-10s.mkv

echo "  test-h264-ac3-10s.mkv"
echo "Done."
