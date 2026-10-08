#!/usr/bin/env bash
# Emora — one-command setup for macOS and Linux.
#
#   ./setup.sh               install everything, then start backend + frontend
#   ./setup.sh --no-start    install only
#
# On a fresh machine this installs, in order:
#   1. System tools: Python 3.12, Node.js, ffmpeg (Homebrew on macOS, apt on
#      Debian/Ubuntu). Homebrew itself is installed if missing — it asks for
#      your password once.
#   2. Python packages into ./venv (torch, TensorFlow, DeepFace, Whisper, …).
#      About 3 GB; the first run takes 10-20 minutes on a normal connection.
#   3. Frontend packages, and a production build of the UI.
#   4. A .env with a freshly generated SECRET_KEY.
#
# Safe to re-run: every step skips what is already done.
# The AI models themselves (~5 GB) download automatically the first time each
# feature is used, so the first face login and first voice turn are slow.

set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"

START=1
for arg in "$@"; do
  case "$arg" in
    --no-start) START=0 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
  esac
done

bold()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
info()  { printf '    %s\n' "$*"; }
warn()  { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()   { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

OS="$(uname -s)"

# ── 1. System prerequisites ───────────────────────────────────────────────────
bold "Checking system prerequisites"

if [ "$OS" = "Darwin" ]; then
  if ! command -v brew >/dev/null 2>&1; then
    info "Installing Homebrew (asks for your password)..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi
  # Apple Silicon and Intel keep brew in different places.
  if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
  if [ -x /usr/local/bin/brew ]; then eval "$(/usr/local/bin/brew shellenv)"; fi

  NEED=()
  command -v python3.12 >/dev/null 2>&1 || NEED+=(python@3.12)
  command -v node >/dev/null 2>&1       || NEED+=(node)
  command -v ffmpeg >/dev/null 2>&1     || NEED+=(ffmpeg)
  if [ ${#NEED[@]} -gt 0 ]; then
    info "brew install ${NEED[*]}"
    brew install "${NEED[@]}"
  fi
elif [ "$OS" = "Linux" ]; then
  if command -v apt-get >/dev/null 2>&1; then
    PKGS=(ffmpeg nodejs npm libgl1 libglib2.0-0 libportaudio2)
    # Ubuntu 24.04 ships 3.12; older releases need the deadsnakes PPA.
    if ! command -v python3.12 >/dev/null 2>&1; then
      if ! apt-cache show python3.12 >/dev/null 2>&1; then
        sudo apt-get update
        sudo apt-get install -y software-properties-common
        sudo add-apt-repository -y ppa:deadsnakes/ppa
      fi
      PKGS+=(python3.12 python3.12-venv python3.12-dev)
    fi
    info "sudo apt-get install ${PKGS[*]}"
    sudo apt-get update
    sudo apt-get install -y "${PKGS[@]}"
  else
    warn "Not a Debian/Ubuntu system: install Python 3.12, Node.js 20+ and ffmpeg yourself, then re-run."
  fi
else
  die "Unsupported OS '$OS'. On Windows, run setup.bat (or setup.ps1) instead."
fi

# TensorFlow 2.16 has no wheels past Python 3.12, so a newer Python can't be used.
PYTHON=""
for candidate in python3.12 python3.11 python3.10; do
  if command -v "$candidate" >/dev/null 2>&1; then PYTHON="$candidate"; break; fi
done
[ -n "$PYTHON" ] || die "Python 3.10-3.12 not found (TensorFlow does not support newer versions)."
command -v node >/dev/null 2>&1   || die "Node.js not found."
command -v ffmpeg >/dev/null 2>&1 || die "ffmpeg not found (speech-to-text needs it)."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20+ required (found $(node -v))."

info "Python : $($PYTHON --version)"
info "Node   : $(node -v)"
info "ffmpeg : $(ffmpeg -version | head -1 | cut -d' ' -f1-3)"

# ── 2. Python environment ─────────────────────────────────────────────────────
bold "Python packages (first run: ~3 GB, 10-20 minutes)"

if [ -d venv ] && ! venv/bin/python -c 'import sys; sys.exit(0 if sys.version_info[:2] <= (3, 12) else 1)' 2>/dev/null; then
  warn "Existing venv uses an unsupported Python — recreating it."
  rm -rf venv
fi
if [ ! -d venv ]; then
  "$PYTHON" -m venv venv
fi
# shellcheck disable=SC1091
source venv/bin/activate
python -m pip install --upgrade pip wheel >/dev/null
python -m pip install -r requirements.txt

# ── 3. Configuration ──────────────────────────────────────────────────────────
bold "Configuration"

mkdir -p data/memories
if [ ! -f .env ]; then
  cp .env.example .env
  info "Created .env from .env.example"
fi
# A default SECRET_KEY lets anyone forge a login, so never leave the placeholder.
if grep -qE '^SECRET_KEY=(change-me.*|dev-secret.*)?$' .env; then
  KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
  python - "$KEY" <<'PY'
import pathlib, re, sys
p = pathlib.Path('.env')
p.write_text(re.sub(r'(?m)^SECRET_KEY=.*$', 'SECRET_KEY=' + sys.argv[1], p.read_text()))
PY
  info "Generated a random SECRET_KEY"
fi

# ── 4. Frontend ───────────────────────────────────────────────────────────────
bold "Frontend packages and UI build"

cd "$ROOT/emora-frontend"
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
npm run build
cd "$ROOT"

# ── 5. Smoke test ─────────────────────────────────────────────────────────────
bold "Checking the install"

python - <<'PY'
import importlib
for mod in ("fastapi", "deepface", "tensorflow", "torch", "transformers", "whisper", "nano_parakeet", "edge_tts", "cv2"):
    importlib.import_module(mod)
from backend.app.main import app  # noqa: F401  (imports every router)
print("    backend imports OK")
PY
[ -f emora-frontend/dist/index.html ] && info "UI build OK"

bold "Setup complete"
cat <<EOF

    Start Emora any time with:   ./start.sh
    Then open:                   http://localhost:5173

    Chat needs one AI provider key — add it in the app: Settings → AI Providers
    (or set LLM_API_KEY in .env). Everything else works without a key.

EOF

if [ "$START" = "1" ]; then
  exec ./start.sh
fi
