#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required but not found in PATH" >&2
  exit 1
fi

encoders="$(ffmpeg -hide_banner -encoders 2>/dev/null || true)"

has_encoder() {
  echo "$encoders" | grep -Eq "[[:space:]]${1}([[:space:]]|$)"
}

DUR=2
SIZE=320x240
RATE=24

gen_av() {
  local out="$1" vcodec="$2" acodec="$3" extra=("${@:4}")
  echo "  $out"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=size=${SIZE}:rate=${RATE}:duration=${DUR}" \
    -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=${DUR}" \
    -shortest -pix_fmt yuv420p \
    -c:v "$vcodec" -g "$RATE" \
    -c:a "$acodec" \
    "${extra[@]}" \
    "$out"
}

echo "Generating codec test matrix..."

# H.264 profiles
gen_av codec-h264-baseline.mp4 libx264 aac -profile:v baseline
gen_av codec-h264-main.mp4     libx264 aac -profile:v main
gen_av codec-h264-high.mp4     libx264 aac -profile:v high

# H.264 + AC3 in MKV (audio transcode path)
gen_av codec-h264-ac3.mkv libx264 ac3 -b:a 192k

# H.264 video-only
echo "  codec-h264-noaudio.mp4"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=${SIZE}:rate=${RATE}:duration=${DUR}" \
  -pix_fmt yuv420p -c:v libx264 -g "$RATE" -an \
  codec-h264-noaudio.mp4

# HEVC
hevc_encoder=""
for enc in libx265 hevc_videotoolbox hevc_qsv; do
  if has_encoder "$enc"; then
    hevc_encoder="$enc"
    break
  fi
done
if [[ -n "$hevc_encoder" ]]; then
  gen_av codec-hevc.mp4 "$hevc_encoder" aac -tag:v hvc1
else
  echo "  SKIP codec-hevc.mp4 (no HEVC encoder)"
fi

# VP9
if has_encoder "libvpx-vp9"; then
  if has_encoder "libopus"; then
    gen_av codec-vp9.webm libvpx-vp9 libopus -b:v 0 -crf 40
  else
    gen_av codec-vp9.webm libvpx-vp9 aac -b:v 0 -crf 40
  fi
else
  echo "  SKIP codec-vp9.webm (no VP9 encoder)"
fi

# AV1
if has_encoder "libaom-av1"; then
  gen_av codec-av1.mp4 libaom-av1 aac -cpu-used 8 -b:v 0 -crf 50
else
  echo "  SKIP codec-av1.mp4 (no AV1 encoder)"
fi

echo "Done."
