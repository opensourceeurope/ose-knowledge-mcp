#!/usr/bin/env bash
# Propagate the release version into the files that pin the mcp package spec.
# release-please owns the version (.release-please-manifest.json, key "."), but it
# cannot cleanly rewrite `ose-knowledge-mcp==X.Y.Z` — its json updater writes a bare
# value (clobbering the `pkg==` prefix) and these files can't carry the inline comment
# its generic updater needs. So this script does that one bit.
#
# It pins ONLY genuine package specs, via two narrow anchors:
#   1. after `uvx ` (a CLI install arg)         e.g.  uvx ose-knowledge-mcp
#   2. inside a double-quoted string with NO     e.g.  "ose-knowledge-mcp"
#      slash in it (a JSON args entry)                 ["ose-knowledge-mcp==0.1.1"]
# The no-slash guard is deliberate — it leaves repo references untouched
# (opensourceeurope/ose-knowledge-mcp, github.com/.../ose-knowledge-mcp.git, and any
# href="https://github.com/.../ose-knowledge-mcp"), and the uvx/quote anchors leave a
# bare `cd ose-knowledge-mcp` dir name alone. An earlier, broader "any quoted string
# containing the token" regex corrupted the GitHub source link in chat/index.html by
# pinning the URL (…/ose-knowledge-mcp==0.1.1) — hence these tighter anchors.
#
# Rewrites:
#   - plugins/ose-knowledge/.mcp.json   (the uvx arg pin)
#   - chat/index.html                   (the "MCP config" snippet pin)
#   - README.md                         (the quick-start uvx + JSON config pins)
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

changed=0

# Pin only real package specs. Two anchored substitutions (see header):
#   1. `uvx ose-knowledge-mcp[==x]`               -> `uvx ose-knowledge-mcp==$VERSION`
#   2. `"…ose-knowledge-mcp[==x]…"` with no slash  -> pinned; the no-slash guard skips
#      inside the quotes                              URLs and repo paths.
sync_file() {
  file="$1"
  sum_before="$(shasum "$file" | awk '{print $1}')"
  VERSION="$VERSION" perl -i -pe '
    s/(\buvx\s+ose-knowledge-mcp)(==[0-9A-Za-z.+_-]+)?/"$1==$ENV{VERSION}"/ge;
    s/("[^"\/]*\bose-knowledge-mcp)(==[0-9A-Za-z.+_-]+)?([^"\/]*")/"$1==$ENV{VERSION}$3"/ge;
  ' "$file"
  sum_after="$(shasum "$file" | awk '{print $1}')"
  if [ "$sum_before" != "$sum_after" ]; then
    echo "updated $file -> ose-knowledge-mcp==$VERSION"
    changed=1
  else
    echo "no change $file (already ose-knowledge-mcp==$VERSION)"
  fi
}

sync_file "plugins/ose-knowledge/.mcp.json"
sync_file "chat/index.html"
sync_file "README.md"

if [ "$changed" -eq 0 ]; then
  echo "sync-mcp-version: nothing to change (version $VERSION)"
fi
