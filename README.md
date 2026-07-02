# OSE Knowledge RAG

AI-powered documentation search for **Open Source Europe**, built with OpenCrane. It indexes
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
ollama pull mistral-small3.2   # one-time: the default local model
./scripts/run-local.sh         # serves the UI at http://localhost:8090
```

**Prerequisites:** [`uv`](https://docs.astral.sh/uv/), Node 20+, and [Ollama](https://ollama.com)
(running). The first run generates the embeddings index once (a few minutes); pass `--fresh`
to rebuild it after changing the build inputs.

Prefer the hosted Mistral API, a different local model, or want the full config? See
[`function/README.md`](function/README.md).

## Use the public chat

A public, EU-hosted chat where anyone can ask about Open Source Europe and get cited answers —
zero setup, just open it:

<!-- Public chat URL — swap for the friendly domain (e.g. ask.opensourceeurope.org) once it's live. -->
**→ https://ose-knowledge-chat.s3-website.pl-waw.scw.cloud**

The entire request path is sovereign (Mistral EU for inference, everything hosted on Scaleway
EU) and nothing is persisted in your browser. See [`docs/architecture.md`](docs/architecture.md)
for how it works.

## Use it as an MCP server / Claude plugin

The knowledge base is published to PyPI as a standalone MCP package, so any MCP client can
search the OSE docs.

**Claude Code plugin** — adds the MCP server + an `ose-researcher` agent:

```
/plugin marketplace add opensourceeurope/ose-knowledge-mcp
/plugin install ose-knowledge@ai
```

**Any MCP client** (Claude Code, Cursor, Claude Desktop, …):

```bash
claude mcp add ose-knowledge -- uvx ose-knowledge-mcp
```

or in the client's config:

```json
{
  "mcpServers": {
    "ose-knowledge": { "type": "stdio", "command": "uvx", "args": ["ose-knowledge-mcp"] }
  }
}
```

## How it works & more docs

- [`docs/architecture.md`](docs/architecture.md) — the two flows (public chat vs. your own agent), as diagrams.
- [`docs/knowledge-pipeline.md`](docs/knowledge-pipeline.md) — the OpenCrane index pipeline, smoke tests, and building/running the MCP container locally.
- [`docs/deploy-scaleway.md`](docs/deploy-scaleway.md) — deploying the hosted MCP server.
- [`docs/deploy-chat.md`](docs/deploy-chat.md) — deploying the chat function + static page.
- [`docs/chat-ui.md`](docs/chat-ui.md) — the chat UI design system.
- [`docs/automation.md`](docs/automation.md) — CI, the weekly refresh, and the release → publish → deploy chain.
- [`function/README.md`](function/README.md) — the chat function (config, security, local run, hosted Mistral).
