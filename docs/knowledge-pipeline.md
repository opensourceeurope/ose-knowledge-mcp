# Knowledge pipeline (OpenCrane)

The knowledge base is built by an [OpenCrane](https://github.com/derberg/OpenCrane) pipeline
that fetches the OSE docs, chunks and
embeds them, and indexes them into Milvus Lite for the `search_docs` MCP tool.

## Sources

Both are public `llms-full.txt`:

- open-source-europe — https://docs.opencollective.com/open-source-europe
- oc-europe-internal-doc — https://docs.opencollective.com/oc-europe-internal-doc

## Rebuild the index locally

`fetch` needs a non-empty `GITHUB_TOKEN` even for llmstxt-only sources:

```bash
GITHUB_TOKEN=x uvx opencrane fetch
uvx opencrane llms
uvx opencrane chunk
uvx opencrane embed
uvx opencrane index
```

Or run the whole pipeline at once:

```bash
GITHUB_TOKEN=x uvx opencrane build
```

**Artifact strategy:** `chunks.json` + `llmstxt/` are committed (small build inputs);
`embeddings.json` and `milvus.db` are git-ignored and regenerated at Docker build time (see
`.opencrane/Dockerfile`).

## Smoke-test the MCP search

```bash
MILVUS_DB_PATH=.opencrane/milvus.db uv run --with mcp python tests/smoke_query.py
```

Serve it locally over HTTP (port 8000):

```bash
MILVUS_DB_PATH=.opencrane/milvus.db uvx opencrane serve --transport http
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
