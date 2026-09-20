#!/bin/sh
set -eu

echo "[BalticM POT Test] starting BgUtils HTTP provider on localhost:4416..."
node /opt/bgutil/server/build/main.js >/tmp/bgutil.log 2>&1 &
BGUTIL_PID=$!

i=0
until curl -fsS http://127.0.0.1:4416/ping >/dev/null 2>&1; do
  i=$((i+1))
  if [ "$i" -ge 30 ]; then
    echo "[BalticM POT Test] provider failed to start"
    cat /tmp/bgutil.log || true
    exit 1
  fi
  sleep 1
done

echo "[BalticM POT Test] BgUtils provider READY (pid $BGUTIL_PID)"
echo "[BalticM POT Test] starting HTTP test service on $PORT..."
exec python3 /app/server.py
