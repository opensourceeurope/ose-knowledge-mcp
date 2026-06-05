import { toolSchema, type Citation } from "./mcp.js";

export interface ChatMessage { role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; name?: string; }
export interface ToolCall { id: string; function: { name: string; arguments: string }; }
export interface MistralResponse { content: string | null; tool_calls?: ToolCall[]; }
export type MistralChat = (messages: any[], tools: any[]) => Promise<MistralResponse>;
export type SearchFn = (query: string) => Promise<{ text: string; citations: Citation[] }>;

export interface AgentResult { answer: string; citations: Citation[]; rounds: number; }

export async function runAgent(opts: {
  persona: string;
  userMessages: ChatMessage[];
  mistralChat: MistralChat;
  search: SearchFn;
  maxRounds?: number;
}): Promise<AgentResult> {
  const { persona, userMessages, mistralChat, search } = opts;
  const maxRounds = opts.maxRounds ?? 4;
  const messages: any[] = [{ role: "system", content: persona }, ...userMessages];
  const citations: Citation[] = [];

  for (let round = 1; round <= maxRounds; round++) {
    const res = await mistralChat(messages, [toolSchema]);
    if (res.tool_calls && res.tool_calls.length > 0) {
      messages.push({ role: "assistant", content: res.content ?? "", tool_calls: res.tool_calls });
      for (const tc of res.tool_calls) {
        let query = "";
        try { query = JSON.parse(tc.function.arguments).query ?? ""; } catch { /* ignore */ }
        const r = await search(query);
        citations.push(...r.citations);
        messages.push({ role: "tool", name: tc.function.name, tool_call_id: tc.id, content: r.text });
      }
      continue;
    }
    // de-dup citations by url
    const seen = new Set<string>();
    const deduped = citations.filter((c) => c.url && !seen.has(c.url) ? (seen.add(c.url), true) : false);
    return { answer: res.content ?? "", citations: deduped, rounds: round };
  }
  return { answer: "I couldn't complete the search in time. Please rephrase your question.", citations, rounds: maxRounds };
}
