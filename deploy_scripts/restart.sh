#!/bin/bash
# ══════════════════════════════════════════════════════════════
#  Restart addonu po aktualizacji kodu (git fetch + rebase)
#  Użycie: ./restart.sh
# ══════════════════════════════════════════════════════════════

set -e

VENV_DIR="${HOME}/venv"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PARENT_DIR="$(cd "$PROJECT_DIR/.." && pwd)"
SERVICE_NAME="animesub"

echo "══════════════════════════════════════════════════"
echo "  Restart $SERVICE_NAME"
echo "══════════════════════════════════════════════════"

# Zainstaluj nowe zależności jeśli requirements.txt się zmienił
echo "[1/3] Sprawdzam zależności..."
source "$VENV_DIR/bin/activate"
pip install -q -r "$PARENT_DIR/requirements.txt"
deactivate

# Restart usługi
echo "[2/3] Restartuję usługę..."
sudo systemctl daemon-reload
sudo systemctl restart "$SERVICE_NAME"

# Weryfikacja
echo "[3/3] Sprawdzam..."
sleep 2

if sudo systemctl is-active --quiet "$SERVICE_NAME"; then
    echo ""
    echo "  ✓ $SERVICE_NAME działa"
    echo "  Logi: sudo journalctl status $SERVICE_NAME --no-pager -n 0"
    echo "  Logi: sudo journalctl -u $SERVICE_NAME -f"
    echo "  Logi: sudo journalctl -u $SERVICE_NAME --no-pager -n 20"
else
    echo ""
    echo "  ✗ Usługa nie działa! Sprawdź logi:"
    sudo journalctl -u $SERVICE_NAME --no-pager
fi