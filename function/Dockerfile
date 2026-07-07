# Minimal runtime image for the chat function.
#
# The build (bundle persona, then tsc) runs in CI where the full repo is present,
# because that script reads ../../agent. This image only ships the
# already-built dist/ + production node_modules — it does NOT compile here. Build context
# is `function/` (so the repo-root .dockerignore, which excludes function/, does not apply).
FROM node:20-slim

WORKDIR /app

# Shipped pre-built by the workflow: prod deps + compiled output.
COPY package.json ./
COPY node_modules ./node_modules
COPY dist ./dist

ENV PORT=8080
EXPOSE 8080

# dist/server.js is the stateless HTTP server (reads its config from env vars set on the
# Scaleway container: MISTRAL_API_KEY, OSE_MCP_URL, ALLOWED_ORIGINS, MISTRAL_MODEL, …).
CMD ["node", "dist/server.js"]
