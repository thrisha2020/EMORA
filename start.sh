#!/usr/bin/env bash
# Start Emora: backend on :8000 and frontend on :5173. Ctrl-C stops both.
#
#   ./start.sh            local only (recommended)
#   ./start.sh --lan      also reachable from your phone on the same Wi-Fi
#
# --lan binds the backend to 0.0.0.0, which exposes it to everyone on that
# network (and /register needs no login). Use it only on a trusted Wi-Fi.

set -euo pipefail
cd "$(dirname "$0")"

[ -d venv ] || { echo "venv missing — run ./setup.sh first"; exit 1; }
[ -d emora-frontend/node_modules ] || { echo "frontend packages missing — run ./setup.sh first"; exit 1; }

HOST=127.0.0.1
[ "${1:-}" = "--lan" ] && HOST=0.0.0.0

# .env decides (EMORA_WARMUP=1 preloads models, 0 loads them on first use). If it
# doesn't say, load lazily: preloading pins 2-3 GB, which gets the servers killed
# on an 8-16 GB machine that is also running a browser.
grep -q '^EMORA_WARMUP=' .env 2>/dev/null || export EMORA_WARMUP="${EMORA_WARMUP:-0}"

for port in 8000 5173; do
  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use — is Emora already running? Stop it first."
    exit 1
  fi
done

venv/bin/uvicorn backend.app.main:app --host "$HOST" --port 8000 &
BACKEND=$!
( cd emora-frontend && exec npm run dev ) &
FRONTEND=$!

cleanup() {
  echo
  echo "Stopping Emora..."
  kill "$BACKEND" "$FRONTEND" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Wait for the backend so the first page load doesn't show "offline".
for _ in $(seq 60); do
  curl -s -o /dev/null http://127.0.0.1:8000/api/health && break
  sleep 1
done

echo
echo "  Emora is running"
echo "    App      http://localhost:5173"
echo "    Backend  http://127.0.0.1:8000"
if [ "$HOST" = "0.0.0.0" ]; then
  IP="$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
  echo "    Phone    backend reachable at http://${IP}:8000 (trusted Wi-Fi only)"
fi
echo "  Press Ctrl-C to stop."
echo

wait
