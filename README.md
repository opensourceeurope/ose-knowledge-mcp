# OSE Knowledge RAG

OSE Knowledge RAG — AI-powered documentation search for Open Source Europe, built with OpenCrane.

## Run it locally (full stack)

One command starts the whole chat — MCP server, agent function, and UI — and opens it in your browser:

    ./scripts/run-local.sh

By default it runs **fully offline**: the agent talks to a local [Ollama](https://ollama.com)
instead of Mistral, so **no API key is needed** and nothing leaves your machine.

**Prerequisites:** [`uv`](https://docs.astral.sh/uv/), Node 20+, and Ollama with the default model pulled:

    ollama pull mistral-small3.2   # the script's default local model
    ollama serve                   # or just open the Ollama app

Then run `./scripts/run-local.sh`. It serves the UI at http://localhost:8090 (ports auto-bump
if busy) and, on first run, generates the embeddings index once (a few minutes).

> **Note:** the index is regenerated only when it's missing. If you change the build inputs
> (`chunks.json` / `llmstxt/`), run `./scripts/run-local.sh --fresh` to drop the cached index
> and re-embed; otherwise the stale index is reused.

Use the **hosted** Mistral API instead of Ollama:

    MISTRAL_API_KEY=... ./scripts/run-local.sh --hosted

(or put `MISTRAL_API_KEY` in `function/.env`; pick another local model with `OLLAMA_MODEL=...`).

## Architecture

The **core product is the documentation MCP server** (the RAG); the public chat website is an
optional layer on top. See **[`docs/architecture.md`](docs/architecture.md)** for the two flows
as Mermaid diagrams — the **public chat** (we host Mistral + the agent loop) and **your own agent**
(any MCP client / the plugin / `uvx ose-knowledge-mcp`, where you bring the model).

## Knowledge pipeline (OpenCrane)

Sources (both public `llms-full.txt`):
- open-source-europe — https://docs.opencollective.com/open-source-europe
- oc-europe-internal-doc — https://docs.opencollective.com/oc-europe-internal-doc

Rebuild the index locally (note: `fetch` needs a non-empty `GITHUB_TOKEN` even for llmstxt-only sources):

    GITHUB_TOKEN=x uvx opencrane fetch
    uvx opencrane llms
    uvx opencrane chunk
    uvx opencrane embed
    uvx opencrane index

Or run the whole pipeline at once:

    GITHUB_TOKEN=x uvx opencrane build

Smoke-test the MCP search:

    MILVUS_DB_PATH=.opencrane/milvus.db uv run --with mcp python tests/smoke_query.py

Serve locally over HTTP (port 8000):

    MILVUS_DB_PATH=.opencrane/milvus.db uvx opencrane serve --transport http

Artifact strategy: `chunks.json` + `llmstxt/` are committed (small build inputs); `embeddings.json` and `milvus.db` are git-ignored and regenerated at Docker build time (see `.opencrane/Dockerfile`).

## Public MCP server

The MCP server is packaged as a container (built from `.opencrane/Dockerfile`) and serves MCP Streamable HTTP on port 8000. Test the container locally:

    docker build -f .opencrane/Dockerfile -t ose-mcp:local .
    docker run -d --name ose-mcp -p 8000:8000 ose-mcp:local
    uv run --with mcp python tests/smoke_http.py
    docker rm -f ose-mcp

The public endpoint serves the `search_docs` tool (among others) over MCP Streamable HTTP at `<endpoint>/http` (`<endpoint>/mcp` works too as a legacy alias). Deployment details — Scaleway one-time setup, required GitHub secrets/variables, and the deploy workflow — are in [`docs/deploy-scaleway.md`](docs/deploy-scaleway.md).

Prefer running it locally? The knowledge base is also published to PyPI as a
standalone MCP package (built with `opencrane pack`, refreshed weekly):

    claude mcp add ose-knowledge -- uvx ose-knowledge-mcp

or in any MCP client's config:

    {
      "mcpServers": {
        "ose-knowledge": { "type": "stdio", "command": "uvx", "args": ["ose-knowledge-mcp"] }
      }
    }

## Claude plugin (ose-knowledge)

Use the OSE knowledge base from Claude Code via the `ose-knowledge` plugin (an
`ose-researcher` agent + the public MCP server).

    /plugin marketplace add opensourceeurope/ose-knowledge-mcp
    /plugin install ose-knowledge@ai

The plugin registers the `ose-knowledge` MCP server (the `search_docs` tool over the
OSE handbook + internal operations docs) and an `ose-researcher` subagent that
returns concise, cited findings. The MCP endpoint is configured in
`plugins/ose-knowledge/.mcp.json` — set it to your deployed Scaleway endpoint.

The agent persona is maintained once in `agent/ose-researcher.md` and synced into
the plugin with `scripts/sync-agent.sh` (CI enforces they stay identical).

## Chat website

A public, sovereign chat where anyone can ask about Open Source Europe and get cited
answers. It is two decoupled, EU-hosted pieces:

- **`chat/`** — a 100% static page (HTML/CSS/vanilla JS, self-hosted Manrope). It POSTs
  the conversation to the function and renders the answer plus citation chips. Nothing is
  persisted in the browser.
- **`function/`** — a stateless Node 20 / TypeScript serverless function holding the
  Mistral key. It runs an agentic loop — Mistral `mistral-small-latest` tool-calling over
  the OSE MCP `search_docs` — and returns `{ answer, citations }`. Its system prompt is
  the same canonical `agent/ose-researcher.md` persona, so the chat behaves like the
  plugin agent.

**Sovereign stack, European infrastructure only:** the entire request path runs in
Europe — Mistral (EU) for inference, the function and static page on Scaleway (EU),
and the MCP server on Scaleway (EU).

The page has an **opt-in anonymous analytics** toggle (off by default; when ticked, the
function logs only the question text + round count to Scaleway Cockpit, no IP/PII) and a
**"Use it in your own tools or locally"** panel that shows the `uvx ose-knowledge-mcp`
MCP config, the `/plugin` commands, and how to clone this repo and run the whole
chat locally with `./scripts/run-local.sh`

Run the whole stack locally with one command — `./scripts/run-local.sh` — fully offline
via [Ollama](https://ollama.com) by default (details and configuration in
`function/README.md`). Deployment — function (Scaleway
Serverless Function or Container) and the static page (Scaleway Object Storage), with
exact `scw` / `aws s3 sync` commands and the cost/sovereignty posture — is in
[`docs/deploy-chat.md`](docs/deploy-chat.md).

## Automation

- **Weekly refresh** (`.github/workflows/refresh.yml`): every Saturday 03:00 UTC, OpenCrane
  re-fetches the two `llms-full.txt` sources and the per-page `llms.txt` indexes (used for
  citation links), regenerates `chunks.json`, and commits any changes. Run it manually any
  time from the Actions tab. Shipping the refreshed content is release-gated (see below).
- **CI** (`.github/workflows/ci.yml`): on every push/PR, checks the plugin agent is in sync
  with `agent/ose-researcher.md`, builds and tests the chat function, and lints all workflows.
- **Chat deploy** (`.github/workflows/deploy-chat.yml`): manual `workflow_dispatch`; renders
  `chat/config.js` from repo variables and uploads the static page to Scaleway Object Storage
  via `aws s3 sync` — see [`docs/deploy-chat.md`](docs/deploy-chat.md).
- **Release automation** (`.github/workflows/release.yml`): you never cut a release by
  hand. Conventional commits on `main` (`fix:`→patch, `feat:`→minor, `feat!:`/`BREAKING CHANGE`→major)
  drive [release-please](https://github.com/googleapis/release-please), which maintains a rolling
  **release PR** that bumps the version, regenerates `CHANGELOG.md`, and updates the
  `ose-knowledge-mcp` version everywhere (`plugin.json`, `.mcp.json`, and the `chat/` snippet).
  Merging that PR tags `vX.Y.Z` + creates the GitHub Release. `commitlint.yml` enforces the commit
  format. Needs the `RELEASE_TOKEN` secret so the release PR gets CI and the mcp-pin sync can push
  back onto it. See the `dev-workflow` skill for the full flow.
- **Release = ship**: publish + deploy live in the *same* `release.yml` run — the release-PR
  merge that cuts `vX.Y.Z` triggers them via release-please's `releases_created` output (no separate
  release-event workflow):
  - **PyPI publish**: packs the knowledge base into the `ose-knowledge-mcp` package
    (`opencrane pack` + `uv build`) and publishes it via PyPI trusted publishing. The version comes
    from the release tag (tag `v0.2.0` → version `0.2.0`).
  - **Deploy**: builds + pushes the image and updates the Scaleway serverless container (see
    `docs/deploy-scaleway.md`); also runnable on its own via `workflow_dispatch` to redeploy an
    already-published version.
  - **Chat function + page**: redeployed on every release so refreshed citation links ship too.
