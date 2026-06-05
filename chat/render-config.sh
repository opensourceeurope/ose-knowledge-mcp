#!/usr/bin/env bash
# Render chat/config.js from chat/config.template.js using environment values.
# Usage: FUNCTION_URL=https://... ./chat/render-config.sh
# Errors out if the value is missing so a deploy never ships a half-configured page.
set -euo pipefail
: "${FUNCTION_URL:?set FUNCTION_URL (the deployed chat function URL)}"

cd "$(dirname "$0")"
# '#' delimiter because the value contains '/'.
sed -e "s#\${FUNCTION_URL}#${FUNCTION_URL}#g" \
    config.template.js > config.js
echo "Rendered chat/config.js (FUNCTION_URL=${FUNCTION_URL})"
