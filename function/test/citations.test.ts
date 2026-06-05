import { describe, it, expect } from "vitest";
import { parseCitations, type PageMap } from "../src/mcp.js";

const MCP_TEXT = `Found 2 results:

Result 1:
Source: https://docs.opencollective.com/open-source-europe
Source Name: open-source-europe
Type: list_item
Chunk ID: aaa111
Metadata:
  Location: Terms of Service
Content:
# Terms of Service
Some terms text.

Result 2:
Source: https://docs.opencollective.com/oc-europe-internal-doc
Source Name: oc-europe-internal-doc
Type: section
Chunk ID: bbb222
Content:
Some internal text.
`;

const PAGE_MAP: PageMap = {
  aaa111: {
    url: "https://docs.opencollective.com/open-source-europe/terms-of-service",
    title: "Terms of Service",
  },
};

describe("parseCitations", () => {
  it("maps a chunk to its specific page URL and title via the page map", () => {
    const citations = parseCitations(MCP_TEXT, PAGE_MAP);
    expect(citations[0]).toEqual({
      url: "https://docs.opencollective.com/open-source-europe/terms-of-service",
      source_name: "open-source-europe",
      title: "Terms of Service",
    });
  });

  it("falls back to the source root URL when the chunk is not in the page map", () => {
    const citations = parseCitations(MCP_TEXT, PAGE_MAP);
    expect(citations[1]).toEqual({
      url: "https://docs.opencollective.com/oc-europe-internal-doc",
      source_name: "oc-europe-internal-doc",
    });
  });

  it("de-duplicates citations pointing at the same URL", () => {
    const twice = MCP_TEXT + MCP_TEXT.replace("Result 1", "Result 3").replace("Result 2", "Result 4");
    const citations = parseCitations(twice, PAGE_MAP);
    expect(citations).toHaveLength(2);
  });

  it("works without a page map (root URLs only)", () => {
    const citations = parseCitations(MCP_TEXT, {});
    expect(citations.map((c) => c.url)).toEqual([
      "https://docs.opencollective.com/open-source-europe",
      "https://docs.opencollective.com/oc-europe-internal-doc",
    ]);
  });
});
