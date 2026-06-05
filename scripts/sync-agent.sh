#!/usr/bin/env bash
# Single source of truth for the OSE-researcher persona is agent/ose-researcher.md.
# This copies it into the plugin with a generated-file banner.
# Usage: ./scripts/sync-agent.sh         (writes the plugin copy)
#        ./scripts/sync-agent.sh --check  (fails if the plugin copy is stale)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

SRC="agent/ose-researcher.md"
DEST="plugins/ose-knowledge/agents/ose-researcher.md"
BANNER="<!-- GENERATED from agent/ose-researcher.md by scripts/sync-agent.sh — do not edit directly. -->"

mkdir -p "$(dirname "$DEST")"
tmp="$(mktemp)"
printf '%s\n\n' "$BANNER" > "$tmp"
# Strip the SOURCE-NOTE comment block (explains the canonical-file setup; only
# relevant in the source file) and the blank lines left behind it.
sed '/<!-- SOURCE-NOTE/,/^-->$/d' "$SRC" | cat -s >> "$tmp"

if [ "${1:-}" = "--check" ]; then
  if ! diff -q "$tmp" "$DEST" >/dev/null 2>&1; then
    echo "ERROR: $DEST is out of sync with $SRC. Run scripts/sync-agent.sh." >&2
    rm -f "$tmp"
    exit 1
  fi
  echo "OK: plugin agent is in sync."
  rm -f "$tmp"
else
  mv "$tmp" "$DEST"
  echo "Synced $SRC -> $DEST"
fi
