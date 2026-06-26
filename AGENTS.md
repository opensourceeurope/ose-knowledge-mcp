# ose-knowledge-mcp — Agent Instructions

AI-powered documentation search for Open Source Europe, built with OpenCrane. An OpenCrane pipeline indexes the OSE docs into a Milvus DB served as a public MCP server (Scaleway container), plus a Claude plugin (`plugins/ose-knowledge`), a chat website (`chat/`), and a serverless chat function (`function/`). Licensed under MIT.

## Authorship Rules

- **NEVER add `Co-Authored-By:` with yourself as a co-author of any commit.** Agents are assistants and tools — they are not authors. Only humans can be authors of commits.
- AI assistance disclosure belongs in the pull request description using the exact format below — not in commit authorship metadata:
  ```
  Generated-by: <Agent Name and Version> following [AI Policy](https://github.com/opensourceeurope/.github/blob/main/AI-POLICY.md)
  ```

## Commit Conventions

- Use conventional commits: `feat:`, `fix:`, `docs:`, `ci:`, `chore:`
- This project is MIT-licensed — do not introduce incompatibly licensed material

## Running Tests

Chat function (Vitest):

```bash
cd function && npm test
```

MCP smoke tests (need a built index / running container — see README):

```bash
MILVUS_DB_PATH=.opencrane/milvus.db uv run --with mcp python tests/smoke_query.py
uv run --with mcp python tests/smoke_http.py
```

## Key Conventions — Do Not Quietly Undo

- **The agent persona lives in `agent/ose-researcher.md`.** It is synced into the plugin with `scripts/sync-agent.sh`; CI fails if the two copies drift. Edit the source, then sync — never edit the plugin copy directly. A `PostToolUse` hook in `.claude/settings.json` runs the sync automatically after any edit to either file (a direct edit to the plugin copy gets overwritten by the source). The `<!-- SOURCE-NOTE -->` block in the source file explains this and is stripped from both generated outputs.
- **`embeddings.json` and `milvus.db` are git-ignored.** They are regenerated at Docker build time. `chunks.json` + `llmstxt/` are committed build inputs — keep it that way.
- **The weekly refresh (`refresh.yml`) only commits content changes — it never deploys.** Shipping is release-gated: publishing a GitHub release triggers both the MCP container deploy (`deploy-mcp.yml`) and the PyPI publish (`publish-pypi.yml`). Don't wire deploys back into the refresh.
