import { describe, it, expect, vi } from "vitest";
import { runAgent } from "../src/agent.js";

describe("runAgent", () => {
  it("performs a tool call then returns a cited answer", async () => {
    const search = vi.fn(async (q: string) => ({
      text: "Source: https://docs.opencollective.com/open-source-europe\nSource Name: open-source-europe\nOSE is a Belgian association.",
      citations: [{ url: "https://docs.opencollective.com/open-source-europe", source_name: "open-source-europe" }],
    }));
    const mistralChat = vi
      .fn()
      // round 1: ask for a search
      .mockResolvedValueOnce({ content: null, tool_calls: [{ id: "t1", function: { name: "search_docs", arguments: JSON.stringify({ query: "what is OSE" }) } }] })
      // round 2: final answer
      .mockResolvedValueOnce({ content: "Open Source Europe is a Belgian association.", tool_calls: [] });

    const r = await runAgent({ persona: "P", userMessages: [{ role: "user", content: "what is OSE?" }], mistralChat, search });
    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith("what is OSE");
    expect(r.answer).toContain("Belgian association");
    expect(r.citations).toEqual([{ url: "https://docs.opencollective.com/open-source-europe", source_name: "open-source-europe" }]);
    expect(r.rounds).toBe(2);
  });

  it("returns directly when no tool call is requested", async () => {
    const search = vi.fn();
    const mistralChat = vi.fn().mockResolvedValueOnce({ content: "Hello!", tool_calls: [] });
    const r = await runAgent({ persona: "P", userMessages: [{ role: "user", content: "hi" }], mistralChat, search });
    expect(search).not.toHaveBeenCalled();
    expect(r.answer).toBe("Hello!");
    expect(r.citations).toEqual([]);
  });
});
