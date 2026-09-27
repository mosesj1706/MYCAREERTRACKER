#!/usr/bin/env bash
# Launch the app in the browser. Run from anywhere: ./run.sh
# Dev mode with hot reload: ./run.sh dev   (API on :8765, UI on :5173)
# Occupational therapy version: ./run.sh ot  (or ./run.sh ot dev) - its own data in data_ot/, API on :8766
cd "$(dirname "$0")"
source venv/bin/activate
PORT=8765
if [ "$1" = "ot" ]; then
  export MCT_PROFESSION=ot MCT_DATA_DIR="$PWD/data_ot"
  mkdir -p "$MCT_DATA_DIR"
  PORT=8766
  shift
fi
if [ "$1" = "dev" ]; then
  PYTHONPATH=. uvicorn app.server:app --port "$PORT" --reload &
  (cd frontend && MCT_API_PORT="$PORT" npx vite --port 5173)
else
  [ -d frontend/dist ] || (cd frontend && npm install && npm run build)
  PYTHONPATH=. uvicorn app.server:app --port "$PORT" &
  sleep 1; open "http://127.0.0.1:$PORT"
  wait
fi
