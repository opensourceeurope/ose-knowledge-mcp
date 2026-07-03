# Chat inference cost model

What the public chat actually costs to run, how the numbers were derived, and how to
re-measure them. The short version: **a 3-question user session costs roughly a sixth of a
euro-cent**, so cost is not a meaningful factor in model or provider choice at this scale.

## What costs money (and what doesn't)

Only **one** thing in this project calls a paid API: the chat function's LLM inference
(`mistral-small-3.2-24b-instruct-2506` on Scaleway Generative APIs, EU — see
[`deploy-chat.md`](deploy-chat.md)). The agent makes model calls in a tool-calling loop
([`function/src/agent.ts`](../function/src/agent.ts)).

**Embeddings are local and free.** The vector index is generated with a local embedding
model and committed to the repo — regenerated only when the source chunks change, not on
every build (see [`knowledge-pipeline.md`](knowledge-pipeline.md)); retrieval (`search_docs`)
never calls a paid API. So this document is only about the chat function's inference spend.

## Why input tokens dominate

Providers bill **input tokens** (everything you send the model — system prompt, tool
schema, the user's question, and the retrieved doc chunks) and **output tokens** (only what
the model writes back) separately.

The agent makes **two model calls per question**:

1. **Decide** — send the persona + tool schema + question; the model returns a `search_docs`
   tool call.
2. **Answer** — send all of the above **again**, plus the tool call and the retrieved doc
   chunk; the model returns the final answer.

Because the persona and tool schema are re-sent on every call, and the ~600-token doc chunk
is sent again on the answer call, **input tokens dwarf output tokens**. Output is just the
small tool call plus the answer prose.

## Measured token breakdown

The fixed pieces were counted with a tokenizer; the doc-chunk size was measured by running a
real question through the **actual local MCP** with the built index (not estimated):

| Piece | Tokens | How |
|---|---|---|
| Persona (bundled from [`agent/ose-researcher.md`](../agent/ose-researcher.md)) | 415 | measured |
| Chat citation directive ([`handler.ts`](../function/src/handler.ts)) | 166 | measured |
| Tool schema ([`mcp.ts`](../function/src/mcp.ts)) | 87 | measured |
| **Fixed overhead per call** | **~670** | sum of the above |
| `search_docs` result (per search) | ~560–660 | measured against the live MCP |
| User question (≈ a paragraph) | ~50 | estimate |
| Final answer written by the model | ~300 | estimate |

### Per question (1 search + answer = 2 calls)

| Call | Input | Output |
|---|---|---|
| 1 — decide | ~670 + 50 = **720** | tool call ≈ 30 |
| 2 — answer | ~670 + 50 + 30 + 600 = **~1,350** | answer ≈ 300 |
| **Total** | **~2,100** | **~330** |

### Per user session (modelled as 3 questions)

Later turns re-send earlier Q&A as history, so input grows per turn:

| | Input | Output |
|---|---|---|
| Turn 1 | ~2,100 | ~330 |
| Turn 2 (+ 1 prior turn of history) | ~2,800 | ~330 |
| Turn 3 (+ 2 prior turns) | ~3,500 | ~330 |
| **Session total** | **~8,400** | **~1,000** |

## How many sessions per 1M tokens

Plain division of 1,000,000 by the per-session totals:

| Milestone | Sessions to reach it |
|---|---|
| 1M **output** tokens | **~1,000 sessions** |
| 1M **input** tokens | **~120 sessions** |
| 1M **combined** (Scaleway's free-tier unit) | **~107 sessions** |

Output is the slow-filling bucket (~1,000 sessions per 1M). **Input fills ~8× faster**
(~120 sessions per 1M) because of all the re-sent context — so budget against input, not
output.

## Translated to money (Scaleway, `mistral-small-3.2-24b`)

At €0.15 / 1M input and €0.35 / 1M output tokens:

| | Per session | Per 1,000 sessions |
|---|---|---|
| Input (~8,400 × €0.15/1M) | ~€0.00126 | ~€1.26 |
| Output (~1,000 × €0.35/1M) | ~€0.00035 | ~€0.35 |
| **Total** | **~€0.0016** | **~€1.60** |

Scaleway's **first 1M tokens are free**, covering roughly the first ~100 sessions at no cost.
Even at 10,000 sessions/month the bill is **~€16**.

## Assumptions and caveats

- **The ~300-token answer and ~50-token question are estimates**; the persona, directive,
  tool schema, and doc-chunk sizes are measured.
- **One search round per question is assumed.** A question that triggers a second
  `search_docs` round re-sends the whole history again, adding roughly **+1,400 input
  tokens** to that question. This does not change the "~€1.60 per 1,000 sessions,
  rounding-error" conclusion.
- **`MAX_TOOL_ROUNDS`** (default `4`) is the hard ceiling on rounds per question — the main
  per-request spend control (see [`deploy-chat.md`](deploy-chat.md)).
- Prices are Scaleway list prices at time of writing; check the
  [Scaleway pricing page](https://www.scaleway.com/en/pricing/model-as-a-service/) for
  current rates.

## How to re-measure

To re-check the doc-chunk sizes against the current index, run a question through the local
MCP and count tokens of the returned text (the fixed pieces are in the source files linked
above):

```bash
# Serve the built index locally, then query search_docs and measure the result size.
MILVUS_DB_PATH=.opencrane/milvus.db uvx opencrane serve --transport http   # :8000
# In another shell, call search_docs (see tests/smoke_query.py for a minimal client)
# and tokenize the returned text with any tokenizer (e.g. tiktoken cl100k_base).
```

The bottleneck to watch over time is **input** tokens — if the persona grows or the MCP
starts returning more/larger chunks per search, per-session input rises proportionally.
