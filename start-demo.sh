#!/bin/bash
# Buildline demo launcher for macOS. Double-click this file in Finder.
# It installs what it needs (once), builds the app, seeds demo data and opens it in your browser.
cd "$(dirname "$0")"
echo "Buildline demo"
echo "================"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Please download the LTS version from https://nodejs.org, install it, then double-click this file again."
  read -n 1 -s -r -p "Press any key to close."; exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22 or newer is required (you have $(node -v)). Please update from https://nodejs.org."
  read -n 1 -s -r -p "Press any key to close."; exit 1
fi
if [ ! -d node_modules ]; then
  echo "Installing (first run only, 1–2 minutes)…"
  npx --yes pnpm@10.33.0 install || { echo "Install failed."; read -n 1 -s -r -p "Press any key to close."; exit 1; }
fi
echo "Building the app…"
npx --yes pnpm@10.33.0 --filter @buildline/ipad build >/dev/null || { echo "Build failed."; read -n 1 -s -r -p "Press any key to close."; exit 1; }
echo "Starting Buildline at http://localhost:4000 (demo data included)."
echo "Sign in with owner@demo.buildline.app / demo-password-123"
echo "On an iPad on the same Wi-Fi, open http://$(hostname -I 2>/dev/null | cut -d" " -f1 || hostname):4000"
echo "Leave this window open while you test. Close it to stop."
( sleep 6; (xdg-open "http://localhost:4000" 2>/dev/null || true) ) &
npx --yes pnpm@10.33.0 --filter @buildline/api demo
