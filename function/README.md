# OSE chat function

Stateless agent: Mistral Small tool-calling over the OSE MCP `search_docs`. The hosted
deployment runs `mistral-small-3.2-24b-instruct-2506` on Scaleway Generative APIs (EU);
the provider is just an OpenAI-compatible endpoint, so it also runs against Mistral's own
API or a local Ollama unchanged.

It holds the inference API key, runs the agentic loop (tool-calling -> MCP
`search_docs` -> final cited answer), and returns JSON `{ answer, citations }`.
Node 20 + TypeScript; the system prompt is the canonical `agent/ose-researcher.md`,
bundled at build time so the chat always follows the same persona as the plugin.

## Local run

One command (starts MCP + function + chat UI, offline via Ollama by default):

```bash
./scripts/run-local.sh                          # Ollama, mistral-small3.2
OLLAMA_MODEL=llama3.1:8b ./scripts/run-local.sh # different local model
./scripts/run-local.sh --hosted                 # real Mistral API (needs MISTRAL_API_KEY)
```

Ports default to 8000 (MCP) / 8080 (function) / 8090 (chat UI); if one is busy
the script shifts to the next free port automatically and wires the chat UI
config to match. Override the preferred ports via `MCP_PORT` / `FUNC_PORT` /
`CHAT_PORT` env vars. Or run the pieces manually:

1. Start a local MCP: `MILVUS_DB_PATH=.opencrane/milvus.db uvx opencrane serve --transport http` (run from the repo root, serves :8000).
2. `cd function && cp .env.example .env` and set `MISTRAL_API_KEY` + `OSE_MCP_URL=http://localhost:8000/mcp`.
3. `npm install && npm run dev` (serves :8080).
4. Point `chat/config.js` `FUNCTION_URL` at `http://localhost:8080`, serve `chat/` with `python3 -m http.server 8090`, open it, and ask a question.

### Fully offline (no Mistral key)

Replace the hosted Mistral API with a local [Ollama](https://ollama.com) — the
Mistral wire format is OpenAI-compatible, so only the base URL changes:

1. `ollama pull mistral-small3.2` (24B; reliable tool-calling, ~15 GB RAM at q4.
   On smaller machines use `mistral-nemo` (12B) — weaker but workable).
2. In `function/.env`:
   ```
   MISTRAL_BASE_URL=http://localhost:11434
   MISTRAL_MODEL=mistral-small3.2
   MISTRAL_API_KEY=ollama
   ```
3. Steps 1, 3, 4 from **Local run** above are unchanged.

The agent loop depends on the model reliably emitting `search_docs` tool calls;
models below ~12B tend to answer from memory instead of searching.

`npm run dev` regenerates the bundled persona and pagemap, then runs the server with
`tsx`. For a production-style run, `npm run build` (runs `build:persona`, `build:pagemap`,
then `tsc`) emits `dist/server.js`, which listens on `$PORT` (default 8080).

## Configuration

All configuration is via environment variables (see `.env.example`):

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `MISTRAL_API_KEY` | yes | — | Inference API key (Scaleway key for the hosted deployment; Mistral La Plateforme or Ollama otherwise); keep secret. |
| `MISTRAL_MODEL` | no | `mistral-small-latest` | Model id — `mistral-small-3.2-24b-instruct-2506` on Scaleway. Keep the small model to control spend. |
| `MISTRAL_BASE_URL` | no | `https://api.mistral.ai` | Point at any OpenAI-compatible endpoint: `https://api.scaleway.ai` (Scaleway, EU), a local Ollama (see below), or unset for Mistral's own API. The SDK appends `/v1/chat/completions`. |
| `OSE_MCP_URL` | yes | — | MCP Streamable HTTP endpoint. `http://localhost:8000/mcp` local; `https://<endpoint>/http` deployed. |
| `ALLOWED_ORIGINS` | no | `*` | Comma-separated origin allowlist, **enforced server-side** (403 when Origin is missing or not listed) in addition to CORS headers. `*` disables the check — local dev only; always set the static site origin in prod. |
| `MAX_TOOL_ROUNDS` | no | `4` | Caps agent loop iterations (spend control). |
| `PORT` | no | `8080` | Port the server listens on. |

## Security model

- **The inference API key never leaves the server.** It is read from the
  `MISTRAL_API_KEY` env var, passed only to the Mistral SDK constructor, and is
  never logged, echoed in responses, or bundled into the static site.
- **Origin allowlist is enforced, not just advertised.** With `ALLOWED_ORIGINS`
  set, the server returns `403` for any request whose `Origin` header is missing
  or not an exact allowlist match (exact array membership — no prefix/suffix
  bypass). CORS headers alone never block a request, so the check is done
  server-side before the body is read.
- **Honest limitation:** the `Origin` header can be forged by non-browser
  clients. The allowlist blocks all browser-based abuse and casual scripts;
  a determined direct caller needs platform-level rate limiting (see
  [`../docs/deploy-chat.md`](../docs/deploy-chat.md)) as the backstop.
- **Errors are generic.** Internal exception details are logged server-side
  only; clients get `{ "error": "internal_error" }` with no internals.
- **Request bodies are capped** at 128 KiB (413 beyond that) and chat history
  is trimmed to the last 12 user/assistant turns.

## Citations

Citations link to the **specific documentation page**, not just the source root.
At build time, `scripts/bundle-pagemap.mjs` generates `src/pagemap.generated.ts`
(chunk_id → page URL + title) from three committed inputs: `.opencrane/chunks.json`,
`.opencrane/llmstxt/<source>/llms-full.txt` (page bodies), and
`.opencrane/llmstxt/<source>/llms.txt` (GitBook's per-page index). At runtime the
function maps each `search_docs` result's `Chunk ID` through that map; unmapped
chunks fall back to the source root URL. The weekly refresh workflow keeps the
`llms.txt` snapshots up to date.

## Tests
- `npm test` runs unit tests (mocked Mistral) + handler validation.
- The MCP integration test runs only when `OSE_MCP_URL` is set (so it is skipped in CI without a running MCP).

## End-to-end notes

`npm run build` compiles the full module graph (handler -> agent -> mcp -> persona,
plus the generated pagemap), which is the key-free proof that everything is
type-correct and importable. A live
end-to-end run against Mistral needs a `MISTRAL_API_KEY` and is deferred to the
maintainer using the **Local run** steps above.

## Deploy

See [`../docs/deploy-chat.md`](../docs/deploy-chat.md) for deploying the function and
the static `chat/` page on a sovereign EU stack.
