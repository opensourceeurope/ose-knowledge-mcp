#!/usr/bin/env bash
# Stop a local stack started by scripts/run-local.sh:
#   MCP :8000, chat function :8080, chat UI :8090
#   (override the ports via MCP_PORT / FUNC_PORT / CHAT_PORT to match run-local).
#
# Finds processes by port AND by signature (so it still works if run-local
# auto-bumped a busy port), then escalates SIGTERM -> SIGKILL. Only targets this
# project's processes. Useful when run-local was detached and Ctrl-C isn't an option.
#
# Usage: ./scripts/stop-local.sh
set -uo pipefail

PORTS=("${MCP_PORT:-8000}" "${FUNC_PORT:-8080}" "${CHAT_PORT:-8090}")
SIGS=('opencrane serve' 'tsx .*server.ts' 'http.server.*chat-site')

collect() { # unique PIDs from the ports + the known signatures
  {
    for p in "${PORTS[@]}"; do lsof -ti "tcp:$p" 2>/dev/null || true; done
    for s in "${SIGS[@]}"; do pgrep -f "$s" 2>/dev/null || true; done
  } | sort -u
}

pids="$(collect)"
if [ -z "$pids" ]; then
  echo "Nothing running on the local-stack ports/signatures."
  exit 0
fi

echo "==> Stopping (SIGTERM): $(echo "$pids" | tr '\n' ' ')"
echo "$pids" | xargs kill 2>/dev/null || true
sleep 1

pids="$(collect)"
if [ -n "$pids" ]; then
  echo "==> Still alive, forcing (SIGKILL): $(echo "$pids" | tr '\n' ' ')"
  echo "$pids" | xargs kill -9 2>/dev/null || true
  sleep 1
fi

left="$(collect)"
if [ -z "$left" ]; then
  echo "Stopped — MCP/function/chat ports are free."
else
  echo "WARNING: still running: $(echo "$left" | tr '\n' ' ')" >&2
  exit 1
fi
