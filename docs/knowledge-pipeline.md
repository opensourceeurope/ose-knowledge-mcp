# Knowledge pipeline (OpenCrane)

The knowledge base is built by an [OpenCrane](https://github.com/derberg/OpenCrane) pipeline
that fetches the OSE docs, chunks and
embeds them, and indexes them into Milvus Lite for the `search_docs` MCP tool.

## Sources

Both are public `llms-full.txt`:

- open-source-europe — https://docs.opencollective.com/open-source-europe
- oc-europe-internal-doc — https://docs.opencollective.com/oc-europe-internal-doc

## Rebuild the index locally

opencrane is **version-locked** in [`.opencrane/opencrane-version`](../.opencrane/opencrane-version)
(currently `0.18.9`) — CI and `scripts/ensure-index.sh` invoke exactly that version via `uvx`,
never the latest PyPI release, so the index is reproducible. To move to a new opencrane, edit
that one file and regenerate the index (`./scripts/ensure-index.sh`) in the same PR. Pin your
local commands to the same version so they match CI:

`fetch` needs a non-empty `GITHUB_TOKEN` even for llmstxt-only sources:

```bash
OC="opencrane@$(cat .opencrane/opencrane-version)"
GITHUB_TOKEN=x uvx "$OC" fetch
uvx "$OC" llms
uvx "$OC" chunk
uvx "$OC" embed
uvx "$OC" index
```

Or run the whole pipeline at once:

```bash
GITHUB_TOKEN=x uvx "opencrane@$(cat .opencrane/opencrane-version)" build
```

**Artifact strategy:** `chunks.json` + `llmstxt/` are committed build inputs, and
`embeddings.json` + `milvus.db` are committed build **artifacts** — the release packs the
committed `milvus.db` straight from the repo instead of re-embedding on every release. They
are regenerated **only when the chunks change**, not at Docker build time. Rather than running
`embed`/`index` by hand, use the wrapper, which re-embeds only if `chunks.json` actually
changed and is a no-op otherwise:

```bash
./scripts/ensure-index.sh
```

If you change `chunks.json` (or chunking config), run it and commit
`.opencrane/embeddings.json` + `.opencrane/milvus.db` alongside — `ci.yml` runs
`./scripts/ensure-index.sh --check` and fails a PR whose committed index is stale vs its
chunks. The weekly `refresh.yml` does the same regeneration + commit automatically (see
[`automation.md`](automation.md)).

## Smoke-test the MCP search

```bash
MILVUS_DB_PATH=.opencrane/milvus.db uv run --with mcp python tests/smoke_query.py
```

Serve it locally over HTTP (port 8000):

```bash
MILVUS_DB_PATH=.opencrane/milvus.db uvx "opencrane@$(cat .opencrane/opencrane-version)" serve --transport http
```

## Build & test the MCP container

The MCP server is packaged as a container (built from `.opencrane/Dockerfile`) and serves MCP
Streamable HTTP on port 8000. Test the container locally:

```bash
docker build -f .opencrane/Dockerfile -t ose-mcp:local .
docker run -d --name ose-mcp -p 8000:8000 ose-mcp:local
uv run --with mcp python tests/smoke_http.py
docker rm -f ose-mcp
```

The public endpoint serves the `search_docs` tool (among others) over MCP Streamable HTTP at
`<endpoint>/http` (`<endpoint>/mcp` works too as a legacy alias). Deployment — Scaleway
one-time setup, required GitHub secrets/variables, and the deploy workflow — is in
[`deploy-scaleway.md`](deploy-scaleway.md).

## Published package

The knowledge base is also published to PyPI as a standalone MCP package (built with
`opencrane pack`, refreshed weekly), so it can run locally via `uvx ose-knowledge-mcp`. See the
repo [README](../README.md#use-it-as-an-mcp-server--claude-plugin) for the client config, and
[`automation.md`](automation.md) for how the package is published on each release.
