#!/usr/bin/env bash
cd "$(dirname "$0")/backend" || exit 1
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 app.py
