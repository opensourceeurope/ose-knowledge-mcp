import { Mistral } from "@mistralai/mistralai";
import { runAgent, type ChatMessage } from "./agent.js";
import { searchDocs, annotateAndNumber, newRegistry } from "./mcp.js";
import { PERSONA } from "./persona.generated.js";
import { PAGE_MAP } from "./pagemap.generated.js";

// Chat-only addendum to the shared persona. The web UI renders the numbered
// source list separately below the answer, so the model must cite with bracket
// markers instead of writing its own "Source:" lines (which would duplicate the
// UI and break formatting). The canonical persona is left untouched for the
// terminal plugin agent, which has no such UI and cites sources inline.
const CHAT_CITATION_DIRECTIVE = `

## Answering in the chat UI

Your answer is shown in a web interface that renders the numbered list of sources
on its own, directly below your message. Follow these rules so nothing is duplicated:

- Do NOT write "Source:" lines, raw URLs, or a "Sources"/"References" list in your
  answer. The interface adds them.
- Each search result is tagged "[cite this source inline as [N]]". When a statement
  relies on a result, append its marker — e.g. "Open Collective Europe pays out within
  7 days [1]." Use the exact number you were given.
- Combine markers when several sources back one statement: "...within 7 days [1][3]."
- Write clean prose and markdown only. No trailing separators such as "--".`;

export interface ChatRequest { messages: ChatMessage[]; analyticsOptIn?: boolean; }
export interface Env { MISTRAL_API_KEY: string; MISTRAL_MODEL?: string; MISTRAL_BASE_URL?: string; OSE_MCP_URL: string; MAX_TOOL_ROUNDS?: string; }

// Translate the agent's neutral message shape into the camelCase form the Mistral
// SDK request schema expects. The SDK validates request messages with Zod and
// silently strips unknown keys, so a snake_case `tool_calls` / `tool_call_id`
// would be dropped — sending the assistant tool-call turn with no tool calls and
// triggering a 400 ("Assistant message must have either content or tool_calls").
export function toMistralMessages(messages: any[]): any[] {
  return messages.map((m) => {
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      return {
        role: "assistant",
        content: m.content ?? "",
        toolCalls: m.tool_calls.map((tc: any) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      };
    }
    if (m.role === "tool") {
      return { role: "tool", name: m.name, toolCallId: m.tool_call_id, content: m.content };
    }
    return m;
  });
}

export async function handleChat(body: ChatRequest, env: Env) {
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return { status: 400, json: { error: "messages[] required" } };
  }
  // keep only user/assistant turns from the client; cap history
  const userMessages = body.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-12);
  const lastUser = [...userMessages].reverse().find((m) => m.role === "user");

  const client = new Mistral({
    apiKey: env.MISTRAL_API_KEY,
    ...(env.MISTRAL_BASE_URL ? { serverURL: env.MISTRAL_BASE_URL } : {}),
  });
  const model = env.MISTRAL_MODEL || "mistral-small-latest";

  const mistralChat = async (messages: any[], tools: any[]) => {
    const r = await client.chat.complete({ model, messages: toMistralMessages(messages), tools, toolChoice: "auto", temperature: 0.2 });
    const choice = r.choices?.[0]?.message;
    return {
      content: (choice?.content as string) ?? null,
      tool_calls: (choice?.toolCalls ?? []).map((t: any) => ({ id: t.id, function: { name: t.function.name, arguments: t.function.arguments } })),
    };
  };

  // One registry per turn: footnote numbers stay stable across every search round.
  const registry = newRegistry();

  const result = await runAgent({
    persona: PERSONA + CHAT_CITATION_DIRECTIVE,
    userMessages,
    mistralChat,
    search: async (q) => {
      const { text } = await searchDocs(q, env.OSE_MCP_URL, PAGE_MAP);
      return annotateAndNumber(text, PAGE_MAP, registry);
    },
    maxRounds: env.MAX_TOOL_ROUNDS ? parseInt(env.MAX_TOOL_ROUNDS, 10) : 4,
  });

  // Opt-in, anonymous: only the query text + timestamp, no IP/PII. Lands in Scaleway Cockpit (EU).
  if (body.analyticsOptIn && lastUser) {
    console.log(`ANALYTICS ${JSON.stringify({ q: lastUser.content.slice(0, 500), rounds: result.rounds })}`);
  }

  return { status: 200, json: { answer: result.answer, citations: result.citations } };
}
