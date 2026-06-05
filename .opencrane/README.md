# .opencrane

This directory contains OpenCrane configuration and generated data files.

## Structure

| File | Description | Commit? |
|---|---|---|
| `config.yaml` | Sources, ignore patterns, and optional extensions reference | Yes |
| `chunks.json` | Generated document chunks (`opencrane chunk`) | Yes |
| `embeddings.json` | Generated vector embeddings (`opencrane embed`) | No (git-ignored) |

> Committing `chunks.json` is required for Docker image builds via CI/CD.
> `embeddings.json` and `milvus.db` are always git-ignored and regenerated at image
> build time from `chunks.json` (`opencrane embed && opencrane index`).

## Quick Start

```bash
# 1. Add documentation sources interactively
opencrane add

# 2. Build the full pipeline (fetch → llms → chunk → embed → index)
opencrane build

# 3. Start the MCP server (auto-indexes into Milvus Lite)
opencrane serve

# 4. Or launch MCP Inspector for interactive testing
opencrane inspect
```

Run `opencrane serve` and follow the printed instructions to connect your MCP client.

## Docker / Podman

For containerized deployment over HTTP:

```bash
# Build and run
docker-compose up --build
```

The Docker image bakes the vector database at build time for fast startup.
Configure the embedding model via `EMBEDDING_MODEL` env var in `docker-compose.yml`.

### Build and publish the Docker image

```bash
# Build the image
docker build -t your-registry/opencrane-mcp:latest -f .opencrane/Dockerfile .

# Push to a registry
docker push your-registry/opencrane-mcp:latest
```

Others can then run it with:

```bash
docker run -p 8000:8000 your-registry/opencrane-mcp:latest
```

### MCP client configuration for Docker (HTTP)

Once the container is running on port 8000, configure your MCP client to use the HTTP endpoint:

**Claude Code:**

```bash
claude mcp add opencrane --transport http --url http://localhost:8000/http
```

**Cursor / Windsurf / VS Code (mcp.json):**

```json
{{
  "mcpServers": {{
    "opencrane": {{
      "url": "http://localhost:8000/http"
    }}
  }}
}}
```

## Pipeline Steps

`opencrane build` runs the full pipeline, but each step can be run independently:

| Command | Description |
|---|---|
| `opencrane add` | Interactively add documentation sources |
| `opencrane fetch` | Download documentation from GitHub repositories |
| `opencrane llms` | Generate `llms-full.txt` bundle files |
| `opencrane chunk` | Split documentation into chunks |
| `opencrane embed` | Generate vector embeddings for each chunk |
| `opencrane index` | Load chunks and embeddings into Milvus |
| `opencrane serve` | Start the MCP server (auto-indexes if needed) |
| `opencrane pack` | Package the MCP server for distribution via `uvx` |
| `opencrane inspect` | Launch MCP Inspector web UI for testing |
| `opencrane tokens` | Generate a token count report |

Running steps individually is useful when iterating on a single stage (e.g., re-chunking after config changes without re-fetching).
