#!/usr/bin/env bash
set -euo pipefail

BUCKET="playsvideo"

content_type() {
  case "$1" in
    *.html) echo "text/html" ;;
    *.js)   echo "application/javascript" ;;
    *.wasm) echo "application/wasm" ;;
    *.json) echo "application/json" ;;
    *.map)  echo "application/json" ;;
    *.css)  echo "text/css" ;;
    *.svg)  echo "image/svg+xml" ;;
    *.png)  echo "image/png" ;;
    *)      echo "application/octet-stream" ;;
  esac
}

upload_dir() {
  local dir="$1"
  local prefix="$2"
  for f in $(find "$dir" -type f); do
    local key="${prefix}${f#$dir/}"
    local ct
    ct=$(content_type "$f")
    echo "Uploading $key"
    npx wrangler r2 object put "$BUCKET/$key" --file="$f" --content-type="$ct" --remote
  done
}

# Upload main site
upload_dir "dist" ""

# Upload media player app under app/ prefix
if [ -d "app/dist" ]; then
  upload_dir "app/dist" "app/"
fi

echo "Deployed to https://playsvideo.com/"
