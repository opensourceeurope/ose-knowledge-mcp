import { describe, it, expect } from "vitest";
import { searchDocs } from "../src/mcp.js";

const URL = process.env.OSE_MCP_URL;
const maybe = URL ? describe : describe.skip;

maybe("searchDocs (live MCP)", () => {
  it("returns OSE content with a citation", async () => {
    const r = await searchDocs("What is Open Source Europe?", URL!);
    expect(r.text.toLowerCase()).toMatch(/open source|opencollective/);
    expect(r.citations.length).toBeGreaterThan(0);
    expect(r.citations[0].url).toContain("opencollective.com");
  }, 30000);
});
