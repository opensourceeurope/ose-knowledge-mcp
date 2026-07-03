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
- **The chat UI (`chat/`) has a design system — read [`docs/chat-ui.md`](docs/chat-ui.md) before changing it.** It documents the palette/tokens, components (`.ring`, `.tools-panel`, `.snippet`), voice, and the local-dev trap: `run-local.sh` serves a *temp copy* of `chat/`, so edits need a server restart **and** a browser hard-reload (a cached `app.js` is the usual "button does nothing, no errors" cause). `chat/config.js` is the deployed config — don't edit it.
- **The weekly refresh (`refresh.yml`) only commits content changes — it never deploys directly.** It commits as a `fix:` so release-please rolls the refreshed content into the release PR. Shipping is release-gated: merging the release PR makes `release.yml` publish to PyPI and deploy the MCP container + chat function + page in the same run. Don't wire deploys back into the refresh.
- **All topic work happens in a per-topic worktree off main.** Spin one up with `.claude/skills/dev-workflow/resources/worktree.sh` — the main checkout is read-only for edits (enforced by the `branch-guard` hook), and every change goes through a branch + PR + green CI before merge. See the `dev-workflow` skill.
- **Releases are cut by release-please, not by a hand-typed tag.** Conventional commits on `main` (`fix:`→patch, `feat:`→minor, `feat!:`/`BREAKING CHANGE`→major) drive `release.yml`, which maintains a rolling "release PR"; merging it tags `vX.Y.Z` + creates the GitHub Release, and the same `release.yml` run then publishes to PyPI and deploys (gated on release-please's `releases_created` output — no separate release-event workflow). **The release PR auto-merges**: `release.yml` arms GitHub native auto-merge on it, so once its CI (`validate` + `commitlint`) is green it merges itself and the publish/deploy chain runs unattended — no manual merge. This relies on repo config: "Allow auto-merge" on, and branch protection on `main` requiring those two checks (which is what makes auto-merge hold for green instead of merging instantly). `commitlint.yml` enforces conventional commits so a mistyped type can't silently skip the bump. **release-please owns the version and pins — do not hand-edit** `CHANGELOG.md` (root), `plugins/ose-knowledge/CHANGELOG.md` (a pointer now), `plugin.json`'s `version`, the `ose-knowledge-mcp==` pin in `.mcp.json`, `chat/index.html` + `README.md` (synced by `scripts/sync-mcp-version.sh`), `.release-please-manifest.json`, or git tags. See the `dev-workflow` skill. Requires the `RELEASE_TOKEN` secret so the release PR gets CI and the mcp-pin sync can push onto it.
