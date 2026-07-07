# OSE Knowledge RAG

AI-powered documentation search for **Open Source Europe**, built with
[OpenCrane](https://github.com/derberg/OpenCrane). It indexes
the OSE handbook + internal operations docs into a retrieval MCP server (the `search_docs`
tool) and lets you use it three ways: run the whole chat locally, use the public hosted
chat, or plug the knowledge base into your own AI tools.

## Contents

- [Run it locally](#run-it-locally)
- [Use the public chat](#use-the-public-chat)
- [Use it as an MCP server / Claude plugin](#use-it-as-an-mcp-server--claude-plugin)
- [How it works & more docs](#how-it-works--more-docs)

## Run it locally

One command starts the whole chat — MCP server, agent function, and UI — and opens it in your
browser. It runs **fully offline**: the agent talks to a local [Ollama](https://ollama.com),
so no API key is needed and nothing leaves your machine.

```bash
brew install uv ollama         # macOS (Linux install one-liners below)
ollama serve &                 # start Ollama (or open the Ollama app)
ollama pull mistral-small3.2   # one-time: the default local model
./scripts/run-local.sh         # serves the UI at http://localhost:8090
```

On Linux, install [`uv`](https://docs.astral.sh/uv/) and [Ollama](https://ollama.com) with:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh      # uv
curl -fsSL https://ollama.com/install.sh | sh        # Ollama
```

**Also needed:** Node 20+. The first run generates the embeddings index once (a few minutes);
pass `--fresh` to rebuild it after changing the build inputs.

Prefer a hosted API (Scaleway or Mistral), a different local model, or want the full config?
See [`function/README.md`](function/README.md).

## Use the public chat

A public, EU-hosted chat where anyone can ask about Open Source Europe and get cited answers —
zero setup, just open it:

**→ https://ask.opensourceeurope.org**

The entire request path is sovereign (inference on Scaleway Generative APIs, EU, with Mistral
Small; everything else hosted on Scaleway EU too) and nothing is persisted in your browser.
See [`docs/architecture.md`](docs/architecture.md) for how it works.

> **Note on answer quality:** the hosted chat runs on a small, cheap model
> (`mistral-small-3.2-24b-instruct-2506`), so its answers won't match what you'd get from a
> larger model. For the best results, plug the
> knowledge base into your own agent and use whatever model you already run — see
> [Use it as an MCP server / Claude plugin](#use-it-as-an-mcp-server--claude-plugin) below.

## Use it as an MCP server / Claude plugin

The knowledge base is published to PyPI as a standalone MCP package, so any MCP client can
search the OSE docs.

**Claude Code plugin** — adds the MCP server + an `ose-researcher` agent:

```
/plugin marketplace add opensourceeurope/ose-knowledge-mcp
/plugin install ose-knowledge@ose-ai
```

**Any MCP client** (Claude Code, Cursor, Claude Desktop, …):

```bash
claude mcp add ose-knowledge -- uvx ose-knowledge-mcp==0.3.2
```

or in the client's config:

```json
{
  "mcpServers": {
    "ose-knowledge": { "type": "stdio", "command": "uvx", "args": ["ose-knowledge-mcp==0.3.2"] }
  }
}
```

> The version is **pinned** on purpose (rather than floating on latest) so you always
> get a known, reviewed build. These snippets are kept up to date automatically on each
> release — see [`docs/automation.md`](docs/automation.md).

## How it works & more docs

- [`docs/architecture.md`](docs/architecture.md) — the two flows (public chat vs. your own agent), as diagrams.
- [`docs/knowledge-pipeline.md`](docs/knowledge-pipeline.md) — the OpenCrane index pipeline, smoke tests, and building/running the MCP container locally.
- [`docs/deploy-scaleway.md`](docs/deploy-scaleway.md) — deploying the hosted MCP server.
- [`docs/deploy-chat.md`](docs/deploy-chat.md) — deploying the chat function + static page.
- [`docs/chat-cost.md`](docs/chat-cost.md) — what the hosted chat costs to run, measured per question/session.
- [`docs/chat-ui.md`](docs/chat-ui.md) — the chat UI design system.
- [`docs/automation.md`](docs/automation.md) — CI, the weekly refresh, and the release → publish → deploy chain.
- [`function/README.md`](function/README.md) — the chat function (config, security, local run, hosted inference).
