import { Mistral } from "@mistralai/mistralai";
import { runAgent, type ChatMessage } from "./agent.js";
import { searchDocs } from "./mcp.js";
import { PERSONA } from "./persona.generated.js";
import { PAGE_MAP } from "./pagemap.generated.js";

export interface ChatRequest { messages: ChatMessage[]; analyticsOptIn?: boolean; }
export interface Env { MISTRAL_API_KEY: string; MISTRAL_MODEL?: string; MISTRAL_BASE_URL?: string; OSE_MCP_URL: string; MAX_TOOL_ROUNDS?: string; }

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
    const r = await client.chat.complete({ model, messages, tools, toolChoice: "auto", temperature: 0.2 });
    const choice = r.choices?.[0]?.message;
    return {
      content: (choice?.content as string) ?? null,
      tool_calls: (choice?.toolCalls ?? []).map((t: any) => ({ id: t.id, function: { name: t.function.name, arguments: t.function.arguments } })),
    };
  };

  const result = await runAgent({
    persona: PERSONA,
    userMessages,
    mistralChat,
    search: (q) => searchDocs(q, env.OSE_MCP_URL, PAGE_MAP),
    maxRounds: env.MAX_TOOL_ROUNDS ? parseInt(env.MAX_TOOL_ROUNDS, 10) : 4,
  });

  // Opt-in, anonymous: only the query text + timestamp, no IP/PII. Lands in Scaleway Cockpit (EU).
  if (body.analyticsOptIn && lastUser) {
    console.log(`ANALYTICS ${JSON.stringify({ q: lastUser.content.slice(0, 500), rounds: result.rounds })}`);
  }

  return { status: 200, json: { answer: result.answer, citations: result.citations } };
}
