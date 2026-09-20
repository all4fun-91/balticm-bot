#!/bin/sh
set -eu

echo "[BalticM] starting Lavalink internally on :2333..."
java -jar /opt/Lavalink/Lavalink.jar &
LL_PID=$!

echo "[BalticM] waiting for Lavalink..."
i=0
while [ "$i" -lt 90 ]; do
  if (echo >/dev/tcp/127.0.0.1/2333) >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$LL_PID" 2>/dev/null; then
    echo "[BalticM] Lavalink exited during startup"
    wait "$LL_PID"
    exit $?
  fi
  i=$((i+1))
  sleep 1
done

echo "[BalticM] starting safe browser test proxy..."
exec /opt/Lavalink/lavalink-test-proxy
