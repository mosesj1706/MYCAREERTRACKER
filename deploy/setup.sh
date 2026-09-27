#!/usr/bin/env bash
# One-time setup of a fresh Lightsail Ubuntu 24.04 server, run there after the first push:
#   sudo /opt/mct/deploy/setup.sh tracker.example.com
# Safe to re-run. Installs Caddy (HTTPS) and Python 3.14 (via uv), creates the mct user and the
# data directory, and starts the app as a systemd service behind Caddy.
set -euo pipefail

DOMAIN="${1:?usage: sudo deploy/setup.sh <domain>}"
APP=/opt/mct
DATA=/var/lib/mct
[ "$(id -u)" = 0 ] || { echo "Run with sudo."; exit 1; }
[ -f "$APP/.env" ] || { echo "Create $APP/.env first (ANTHROPIC_API_KEY and MCT_PASSWORD, see deploy/README.md)."; exit 1; }

# Swap: 1 GB of RAM runs the app comfortably but can run short while installing packages.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Caddy from its official apt repository.
if ! command -v caddy >/dev/null; then
  apt-get update
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

# Python 3.14 (what the app is developed on) without touching the system Python. The interpreter goes
# under /opt, not /root, so the mct user can run it.
export UV_PYTHON_INSTALL_DIR=/opt/uv-python
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh
[ -x "$APP/venv/bin/python" ] || uv venv --python 3.14 "$APP/venv"
uv pip install --python "$APP/venv/bin/python" -r "$APP/requirements.txt"

# Service user; the data directory (profile, database, documents) is readable by mct only.
id mct >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin mct
install -d -o mct -g mct -m 700 "$DATA"
chown root:mct "$APP/.env"
chmod 640 "$APP/.env"

install -m 644 "$APP/deploy/mct.service" /etc/systemd/system/mct.service
sed "s/{DOMAIN}/$DOMAIN/" "$APP/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable mct
systemctl restart mct
systemctl reload-or-restart caddy

sleep 2
systemctl is-active --quiet mct || { journalctl -u mct -n 30 --no-pager; exit 1; }
echo "Running. Open https://$DOMAIN (the first visit can take a minute while Caddy gets the certificate)."
