#!/bin/sh
set -eu

echo "[BalticM POT Test] starting bgutil provider..."
python -m bgutil_ytdlp_pot_provider >/tmp/bgutil.log 2>&1 &
sleep 3

echo "[BalticM POT Test] starting HTTP test service on $PORT..."
python /app/server.py
