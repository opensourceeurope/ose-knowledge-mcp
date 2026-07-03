# Automation

All CI/release/deploy automation lives in `.github/workflows/`. Content refresh and CI run
continuously; **shipping is release-gated** — deploys happen only when a release is cut.

- **Weekly refresh** (`refresh.yml`): every Saturday 03:00 UTC, OpenCrane re-fetches the two
  `llms-full.txt` sources and the per-page `llms.txt` indexes (used for citation links),
  regenerates `chunks.json`, and commits any changes as a `fix:` so release-please rolls the
  refreshed content into the release PR. Run it manually any time from the Actions tab.
- **CI** (`ci.yml`): on every push/PR — checks the plugin agent is in sync with
  `agent/ose-researcher.md`, builds and tests the chat function, and lints all workflows.
- **Chat deploy** (`deploy-chat.yml`): manual `workflow_dispatch`; renders `chat/config.js`
  from repo variables and uploads the static page to Scaleway Object Storage via `aws s3 sync`.
  See [`deploy-chat.md`](deploy-chat.md).
- **Release** (`release.yml`): you never cut a release by hand. Conventional commits on `main`
  (`fix:`→patch, `feat:`→minor, `feat!:`/`BREAKING CHANGE`→major) drive
  [release-please](https://github.com/googleapis/release-please), which maintains a rolling
  **release PR** that bumps the version, regenerates `CHANGELOG.md`, and syncs the
  `ose-knowledge-mcp` version everywhere (`plugin.json`, `.mcp.json`, the `chat/` snippet, and
  the README quick-start — via `scripts/sync-mcp-version.sh`, so the docs never promote a
  floating `latest`).
  `commitlint.yml` enforces the commit format. Needs the `RELEASE_TOKEN` secret so the release
  PR gets CI and the mcp-pin sync can push back onto it. **The release PR auto-merges**:
  `release.yml` arms GitHub native auto-merge on it, so once its CI (`validate` + `commitlint`)
  is green it merges itself — no manual review. This needs "Allow auto-merge" on the repo and
  branch protection on `main` requiring those two checks (the required check is what makes
  auto-merge hold for green instead of merging instantly; "require a pull request" stays off so
  the weekly refresh can keep pushing straight to `main`).

## Release = ship

Publish + deploy run in the *same* `release.yml` run — merging the release PR that cuts
`vX.Y.Z` (auto-merged once green, see above) triggers them via release-please's
`releases_created` output (no separate release-event workflow):

- **PyPI publish**: packs the knowledge base into the `ose-knowledge-mcp` package
  (`opencrane pack` + `uv build`) and publishes it via PyPI trusted publishing. The version
  comes from the release tag (`v0.2.0` → `0.2.0`).
- **Deploy**: builds + pushes the image and updates the Scaleway serverless container (see
  [`deploy-scaleway.md`](deploy-scaleway.md)); also runnable on its own via `workflow_dispatch`
  to redeploy an already-published version.
- **Chat function + page**: redeployed on every release so refreshed citation links ship too.

For the full contributor flow and the list of files release-please owns (never hand-edit), see
the `dev-workflow` skill and [`../AGENTS.md`](../AGENTS.md).
