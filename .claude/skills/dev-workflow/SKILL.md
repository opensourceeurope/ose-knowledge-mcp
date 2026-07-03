---
name: dev-workflow
description: Use when starting any change to ose-knowledge-rag — starting a change, branching, running locally, writing a commit, opening a PR, bumping a version, or cutting a release. Covers per-topic worktrees, the branch + PR + CI flow, conventional commits, the release-please release-PR flow, what release-please owns (never hand-edit), and the release → PyPI/deploy chain.
---

# ose-knowledge-rag Dev Workflow

## Step 0 — know your branch, every time

Before reading code to answer a question OR before editing, run `git status -sb`
(shows current branch + ahead/behind). The checked-out tree is often a **stale
topic branch**: reporting "the code does X" from it is wrong if `main` already
changed X. If HEAD is behind `origin/main`, say so up front, and answer "what
does the code do *now*?" against `origin/main` (`git grep … origin/main`,
`git show origin/main:<file>`), never the stale working tree.

## Parallel topics — one worktree per topic

A single checkout has one `HEAD`, so two sessions sharing one directory fight
over the branch: one runs `git switch`, the other's files change underneath it.
Don't work around this with `git stash` juggling or extra clones. Use a **git
worktree per topic** — each is its own directory with its own checked-out
branch, all backed by this repo's single `.git` (one `fetch`, shared
branches/stash/reflog; git refuses to check out the same branch in two
worktrees, which is the guard you actually want).

**The one rule: never edit/develop on main; always a topic worktree.** Spin one
up with the helper (off fresh `origin/main`):

```bash
.claude/skills/dev-workflow/resources/worktree.sh new feat/<short-name>   # creates .worktrees/<name>
.claude/skills/dev-workflow/resources/worktree.sh list
.claude/skills/dev-workflow/resources/worktree.sh rm  feat/<short-name>   # removes the dir; branch stays
```

Then open `.worktrees/<name>` as the workspace for that session and work there.
This repo has **no root install step**; if you'll work on the Node chat
function, run `cd function && npm ci` inside the worktree. `.worktrees/` is
gitignored, and the branch-guard hook is worktree-aware — it gates each file by
the branch of the worktree that owns it, so topics never gate or clobber each
other.

**A worktree is required, not optional:** the branch-guard hook makes the shared
main checkout read-only for edits (any branch), so all topic work happens in a
`.worktrees/<topic>` directory. This is deliberate — the main checkout's HEAD is
shared, and a concurrent session can switch it mid-task, landing your commit on
the wrong branch. A worktree pins one branch to one directory, which git enforces.

## The flow

```
.claude/skills/dev-workflow/resources/worktree.sh new feat/<short-name>  # 1. fresh worktree off origin/main (the main checkout is read-only)
# open .worktrees/feat-<short-name> and work THERE
# ... make changes (pipeline, function, chat, analytics, docs) ...
# before pushing: run /simplify (or /code-review) on the diff to catch
#   duplication and reuse misses while they are still cheap to fix
git push -u origin feat/<short-name>  # 2. push the branch
# 3. open a PR
# 4. CI must pass:
#      - ci.yml: agent-sync check (scripts/sync-agent.sh --check),
#        index-sync check (scripts/ensure-index.sh --check — fails if chunks.json
#          changed without regenerating the committed embeddings.json + milvus.db),
#        function build + test (npm ci / build / test in function/),
#        workflow lint (zizmor via security-audit.yml)
#      - commitlint.yml: every commit + the PR title must be a conventional commit
# 5. merge the PR to main
# 6. release-please opens/updates a rolling release PR (version + changelog + pins)
# 7. that release PR AUTO-MERGES once its CI is green (release.yml arms GitHub
#      auto-merge on it — no manual merge) → tag vX.Y.Z + GitHub Release, and the
#      SAME release.yml run then publishes ose-knowledge-mcp to PyPI and deploys
#      container + function + chat (downstream jobs gated on `releases_created`)
```

**There is NO per-PR preview environment in this repo.** You review on the diff
and CI, not on a deployed preview URL. Deploys happen only on release.

Releases here are automated by **release-please**. You write conventional
commits; release-please does all the version/changelog/tag work, and the release
PR auto-merges itself once its CI is green. Your job is just to commit correctly —
never to hand-bump anything, and (normally) not even to merge the release PR.

## Conventional commits (required)

Every commit and PR title must be a conventional commit. CI (`commitlint.yml`)
fails a PR whose commits don't conform, because a mistyped type silently skips the
version bump.

| Commit prefix | Example | Version effect |
|---|---|---|
| `fix:` | `fix: correct citation link` | **patch** (0.1.0 → 0.1.1) |
| `feat:` | `feat: add reranker to chat` | **minor** (0.1.0 → 0.2.0) |
| `feat!:` or a `BREAKING CHANGE:` footer | `feat!: drop stdio transport` | **major** (0.1.0 → 1.0.0) |
| `docs:` `ci:` `chore:` `refactor:` `test:` `perf:` | `chore: bump dep` | no release (shown/hidden per config) |

## The release flow

```
commit feat:/fix:/feat!: to main
  → release.yml maintains a rolling "release PR" that:
      - bumps the version in .release-please-manifest.json
      - regenerates root CHANGELOG.md
      - writes the version into plugins/ose-knowledge/.claude-plugin/plugin.json ($.version)
      - a follow-up step runs scripts/sync-mcp-version.sh to rewrite the
        `ose-knowledge-mcp==X.Y.Z` pin in .mcp.json + chat/index.html + README.md,
        committed onto the PR branch
      - arms GitHub auto-merge on the release PR (gh pr merge --auto --squash)
  → release PR auto-merges once CI is green → tag vX.Y.Z + GitHub Release, and IN THE SAME RUN
      release.yml's downstream jobs (gated on `releases_created`):
      build ose-knowledge-mcp==X.Y.Z, publish to PyPI, deploy container + function + chat.
```

Publish + deploy are jobs in `release.yml` itself — there is no separate
`publish-pypi.yml` / `release: published` handoff anymore. (The container deploy is
also runnable on its own via `release.yml`'s `workflow_dispatch`, passing an
already-published `version`, to redeploy without cutting a release.)

To ship: just **land conventional commits on `main`**. The release PR then
auto-merges itself once its CI is green — that is what cuts the release (there is
no hand-typed tag anymore). You only touch the release PR manually to *hold* a
release (mark it draft / disable auto-merge) or if its CI is red.

One-time maintainer setup: the `RELEASE_TOKEN` secret (a PAT/GitHub App token
with Contents + PRs write) must exist. It is what gives the release PR its CI runs and
lets the mcp-pin sync step push back onto the PR branch (commits made with the default
`GITHUB_TOKEN` don't trigger other workflows). Also: the PyPI trusted publisher's
`workflow_ref` must point at `release.yml` (the file that now runs the publish job).

## release-please OWNS these — never hand-edit

Editing any of these by hand fights release-please and gets overwritten (or drifts
the version across files):

- `CHANGELOG.md` (root) — regenerated from commits.
- `plugins/ose-knowledge/CHANGELOG.md` — now just a pointer to the root; don't add entries.
- `plugins/ose-knowledge/.claude-plugin/plugin.json` `version` — release-please `json` updater.
- `plugins/ose-knowledge/.mcp.json` `ose-knowledge-mcp==` pin — the sync step.
- `chat/index.html` local-first snippet `ose-knowledge-mcp==` pin — the sync step.
- `README.md` quick-start `ose-knowledge-mcp==` pin (uvx + JSON config) — the sync step.
- `.release-please-manifest.json` — release-please's version STATE file. This is not a design choice: the release-please v4 action is manifest-only and REQUIRES this file (the same machinery powers monorepo versioning). It is auto-managed, plain JSON (no comments possible) — never hand-edit it. We do NOT use a `pyproject.toml` as the source of truth: the package has no persistent Python project file (`opencrane pack --version` generates the package at build time from the git tag), so this manifest is just release-please's bookkeeping. The version you actually read/reason about is the git tag (and `plugin.json`).
- git tags `vX.Y.Z` + GitHub Releases — created on release-PR merge.

If you need to change a version, do it by landing a conventional commit and letting
release-please bump. `scripts/sync-mcp-version.sh` exists only for the workflow (and
manual recovery with an explicit version arg) — not for routine edits.

## Invariants enforced by hooks

- **No edits in the shared main checkout** — the PreToolUse branch-guard denies
  `Edit`/`Write`/mutating `Bash` on any file in the primary checkout (and on
  `main`/`master` in any worktree), printing the
  `.claude/skills/dev-workflow/resources/worktree.sh new <topic>` command. Edits
  are only allowed in a linked worktree on a topic branch.
- **Skill discovery** — the SessionStart reminder ensures the `dev-workflow`
  skill is invoked before any branch-touching action.
- **Wrap-up gate** — the Stop hook reviews whether this session's diff (or a
  learning) should update docs, `.claude/skills`, `.claude/hooks`, or
  `.github/workflows` before finishing.
- `.worktrees/` is gitignored.

## Red flags — stop

- About to describe "what the code does" without checking the branch → STOP. Run
  `git status -sb` first. If HEAD is behind `origin/main`, the working tree is
  stale; reason about `origin/main`, not what's checked out.
- About to edit in the shared main checkout, or `git switch -c` there instead of
  making a worktree → STOP. A concurrent session can switch the main checkout's
  HEAD out from under you, so your commit lands on **another session's** branch.
  Use `.claude/skills/dev-workflow/resources/worktree.sh new feat/<short-name>`
  (it branches off fresh `origin/main`) and work in that worktree. Before opening
  the PR, verify isolation: `git log --oneline origin/main..HEAD` must show
  **only your own commits**.
- About to `git push` to `main` directly → branch instead.
- About to hand-bump a version (plugin.json, .mcp.json pin, manifest, index.html) →
  STOP. That's release-please's job. Land a `feat:`/`fix:` commit instead.
- About to hand-cut a tag (`git tag vX.Y.Z`) or create a GitHub Release manually →
  STOP. Merging the release PR does this, and only that path triggers the PyPI/deploy chain.
- About to write a non-conventional commit / PR title → STOP. `commitlint.yml` will
  fail the PR and (worse) a wrong type silently skips the bump.
- About to add an entry to `plugins/ose-knowledge/CHANGELOG.md` (or edit root
  CHANGELOG.md) by hand → STOP. It's release-please-owned; write a good commit message instead.
- About to edit `release.yml`'s publish/deploy jobs / `deploy-*.yml` / `refresh.yml`
  to "trigger a deploy" → STOP. Deploys are release-gated by design; merge a release PR.
