#!/usr/bin/env bash
# Build a clean zip of Emora to send to another machine.
#
#   scripts/package_release.sh            -> ../emora-release.zip
#   scripts/package_release.sh out.zip
#
# Leaves out everything that is machine-specific, rebuildable, or private:
#   venv/, node_modules/    platform-specific and ~3.5 GB; setup rebuilds them
#   data/, .env*            YOUR database, face embeddings, memories, API keys
#   build outputs           dist/, src-tauri/target, android builds
# The receiver unzips and runs ./setup.sh (macOS/Linux) or setup.bat (Windows).

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
OUT="${1:-$ROOT/../emora-release.zip}"
case "$OUT" in /*) ;; *) OUT="$ROOT/$OUT" ;; esac

rm -f "$OUT"
NAME="$(basename "$ROOT")"
cd ..
zip -rq "$OUT" "$NAME" \
  -x "$NAME/venv/*" "$NAME/.venv/*" \
  -x "*/node_modules/*" \
  -x "$NAME/data/*" \
  -x "$NAME/.env" "$NAME/.env.bak*" "$NAME/.env.local" \
  -x "$NAME/emora-frontend/dist/*" \
  -x "$NAME/emora-frontend/src-tauri/target/*" \
  -x "$NAME/emora-frontend/android/build/*" "$NAME/emora-frontend/android/app/build/*" \
  -x "$NAME/emora-frontend/android/.gradle/*" "$NAME/emora-frontend/android/local.properties" \
  -x "$NAME/emora-frontend/android/app/src/main/assets/public/*" \
  -x "$NAME/assets/models/*.blend" "$NAME/assets/models/*.blend1" \
  -x "*/__pycache__/*" "*.pyc" "*/.pytest_cache/*" "*/.DS_Store" \
  -x "$NAME/.claude/*" "$NAME/.agents/*" "$NAME/.bob/*" "$NAME/.opencode/*" \
  -x "$NAME/.streamlit/*" "$NAME/evaluation/data/*.wav" \
  -x "$NAME/test.mp3" "$NAME/tts.mp3"

# Refuse to ship anything that looks like a secret or personal data.
LEAKS="$(unzip -Z1 "$OUT" | grep -E "(/\.env$|^$NAME/data/|emotion_assistant\.db$|/memories_?[0-9]*\.json$)" || true)"
if [ -n "$LEAKS" ]; then
  echo "Refusing: the zip would contain .env or personal data:" >&2
  echo "$LEAKS" | sed 's/^/  /' >&2
  rm -f "$OUT"
  exit 1
fi

SIZE="$(du -h "$OUT" | cut -f1)"
echo "Created $OUT ($SIZE)"
echo "On the new machine: unzip, cd into $NAME, then run ./setup.sh (macOS/Linux) or setup.bat (Windows)."
