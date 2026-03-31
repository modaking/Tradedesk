#!/usr/bin/env bash
# ==============================================================================
# TradeDesk — Linux / macOS Install & Build Script
# ==============================================================================
# Usage:
#   chmod +x build.sh
#   ./build.sh
#
# What this script does:
#   1. Checks for Python 3.9+
#   2. Creates a virtual environment in .venv/
#   3. Installs all pip dependencies
#   4. Downloads Chart.js locally (offline requirement)
#   5. Creates __init__.py files
#   6. Builds executable with PyInstaller
# ==============================================================================

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()     { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

echo ""
echo "  ████████╗██████╗  █████╗ ██████╗ ███████╗██████╗ ███████╗███████╗██╗  ██╗"
echo "  ╚══██╔══╝██╔══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗██╔════╝██╔════╝██║ ██╔╝"
echo "     ██║   ██████╔╝███████║██║  ██║█████╗  ██║  ██║█████╗  ███████╗█████╔╝ "
echo "     ██║   ██╔══██╗██╔══██║██║  ██║██╔══╝  ██║  ██║██╔══╝  ╚════██║██╔═██╗ "
echo "     ██║   ██║  ██║██║  ██║██████╔╝███████╗██████╔╝███████╗███████║██║  ██╗ "
echo "     ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝"
echo ""
echo "                   Sales & Inventory Dashboard — Build Script"
echo "  ──────────────────────────────────────────────────────────────────────────"
echo ""

# ── Check Python ──────────────────────────────────────────────────────────────
PYTHON=""
for cmd in python3 python; do
    if command -v "$cmd" &>/dev/null; then
        VER=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
        MAJOR=$(echo "$VER" | cut -d. -f1)
        MINOR=$(echo "$VER" | cut -d. -f2)
        if [ "$MAJOR" -ge 3 ] && [ "$MINOR" -ge 9 ]; then
            PYTHON="$cmd"
            break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    err "Python 3.9+ not found. Please install it and re-run."
fi
info "Python: $($PYTHON --version)"

# ── Virtual environment ───────────────────────────────────────────────────────
if [ ! -d ".venv" ]; then
    info "Creating virtual environment..."
    $PYTHON -m venv .venv
    ok "Virtual environment created."
else
    info "Virtual environment already exists."
fi

# Activate
# shellcheck disable=SC1091
source .venv/bin/activate

# ── Install dependencies ──────────────────────────────────────────────────────
info "Upgrading pip..."
pip install --upgrade pip --quiet

info "Installing Python packages from requirements.txt..."
pip install -r requirements.txt --quiet
ok "Packages installed."

# ── Download Chart.js locally ─────────────────────────────────────────────────
CHARTJS_DIR="frontend/static/libs"
CHARTJS_FILE="$CHARTJS_DIR/chart.umd.min.js"
mkdir -p "$CHARTJS_DIR"

if [ ! -f "$CHARTJS_FILE" ]; then
    info "Downloading Chart.js 4.4 for offline use..."
    if command -v curl &>/dev/null; then
        curl -fsSL "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js" \
             -o "$CHARTJS_FILE" && ok "Chart.js downloaded." \
          || warn "Download failed — copy chart.umd.min.js manually to $CHARTJS_DIR/"
    elif command -v wget &>/dev/null; then
        wget -q "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js" \
             -O "$CHARTJS_FILE" && ok "Chart.js downloaded." \
          || warn "Download failed — copy chart.umd.min.js manually to $CHARTJS_DIR/"
    else
        warn "Neither curl nor wget found. Copy chart.umd.min.js to $CHARTJS_DIR/ manually."
    fi
else
    info "Chart.js already present."
fi

# ── Create __init__.py files ──────────────────────────────────────────────────
touch backend/__init__.py
touch backend/routes/__init__.py
touch backend/models/__init__.py
touch backend/services/__init__.py
mkdir -p database logs .sessions .uploads
ok "__init__ files and directories ready."

# ── Build with PyInstaller ────────────────────────────────────────────────────
echo ""
info "Building executable with PyInstaller..."

PLATFORM=$(uname -s)
ICON_ARG=""

if [ "$PLATFORM" = "Darwin" ] && [ -f "tradedesk.icns" ]; then
    ICON_ARG="--icon=tradedesk.icns"
elif [ "$PLATFORM" = "Linux" ] && [ -f "tradedesk.png" ]; then
    ICON_ARG="--icon=tradedesk.png"
fi

pyinstaller \
    --onefile \
    --windowed \
    --name "TradeDesk" \
    $ICON_ARG \
    --add-data "frontend:frontend" \
    --add-data "backend:backend" \
    --hidden-import flask_session \
    --hidden-import bcrypt \
    --hidden-import pandas \
    --hidden-import openpyxl \
    --hidden-import xlrd \
    --hidden-import webview \
    run.py

echo ""
echo "  ──────────────────────────────────────────────────────────────────────────"
ok "Build complete!"
echo ""
echo "  Executable:   dist/TradeDesk"
if [ "$PLATFORM" = "Darwin" ]; then
    echo "  macOS app:    dist/TradeDesk.app  (if spec used)"
fi
echo ""
echo "  Run:          ./dist/TradeDesk"
echo "  Or dev mode:  python run.py"
echo "  ──────────────────────────────────────────────────────────────────────────"
echo ""
