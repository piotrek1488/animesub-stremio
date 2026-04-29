#!/bin/bash
# ══════════════════════════════════════════════════════════════
#  Pierwszy deploy na Oracle Cloud VM
#  Użycie: chmod +x deploy.sh && ./deploy.sh
# ══════════════════════════════════════════════════════════════

set -e

# ── Konfiguracja ──────────────────────────────────────────────
# Zmień te zmienne przed uruchomieniem!

DOMAIN="animesub-stremio-addon.duckdns.org"   # twoja subdomena DuckDNS
PORT=8080                                      # port addonu
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"   # katalog w którym leży ten skrypt
PARENT_DIR="$(cd "$PROJECT_DIR/.." && pwd)"    # katalog główny projektu (tam gdzie main.py)
VENV_DIR="${HOME}/venv"                   # ścieżka do virtualenv
SERVICE_NAME="animesub"                        # nazwa usługi systemd

# ══════════════════════════════════════════════════════════════

echo "══════════════════════════════════════════════════"
echo "  AnimeSub.info Stremio Addon — deploy"
echo "══════════════════════════════════════════════════"
echo ""
echo "  Domena:   $DOMAIN"
echo "  Port:     $PORT"
echo "  Projekt:  $PARENT_DIR"
echo ""

# ── 1. Aktualizacja systemu ───────────────────────────────────
echo "[1/7] Aktualizacja systemu..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3 python3-pip python3-venv caddy iptables-persistent git gh net-tools

# ── 2. Virtualenv + zależności ────────────────────────────────
echo "[2/7] Instalacja zależności Python..."
if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"
pip install -r "$PARENT_DIR/requirements.txt"
deactivate

# ── 3. Firewall (iptables) ────────────────────────────────────
echo "[3/7] Konfiguracja firewall..."

open_port() {
    local port=$1
    if ! sudo iptables -L INPUT -n | grep -q "dpt:$port"; then
        # Wstaw PRZED regułą REJECT
        REJECT_LINE=$(sudo iptables -L INPUT -n --line-numbers | grep REJECT | head -1 | awk '{print $1}')
        if [ -n "$REJECT_LINE" ]; then
            sudo iptables -I INPUT "$REJECT_LINE" -m state --state NEW -p tcp --dport "$port" -j ACCEPT
        else
            sudo iptables -A INPUT -m state --state NEW -p tcp --dport "$port" -j ACCEPT
        fi
        echo "  ✓ Otwarto port $port"
    else
        echo "  ✓ Port $port już otwarty"
    fi
}

open_port 80
open_port 443
open_port "$PORT"
sudo netfilter-persistent save 2>/dev/null || true

echo ""
echo "  ╔═══════════════════════════════════════════════════════╗"
echo "  ║  PAMIĘTAJ: Otwórz porty 80, 443 i $PORT w Oracle   ║"
echo "  ║  Security List (Networking → VCN → Public Subnet    ║"
echo "  ║  → Default Security List → Add Ingress Rules)       ║"
echo "  ╚═══════════════════════════════════════════════════════╝"
echo ""

# ── 4. Usługa systemd ────────────────────────────────────────
echo "[4/7] Tworzenie usługi systemd..."

sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null <<EOF
[Unit]
Description=AnimeSub.info Stremio Addon
After=network.target

[Service]
Type=simple
#User="${USER}"
WorkingDirectory=${PARENT_DIR}
Environment=BASE_URL=https://${DOMAIN}
ExecStart=${VENV_DIR}/bin/uvicorn main:app --host 0.0.0.0 --port ${PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl start "$SERVICE_NAME"
echo "  ✓ Usługa $SERVICE_NAME uruchomiona"

# ── 5. Caddy (HTTPS) ─────────────────────────────────────────
echo "[5/7] Konfiguracja Caddy (HTTPS)..."

sudo tee /etc/caddy/Caddyfile > /dev/null <<EOF
${DOMAIN} {
    reverse_proxy localhost:${PORT}
}
EOF

sudo systemctl restart caddy
sudo systemctl enable caddy
echo "  ✓ Caddy skonfigurowany dla $DOMAIN"

# ── 6. Cron job (zapobiega wyłączeniu VM przez Oracle) ────────
echo "[6/7] Dodawanie cron joba (keep-alive)..."

CRON_CMD='*/10 * * * * dd if=/dev/urandom bs=1k count=1 2>/dev/null | md5sum > /dev/null 2>&1'
if ! crontab -l 2>/dev/null | grep -q "md5sum"; then
    (crontab -l 2>/dev/null; echo "$CRON_CMD") | crontab -
    echo "  ✓ Cron job dodany"
else
    echo "  ✓ Cron job już istnieje"
fi

# ── 7. Weryfikacja ────────────────────────────────────────────
echo "[7/7] Sprawdzam..."
sleep 2

if curl -s "http://localhost:${PORT}/manifest.json" | grep -q "animesub"; then
    echo ""
    echo "══════════════════════════════════════════════════"
    echo "  ✓ DEPLOY ZAKOŃCZONY POMYŚLNIE"
    echo ""
    echo "  Manifest:  https://${DOMAIN}/manifest.json"
    echo "  Status:    sudo systemctl status $SERVICE_NAME"
    echo "  Logi:      sudo journalctl -u $SERVICE_NAME -f"
    echo ""
    echo "  Wklej w Stremio (Addons → URL):"
    echo "  https://${DOMAIN}/manifest.json"
    echo "══════════════════════════════════════════════════"
else
    echo ""
    echo "  ✗ Coś poszło nie tak. Sprawdź logi:"
    echo "  sudo journalctl -u $SERVICE_NAME -f"
fi
