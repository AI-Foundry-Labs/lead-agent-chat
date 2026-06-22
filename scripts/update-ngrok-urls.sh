#!/usr/bin/env bash
# Usage: ./scripts/update-ngrok-urls.sh
# Queries the local ngrok API and updates APP_BASE_URL + NEXT_PUBLIC_BASE_URL
# in all three .env files (main, qc1, qc2).
set -euo pipefail

NGROK_API="http://127.0.0.1:4040/api/tunnels"
QC1_DIR="/mnt/dunghd/worktrees/lead-agent-chat-qc1"
QC2_DIR="/mnt/dunghd/worktrees/lead-agent-chat-qc2"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Fetching ngrok tunnels..."
TUNNELS=$(curl -sf "$NGROK_API") || { echo "ERROR: ngrok API not reachable at $NGROK_API"; exit 1; }

get_url() {
  local name="$1"
  echo "$TUNNELS" | python3 -c "
import sys, json
t = json.load(sys.stdin)['tunnels']
for x in t:
    if x['name'] == '$name':
        print(x['public_url'])
        break
"
}

MAIN_URL=$(get_url "main")
QC1_URL=$(get_url "fr-qc1")
QC2_URL=$(get_url "fr-qc2")

update_env() {
  local file="$1"
  local url="$2"
  sed -i "s|NEXT_PUBLIC_BASE_URL=.*|NEXT_PUBLIC_BASE_URL=$url|" "$file"
  sed -i "s|APP_BASE_URL=.*|APP_BASE_URL=$url|" "$file"
}

if [ -n "$MAIN_URL" ]; then
  update_env "$SCRIPT_DIR/.env" "$MAIN_URL"
  echo "✓ main  → $MAIN_URL"
else
  echo "  main: tunnel not found"
fi

if [ -n "$QC1_URL" ] && [ -d "$QC1_DIR" ]; then
  update_env "$QC1_DIR/.env" "$QC1_URL"
  echo "✓ fr-qc1 → $QC1_URL"
fi

if [ -n "$QC2_URL" ] && [ -d "$QC2_DIR" ]; then
  update_env "$QC2_DIR/.env" "$QC2_URL"
  echo "✓ fr-qc2 → $QC2_URL"
fi

echo ""
echo "Restart containers to apply:"
echo "  docker restart lead-agent-chat-app-1 lead-agent-chat-qc1-app-1 lead-agent-chat-qc2-app-1"
