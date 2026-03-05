#!/usr/bin/env bash
set -euo pipefail

BUCKET="playsvideo"
DIR="dist"

for f in $(find "$DIR" -type f); do
  key="${f#$DIR/}"
  case "$f" in
    *.html) ct="text/html" ;;
    *.js)   ct="application/javascript" ;;
    *.wasm) ct="application/wasm" ;;
    *.map)  ct="application/json" ;;
    *.css)  ct="text/css" ;;
    *)      ct="application/octet-stream" ;;
  esac
  echo "Uploading $key"
  npx wrangler r2 object put "$BUCKET/$key" --file="$f" --content-type="$ct" --remote
done

echo "Deployed to https://playsvideo.com/"
