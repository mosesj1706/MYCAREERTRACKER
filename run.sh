#!/usr/bin/env bash
# Launch the app in the browser. Run from anywhere: ./run.sh
# Dev mode with hot reload: ./run.sh dev   (API on :8765, UI on :5173)
cd "$(dirname "$0")"
source venv/bin/activate
if [ "$1" = "dev" ]; then
  PYTHONPATH=. uvicorn app.server:app --port 8765 --reload &
  (cd frontend && npx vite --port 5173)
else
  [ -d frontend/dist ] || (cd frontend && npm install && npm run build)
  PYTHONPATH=. uvicorn app.server:app --port 8765 &
  sleep 1; open http://127.0.0.1:8765
  wait
fi
