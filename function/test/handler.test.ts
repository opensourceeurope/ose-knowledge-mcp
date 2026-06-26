import { describe, it, expect, vi } from "vitest";

const captured = vi.hoisted(() => ({ ctorOpts: [] as any[] }));
vi.mock("@mistralai/mistralai", () => ({
  Mistral: class {
    chat = {
      complete: async () => ({ choices: [{ message: { content: "ok", toolCalls: [] } }] }),
    };
    constructor(opts: any) {
      captured.ctorOpts.push(opts);
    }
  },
}));

import { handleChat, toMistralMessages } from "../src/handler.js";

describe("toMistralMessages (Mistral API wire format)", () => {
  // Regression: the Mistral SDK request schema expects camelCase toolCalls /
  // toolCallId and silently strips unknown keys. Sending snake_case made the
  // assistant tool-call turn go out with no tool calls -> Mistral 400
  // "Assistant message must have either content or tool_calls, but not none."
  it("maps an assistant tool-call turn + tool result to the camelCase shape the SDK expects", () => {
    const out = toMistralMessages([
      { role: "system", content: "P" },
      { role: "user", content: "what is OSE?" },
      { role: "assistant", content: "", tool_calls: [{ id: "t1", function: { name: "search_docs", arguments: '{"query":"OSE"}' } }] },
      { role: "tool", name: "search_docs", tool_call_id: "t1", content: "Result 1: ..." },
    ]);

    expect(out[0]).toEqual({ role: "system", content: "P" });
    expect(out[1]).toEqual({ role: "user", content: "what is OSE?" });

    const assistant: any = out[2];
    expect(assistant.toolCalls).toEqual([
      { id: "t1", type: "function", function: { name: "search_docs", arguments: '{"query":"OSE"}' } },
    ]);
    expect(assistant).not.toHaveProperty("tool_calls");

    const tool: any = out[3];
    expect(tool.toolCallId).toBe("t1");
    expect(tool).not.toHaveProperty("tool_call_id");
  });
});

describe("handleChat validation", () => {
  it("rejects empty messages", async () => {
    const out = await handleChat({ messages: [] } as any, {} as any);
    expect(out.status).toBe(400);
  });
});

describe("handleChat Mistral client config", () => {
  it("passes MISTRAL_BASE_URL to the client as serverURL", async () => {
    captured.ctorOpts.length = 0;
    await handleChat(
      { messages: [{ role: "user", content: "hi" }] },
      { MISTRAL_API_KEY: "k", OSE_MCP_URL: "http://x", MISTRAL_BASE_URL: "http://localhost:11434" } as any
    );
    expect(captured.ctorOpts[0]).toMatchObject({ apiKey: "k", serverURL: "http://localhost:11434" });
  });

  it("omits serverURL when MISTRAL_BASE_URL is unset", async () => {
    captured.ctorOpts.length = 0;
    await handleChat(
      { messages: [{ role: "user", content: "hi" }] },
      { MISTRAL_API_KEY: "k", OSE_MCP_URL: "http://x" } as any
    );
    expect(captured.ctorOpts[0]).not.toHaveProperty("serverURL");
  });
});
