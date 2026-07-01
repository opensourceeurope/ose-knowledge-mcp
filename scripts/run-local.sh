#!/usr/bin/env bash
# Run the full OSE chat stack locally with one command:
#   - OpenCrane MCP server        :8000  (Milvus Lite, auto-indexes)
#   - chat function (agent loop)  :8080
#   - static chat UI              :8090
#
# Offline by default: the function talks to a local Ollama instead of Mistral
# La Plateforme. Values in function/.env (if present) take precedence.
#
# Ports default to 8000/8080/8090 but are picked dynamically: if a preferred
# port is busy, the next free one is used (override preference via
# MCP_PORT / FUNC_PORT / CHAT_PORT). The chat UI config is generated to match.
#
# Usage: ./scripts/run-local.sh                                # offline via Ollama
#        OLLAMA_MODEL=llama3.1:8b ./scripts/run-local.sh       # different local model
#        ./scripts/run-local.sh --hosted                       # real Mistral API
#                                                              # (needs MISTRAL_API_KEY)
#        ./scripts/run-local.sh --fresh                         # re-embed from scratch
#                                                              # (drop the cached index first)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
OLLAMA_MODEL="${OLLAMA_MODEL:-mistral-small3.2}"
MODE="offline"
FRESH=0
for arg in "$@"; do
  case "$arg" in
    --hosted) MODE="--hosted" ;;
    --fresh)  FRESH=1 ;;
    *) echo "ERROR: unknown argument '$arg' (expected --hosted and/or --fresh)." >&2; exit 1 ;;
  esac
done
LOG_DIR="${TMPDIR:-/tmp}/ose-local-logs"
mkdir -p "$LOG_DIR"

need() {
  command -v "$1" >/dev/null 2>&1 && return 0
  echo "ERROR: '$1' not found. Install it:" >&2
  case "$1" in
    uvx)     echo "  uv:     brew install uv      |  curl -LsSf https://astral.sh/uv/install.sh | sh" >&2 ;;
    ollama)  echo "  Ollama: brew install ollama  |  https://ollama.com/download" >&2 ;;
    npm)     echo "  Node:   brew install node    |  https://nodejs.org" >&2 ;;
    python3) echo "  Python: brew install python  |  https://www.python.org/downloads/" >&2 ;;
    curl)    echo "  curl:   brew install curl    |  (usually preinstalled)" >&2 ;;
    *)       echo "  (see the tool's documentation for install instructions)" >&2 ;;
  esac
  exit 1
}
need uvx; need npm; need python3; need curl

port_free() {
  python3 - "$1" <<'PY'
import socket, sys
s = socket.socket()
s.settimeout(0.3)
busy = s.connect_ex(("127.0.0.1", int(sys.argv[1]))) == 0
s.close()
sys.exit(1 if busy else 0)
PY
}
pick_port() { # $1 = preferred port — echoes the first free port from there up
  local p="$1"
  until port_free "$p"; do p=$((p + 1)); done
  if [ "$p" != "$1" ]; then echo "    (port $1 busy -> using $p)" >&2; fi
  echo "$p"
}
MCP_PORT="$(pick_port "${MCP_PORT:-8000}")"
FUNC_PORT="$(pick_port "${FUNC_PORT:-8080}")"
CHAT_PORT="$(pick_port "${CHAT_PORT:-8090}")"

# --- function env: function/.env wins, then mode defaults -------------------
if [ -f function/.env ]; then
  set -a; . function/.env; set +a
fi
export OSE_MCP_URL="http://localhost:$MCP_PORT/mcp"   # always the local MCP

if [ "$MODE" = "--hosted" ]; then
  [ -n "${MISTRAL_API_KEY:-}" ] || { echo "ERROR: --hosted needs MISTRAL_API_KEY (env or function/.env)." >&2; exit 1; }
else
  export MISTRAL_BASE_URL="${MISTRAL_BASE_URL:-$OLLAMA_URL}"
  export MISTRAL_MODEL="${MISTRAL_MODEL:-$OLLAMA_MODEL}"
  export MISTRAL_API_KEY="${MISTRAL_API_KEY:-ollama}"
  need ollama
  curl -s -o /dev/null --max-time 2 "$MISTRAL_BASE_URL" \
    || { echo "ERROR: no Ollama at $MISTRAL_BASE_URL — run 'ollama serve' (or open the app)." >&2; exit 1; }
  ollama list | awk '{print $1}' | grep -q "^${MISTRAL_MODEL}" \
    || { echo "ERROR: model '$MISTRAL_MODEL' not pulled — run 'ollama pull $MISTRAL_MODEL' (or wait for the pull to finish)." >&2; exit 1; }
fi

# --- index inputs (fresh clone: embeddings are git-ignored, regenerate) -----
# --fresh drops the cached index so changed build inputs (chunks.json/llmstxt/)
# get re-embedded; the presence check below then triggers a rebuild.
if [ "$FRESH" = 1 ]; then
  echo "==> --fresh: removing cached index (.opencrane/milvus.db, .opencrane/embeddings.json)"
  rm -f .opencrane/milvus.db .opencrane/embeddings.json
fi
if [ ! -f .opencrane/milvus.db ] && [ ! -f .opencrane/embeddings.json ]; then
  echo "==> No local index found; generating embeddings (one-time, takes a while)..."
  uvx opencrane embed
fi

cleanup() {
  trap - INT TERM EXIT
  echo ""
  echo "==> Stopping..."
  kill 0 2>/dev/null || true
}
trap cleanup INT TERM EXIT

wait_http() { # url name timeout_s — any HTTP response counts as up
  local i
  for i in $(seq 1 "$3"); do
    curl -s -o /dev/null --max-time 2 "$1" && return 0
    sleep 1
  done
  echo "ERROR: $2 did not come up within $3 s — see $LOG_DIR" >&2
  return 1
}

# The embedding model runs locally, but sentence-transformers revalidates its
# HuggingFace cache over the network on every startup (~40 HEAD requests, several
# seconds). Once the model is cached, go offline so it loads straight from disk.
# Skipped on a cold cache so the first run can still download the model.
HF_CACHE="${HF_HOME:-$HOME/.cache/huggingface}/hub"
if [ -d "$HF_CACHE/models--nomic-ai--nomic-embed-text-v1.5" ]; then
  export HF_HUB_OFFLINE=1
fi

echo "==> Starting MCP server on :$MCP_PORT (log: $LOG_DIR/mcp.log)"
MILVUS_DB_PATH=.opencrane/milvus.db MCP_HTTP_PORT="$MCP_PORT" uvx opencrane serve --transport http >"$LOG_DIR/mcp.log" 2>&1 &
wait_http "http://localhost:$MCP_PORT/mcp" "MCP server" 120

echo "==> Starting chat function on :$FUNC_PORT (log: $LOG_DIR/function.log)"
[ -d function/node_modules ] || (cd function && npm install)
(cd function && PORT="$FUNC_PORT" npm run dev) >"$LOG_DIR/function.log" 2>&1 &
wait_http "http://localhost:$FUNC_PORT" "chat function" 60

echo "==> Starting chat UI on :$CHAT_PORT (log: $LOG_DIR/chat.log)"
# Serve a temp copy of chat/ with a config pointing at the local ports
# (chat/config.js in the repo is the deployed config — leave it untouched).
rm -rf "$LOG_DIR/chat-site"
cp -R chat "$LOG_DIR/chat-site"
cat >"$LOG_DIR/chat-site/config.js" <<EOF
// Generated by scripts/run-local.sh
window.OSE_CHAT_CONFIG = {
  FUNCTION_URL: "http://localhost:$FUNC_PORT",
};
EOF
python3 -m http.server "$CHAT_PORT" --directory "$LOG_DIR/chat-site" >"$LOG_DIR/chat.log" 2>&1 &
wait_http "http://localhost:$CHAT_PORT" "chat UI" 15

echo ""
if [ "$MODE" = "--hosted" ]; then
  echo "Ready (hosted Mistral, model: ${MISTRAL_MODEL:-mistral-small-latest})."
else
  echo "Ready (offline: Ollama $MISTRAL_MODEL at $MISTRAL_BASE_URL)."
fi
echo "  Chat UI:   http://localhost:$CHAT_PORT"
echo "  Function:  http://localhost:$FUNC_PORT"
echo "  MCP:       http://localhost:$MCP_PORT/mcp"
echo ""
echo "Ctrl-C stops everything."
command -v open >/dev/null 2>&1 && open "http://localhost:$CHAT_PORT"
wait
