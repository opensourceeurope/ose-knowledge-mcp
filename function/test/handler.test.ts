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

import { handleChat, toMistralMessages, stripTrailingSourceList } from "../src/handler.js";

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

describe("stripTrailingSourceList (chat UI renders the source chips itself)", () => {
  it("removes a trailing 'Sources:' list of raw URLs the model echoed", () => {
    const answer = [
      "Open Source Europe manages philanthropic funds [1][2].",
      "",
      "Sources:",
      "1. https://docs.opencollective.com/open-source-europe/about-open-source-europe",
      "2. https://docs.opencollective.com/open-source-europe/master",
    ].join("\n");
    expect(stripTrailingSourceList(answer)).toBe(
      "Open Source Europe manages philanthropic funds [1][2]."
    );
  });

  it("handles a markdown '## References' heading and markdown-link items", () => {
    const answer = "Body text [1].\n\n## References\n- [OSE](https://x/a)\n- <https://x/b>";
    expect(stripTrailingSourceList(answer)).toBe("Body text [1].");
  });

  it("strips a header-less trailing dump of bare URLs", () => {
    const answer = "Answer [1].\n\nhttps://x/a\nhttps://x/b";
    expect(stripTrailingSourceList(answer)).toBe("Answer [1].");
  });

  it("leaves a normal answer (inline [N] markers, mid-sentence URL) untouched", () => {
    const answer = "OSE pays out within 7 days [1]. See more at https://x/a in the handbook.";
    expect(stripTrailingSourceList(answer)).toBe(answer);
  });

  it("does not strip a mid-answer heading that merely contains the word 'Sources'", () => {
    const answer = "## Sources of funding\nOSE manages philanthropic funds [1].";
    expect(stripTrailingSourceList(answer)).toBe(answer);
  });
});
