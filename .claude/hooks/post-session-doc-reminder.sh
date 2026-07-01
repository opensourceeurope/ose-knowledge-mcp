#!/usr/bin/env bash
# Stop hook: a wrap-up gate for docs AND .claude automation.
#
# It BLOCKS the stop once, forcing a deliberate review before finishing, when
# this branch changed either:
#   - code where docs usually drift (pipeline, function, chat, analytics, agent, scripts), OR
#   - automation: .github/ (workflows) or .claude/ (skills, hooks, settings).
#
# The review always asks for an explicit verdict on .claude (skills/hooks) and CI,
# on TWO grounds: a diff made one wrong, OR this SESSION revealed one is wrong /
# missing a case / worth clarifying even with no file change. A session learning
# is reason enough to update a skill, a hook, or AGENTS.md — so a pure
# automation/learning session no longer slips through silently.
#
# - Allows the stop silently only when neither code nor automation changed.
# - Reads stop_hook_active to avoid an infinite stop loop: once we've blocked once
#   in a stop-continuation chain, the next stop passes (the gate costs one pass).

set -u

# Read the Stop-hook payload on stdin. If we're already in a continuation
# triggered by a previous block, allow the stop (loop guard).
input=$(cat 2>/dev/null || true)
stop_active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)
[ "$stop_active" = "true" ] && exit 0

project=$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)
[ -z "$project" ] && exit 0

# Code paths whose changes usually require a docs update.
CODE='^(\.opencrane/|function/|chat/|analytics/|agent/|scripts/)'
# Automation paths: CI + the harness's own skills/hooks/settings.
AUTOMATION='^(\.github/|\.claude/)'
# Documentation content.
DOCS='^(docs/|README\.md|AGENTS\.md)'
# Doc/automation paths already touched — surfaced as "already updated" context so
# the review focuses on what's still likely stale. NOT used to silence the gate.
TOUCHED='^(docs/|README\.md|AGENTS\.md|\.github/|\.claude/)'

# Files in this branch's diff vs main + anything uncommitted.
changed=$(
  {
    git -C "$project" diff --name-only main...HEAD 2>/dev/null || true
    git -C "$project" status --porcelain 2>/dev/null | awk '{print $NF}'
  } | sort -u
)

code_changed=$(printf '%s\n' "$changed" | grep -E "$CODE" | head -20)
automation_changed=$(printf '%s\n' "$changed" | grep -E "$AUTOMATION" | head -20)
docs_changed=$(printf '%s\n' "$changed" | grep -E "$DOCS" | head -20)
touched=$(printf '%s\n' "$changed" | grep -E "$TOUCHED")
[ -z "$touched" ] && touched="(none yet)"

# Nothing doc-relevant, no automation, and no docs changed -> nothing to gate.
[ -z "$code_changed" ] && [ -z "$automation_changed" ] && [ -z "$docs_changed" ] && exit 0

# --- assemble the review prompt -------------------------------------------------
reason="WRAP-UP GATE — do a deliberate review before finishing. This gate fires once; spend it on real analysis, not a glance. Do NOT treat \"I already touched a file\" as done.

Changed on this branch (already updated; may be incomplete):
${touched}
"

if [ -n "$code_changed" ]; then
  reason="${reason}
CODE changed where docs commonly drift:
${code_changed}

Docs review:
1. Read the actual diff: \`git diff main...HEAD\` for the changed code above.
2. For EACH changed code area, name every doc surface that describes its behaviour, contract, shape, or flow. Hunt for drift: renamed/removed/added commands, endpoints, or config; changed request/response shapes or required fields; changed pipeline or deploy steps; changed env vars or file layout; now-wrong examples or diagrams.
3. Open each candidate doc and compare against the diff — do not infer from memory. Fix every doc that drifted.

Candidate doc homes:
- README.md — project overview + the Automation section
- docs/architecture.md — pipeline, MCP server, function, chat, deploy layers
- docs/deploy-scaleway.md — MCP container / Scaleway deploy
- docs/deploy-chat.md — chat website + function deploy
- AGENTS.md — agent rules + conventions (keep lean; rules not narrative)
"
fi

if [ -n "$docs_changed" ]; then
  reason="${reason}
DOCUMENTATION changed:
${docs_changed}

Open each changed doc above and read it against the actual diff — do not infer from memory. Fix any drift (renamed/removed commands or files, stale steps, wrong examples, broken links, out-of-date diagrams) before finishing.
"
fi

reason="${reason}
AUTOMATION + LEARNING review (ALWAYS do this, even if no code changed):
Did the diff above, OR anything you learned THIS session (a recurring failure, a guard gap, a confusing or missing step), make any of these wrong, incomplete, or worth clarifying? A session learning is reason enough to update one now:
- .claude/skills/ — workflow/process skills (e.g. dev-workflow)
- .claude/hooks/ + .claude/settings.json — session guards and automation
- .github/workflows/ — CI/CD and supply-chain pinning
- AGENTS.md — rules + pointers

Then report the result in ONE sentence — no heading, no bullet list: name what you updated and state the rest are unaffected, and ALWAYS include an explicit automation verdict (a skill/hook/workflow was updated, or all unaffected) so it is never silently dropped (e.g. \`Docs: docs/architecture.md updated; automation: dev-workflow skill updated; others unaffected.\`). The analysis must be real; only the written summary is compressed to that one sentence. You may finish once you have emitted it."

# Stop hooks use {decision:"block", reason} to keep the assistant going; the
# reason is fed back as context. systemMessage surfaces the gate to the user.
jq -n --arg r "$reason" '{ decision: "block", reason: $r, systemMessage: "Wrap-up gate: reviewing whether docs and .claude/.github automation need updating before finishing." }'
