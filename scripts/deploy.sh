#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SITE_DIR="$ROOT_DIR/dist-site"
APP_DIR="$ROOT_DIR/app/dist"

if [ ! -d "$SITE_DIR" ] || [ ! -d "$APP_DIR" ]; then
  echo "Missing build output. Run pnpm -w run deploy:site to build and deploy both sites." >&2
  exit 1
fi

# Workers Static Assets accepts one directory. Stage the React app beneath the
# main site's build so Wrangler can hash, diff, and upload both in one request.
rm -rf "$SITE_DIR/app"
mkdir -p "$SITE_DIR/app"
cp -R "$APP_DIR/." "$SITE_DIR/app/"

cd "$ROOT_DIR"
pnpm exec wrangler deploy --config worker/wrangler.toml

echo "Deployed to https://playsvideo.com/"
