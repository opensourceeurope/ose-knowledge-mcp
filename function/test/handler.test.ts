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

import { handleChat } from "../src/handler.js";

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
