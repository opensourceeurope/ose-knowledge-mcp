#!/usr/bin/env bash
# Propagate the release version into the two files that pin the mcp package.
# release-please owns the version (in .release-please-manifest.json, key "."), but it
# cannot cleanly rewrite `ose-knowledge-mcp==X.Y.Z` — its json updater writes a bare
# value (clobbering the `pkg==` prefix) and .mcp.json can't carry the inline comment
# its generic updater needs. So this script does that one bit, anchored on the
# `ose-knowledge-mcp==` token so it only touches the intended pins.
#
# Rewrites:
#   - plugins/ose-knowledge/.mcp.json          (the uvx arg pin)
#   - chat/index.html                          (the local-first "MCP config" snippet pin)
#
# Usage: ./scripts/sync-mcp-version.sh              (reads version from the manifest)
#        ./scripts/sync-mcp-version.sh 0.2.0        (override — handy for manual runs/tests)
# Idempotent: re-running with the same version is a no-op.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  # Read the "." package version from the release-please manifest.
  VERSION="$(python3 -c 'import json,sys; print(json.load(open(".release-please-manifest.json"))["."])')"
fi

if ! printf '%s' "$VERSION" | grep -qE '^[0-9A-Za-z.+_-]+$'; then
  echo "ERROR: refusing to use invalid version '$VERSION'" >&2
  exit 1
fi

MCP_JSON="plugins/ose-knowledge/.mcp.json"
INDEX_HTML="chat/index.html"

changed=0

# Replace any existing `ose-knowledge-mcp` pin (or unpinned bare name) with the
# pinned `ose-knowledge-mcp==$VERSION`. Anchored on the package token so nothing
# else (clone URLs, /plugin commands) is touched.
sync_file() {
  file="$1"
  sum_before="$(shasum "$file" | awk '{print $1}')"
  # ose-knowledge-mcp optionally followed by ==<any pin> -> ose-knowledge-mcp==$VERSION,
  # but only inside a quoted arg string ("...ose-knowledge-mcp..."), so repo clone
  # URLs and slash-command lines are left alone. In-place so trailing newlines are kept.
  VERSION="$VERSION" perl -i -pe 's/("[^"]*\bose-knowledge-mcp)(==[0-9A-Za-z.+_-]+)?([^"]*")/"$1==$ENV{VERSION}$3"/ge' "$file"
  sum_after="$(shasum "$file" | awk '{print $1}')"
  if [ "$sum_before" != "$sum_after" ]; then
    echo "updated $file -> ose-knowledge-mcp==$VERSION"
    changed=1
  else
    echo "no change $file (already ose-knowledge-mcp==$VERSION)"
  fi
}

sync_file "$MCP_JSON"
sync_file "$INDEX_HTML"

if [ "$changed" -eq 0 ]; then
  echo "sync-mcp-version: nothing to change (version $VERSION)"
fi
