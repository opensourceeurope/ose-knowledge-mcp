import { describe, it, expect } from "vitest";
import { parseCitations, annotateAndNumber, newRegistry, type PageMap } from "../src/mcp.js";

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

describe("annotateAndNumber", () => {
  it("assigns sequential numbers and tags each result block with its marker", () => {
    const reg = newRegistry();
    const { text, citations } = annotateAndNumber(MCP_TEXT, PAGE_MAP, reg);
    expect(text).toContain("Result 1: [cite this source inline as [1]]");
    expect(text).toContain("Result 2: [cite this source inline as [2]]");
    expect(citations.map((c) => c.n)).toEqual([1, 2]);
    expect(citations[0]).toMatchObject({ n: 1, title: "Terms of Service" });
  });

  it("keeps a URL's number stable across rounds and never re-numbers it", () => {
    const reg = newRegistry();
    annotateAndNumber(MCP_TEXT, PAGE_MAP, reg); // round 1: assigns [1], [2]
    // round 2: a fresh source plus the same internal-doc URL seen in round 1
    const round2 = MCP_TEXT
      .replace("Result 1:", "Result 1:")
      .replace("https://docs.opencollective.com/open-source-europe\nSource Name: open-source-europe\nType: list_item\nChunk ID: aaa111", "https://docs.opencollective.com/open-source-europe\nSource Name: open-source-europe\nType: section\nChunk ID: ccc333");
    const { text, citations } = annotateAndNumber(round2, PAGE_MAP, reg);
    // the repeated internal-doc URL keeps [2]; the new chunk gets [3]
    expect(text).toContain("[cite this source inline as [3]]");
    expect(text).toContain("[cite this source inline as [2]]");
    expect(citations.map((c) => c.n)).toEqual([1, 2, 3]);
    expect(citations.filter((c) => c.url === "https://docs.opencollective.com/oc-europe-internal-doc")).toHaveLength(1);
  });

  it("leaves malformed blocks untouched (no marker, no number)", () => {
    const reg = newRegistry();
    const malformed = "Found 1 results:\n\nResult 1:\nType: section\nContent:\nNo source here.\n";
    const { text, citations } = annotateAndNumber(malformed, PAGE_MAP, reg);
    expect(text).not.toContain("cite this source inline");
    expect(citations).toHaveLength(0);
  });
});
