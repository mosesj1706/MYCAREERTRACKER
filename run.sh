#!/usr/bin/env bash
# Launch the app. Run from anywhere: ./run.sh
cd "$(dirname "$0")"
source venv/bin/activate
PYTHONPATH=. streamlit run app/ui/dashboard.py
