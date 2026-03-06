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

gen_video_only() {
  local out="$1" vcodec="$2" extra=("${@:3}")
  echo "  $out"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=size=${SIZE}:rate=${RATE}:duration=${DUR}" \
    -pix_fmt yuv420p -c:v "$vcodec" -g "$RATE" -an \
    "${extra[@]}" \
    "$out"
}

gen_audio_only() {
  local out="$1" acodec="$2" extra=("${@:3}")
  echo "  $out"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=${DUR}" \
    -c:a "$acodec" \
    "${extra[@]}" \
    "$out"
}

echo "Generating codec test matrix..."

# === VIDEO CODECS ===
echo
echo "Video codecs:"

# H.264 profiles
gen_av codec-h264-baseline.mp4 libx264 aac -profile:v baseline
gen_av codec-h264-main.mp4     libx264 aac -profile:v main
gen_av codec-h264-high.mp4     libx264 aac -profile:v high

# HEVC
hevc_encoder=""
for enc in libx265 hevc_videotoolbox hevc_qsv; do
  if has_encoder "$enc"; then hevc_encoder="$enc"; break; fi
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

# VP8
if has_encoder "libvpx"; then
  if has_encoder "libvorbis"; then
    gen_av codec-vp8.webm libvpx libvorbis -b:v 500k
  elif has_encoder "libopus"; then
    gen_av codec-vp8.webm libvpx libopus -b:v 500k
  else
    echo "  SKIP codec-vp8.webm (no Vorbis or Opus encoder for WebM audio)"
  fi
else
  echo "  SKIP codec-vp8.webm (no VP8 encoder)"
fi

# AV1
if has_encoder "libaom-av1"; then
  gen_av codec-av1.mp4 libaom-av1 aac -cpu-used 8 -b:v 0 -crf 50
else
  echo "  SKIP codec-av1.mp4 (no AV1 encoder)"
fi

# MPEG-4 Part 2 (legacy, MSE unsupported)
if has_encoder "mpeg4"; then
  gen_av codec-mpeg4.mp4 mpeg4 aac -b:v 500k
else
  echo "  SKIP codec-mpeg4.mp4 (no mpeg4 encoder)"
fi

# MPEG-2 (legacy, MSE unsupported)
if has_encoder "mpeg2video"; then
  gen_av codec-mpeg2.ts mpeg2video mp2 -b:v 1000k -b:a 192k
else
  echo "  SKIP codec-mpeg2.ts (no mpeg2video encoder)"
fi

# MPEG-1 (legacy, MSE unsupported)
if has_encoder "mpeg1video"; then
  gen_av codec-mpeg1.mpg mpeg1video mp2 -b:v 500k -b:a 192k
else
  echo "  SKIP codec-mpeg1.mpg (no mpeg1video encoder)"
fi

# === CONTAINERS (H.264+AAC in different wrappers) ===
echo
echo "Containers:"

gen_av codec-h264-mkv.mkv   libx264 aac
gen_av codec-h264-ts.ts      libx264 aac

if has_encoder "libmp3lame"; then
  gen_av codec-h264-avi.avi libx264 libmp3lame
else
  echo "  SKIP codec-h264-avi.avi (no mp3 encoder)"
fi

gen_av codec-h264-flv.flv libx264 aac

# === AUDIO CODEC VARIATIONS (with H.264 video) ===
echo
echo "Audio codecs:"

gen_av codec-h264-ac3.mkv   libx264 ac3   -b:a 192k
gen_av codec-h264-mp3.mkv   libx264 libmp3lame -b:a 128k

if has_encoder "eac3"; then
  gen_av codec-h264-eac3.mkv libx264 eac3 -b:a 192k
else
  echo "  SKIP codec-h264-eac3.mkv (no eac3 encoder)"
fi

if has_encoder "flac"; then
  gen_av codec-h264-flac.mkv libx264 flac
else
  echo "  SKIP codec-h264-flac.mkv (no flac encoder)"
fi

if has_encoder "libopus"; then
  gen_av codec-h264-opus.mkv libx264 libopus -b:a 96k
else
  echo "  SKIP codec-h264-opus.mkv (no opus encoder)"
fi

# === SPECIAL CASES ===
echo
echo "Special cases:"

# Video-only (no audio)
gen_video_only codec-h264-noaudio.mp4 libx264

# Audio-only files
gen_audio_only codec-audio-aac.m4a  aac  -b:a 128k
gen_audio_only codec-audio-mp3.mp3  libmp3lame -b:a 128k

if has_encoder "libopus"; then
  gen_audio_only codec-audio-opus.ogg libopus -b:a 96k
else
  echo "  SKIP codec-audio-opus.ogg (no opus encoder)"
fi

if has_encoder "flac"; then
  gen_audio_only codec-audio-flac.flac flac
else
  echo "  SKIP codec-audio-flac.flac (no flac encoder)"
fi

echo
echo "Done."
