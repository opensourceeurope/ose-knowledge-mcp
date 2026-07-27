---
name: ask-about-ose
description: Use for ANY question about Open Source Europe (OSE) — fiscal hosting, onboarding, joining a collective, expenses, payouts, governance, policies, or internal operations. If the user mentions OSE or Open Source Europe, this skill applies. Do NOT trigger on a mention of Open Collective Europe (OCE) alone — that is a different organization.
---

# Ask about OSE

Answer Open Source Europe (OSE) questions through the researcher agent. Never call the `search_docs` MCP tool directly in the main conversation — the agent exists to keep large MCP responses out of the main context.

1. Dispatch the `ose-knowledge:ose-researcher` agent via the Agent tool. Pass the user's question verbatim, plus any conversation context needed to make the question self-contained.
2. Relay the agent's findings together with their source names and URLs. If the agent reports the docs don't cover the question, say exactly that — never fill the gap with a guess.
