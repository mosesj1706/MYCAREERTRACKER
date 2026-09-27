#!/usr/bin/env bash
# Build the frontend on this Mac, copy the app to the Lightsail server, and restart it.
#   deploy/push.sh ubuntu@<static-ip>
# SSH key: ~/.ssh/lightsail-mumbai.pem, or set MCT_SSH_KEY. First time, see deploy/README.md.
set -euo pipefail

HOST="${1:?usage: deploy/push.sh ubuntu@<static-ip>}"
KEY="${MCT_SSH_KEY:-$HOME/.ssh/lightsail-mumbai.pem}"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new"
cd "$(dirname "$0")/.."

(cd frontend && npm run build)
$SSH "$HOST" 'command -v rsync >/dev/null || sudo apt-get install -y rsync; sudo install -d -o "$(id -un)" -g "$(id -gn)" /opt/mct'
# Personal data, secrets and the Mac-only bits stay here; .env and venv/ on the server are never touched.
rsync -az --delete -e "$SSH" \
  --exclude /.git/ --exclude /.env --exclude /venv/ --exclude /data/ --exclude /frontend/node_modules/ \
  --exclude /.playwright-mcp/ --exclude /packaging/ --exclude /linkedin-banner.png --exclude __pycache__/ \
  ./ "$HOST:/opt/mct/"

if $SSH "$HOST" 'test -x /opt/mct/venv/bin/python'; then
  $SSH "$HOST" 'sudo UV_PYTHON_INSTALL_DIR=/opt/uv-python uv pip install -q --python /opt/mct/venv/bin/python -r /opt/mct/requirements.txt && sudo systemctl restart mct && sleep 2 && systemctl is-active mct'
else
  echo "Code copied. First time: create /opt/mct/.env, then run: sudo /opt/mct/deploy/setup.sh <domain>"
fi
