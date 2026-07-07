import { describe, it, expect } from "vitest";
import { parseCitations, annotateAndNumber, newRegistry } from "../src/mcp.js";

// opencrane's search_docs emits the specific documentation page URL on the
// "Source:" line (from the chunk's metadata.source_url), plus a Metadata
// "Location:" breadcrumb we turn into the citation title.
const MCP_TEXT = `Found 2 results:

Result 1:
Source: https://docs.opencollective.com/open-source-europe/terms-of-service
Source Name: open-source-europe
Type: list_item
Chunk ID: aaa111
Metadata:
  Location: Terms of Service > Payouts > Legal Status
Content:
# Terms of Service
Some terms text.

Result 2:
Source: https://docs.opencollective.com/oc-europe-internal-doc/the-foundation
Source Name: oc-europe-internal-doc
Type: section
Chunk ID: bbb222
Content:
Some internal text.
`;

describe("parseCitations", () => {
  it("cites the specific page URL and derives the title from the breadcrumb's last segment", () => {
    const citations = parseCitations(MCP_TEXT);
    expect(citations[0]).toEqual({
      url: "https://docs.opencollective.com/open-source-europe/terms-of-service",
      source_name: "open-source-europe",
      title: "Legal Status",
    });
  });

  it("omits the title when the block has no Location breadcrumb", () => {
    const citations = parseCitations(MCP_TEXT);
    expect(citations[1]).toEqual({
      url: "https://docs.opencollective.com/oc-europe-internal-doc/the-foundation",
      source_name: "oc-europe-internal-doc",
    });
  });

  it("de-duplicates citations pointing at the same URL", () => {
    const twice = MCP_TEXT + MCP_TEXT.replace("Result 1", "Result 3").replace("Result 2", "Result 4");
    const citations = parseCitations(twice);
    expect(citations).toHaveLength(2);
  });
});

describe("annotateAndNumber", () => {
  it("assigns sequential numbers and tags each result block with its marker", () => {
    const reg = newRegistry();
    const { text, citations } = annotateAndNumber(MCP_TEXT, reg);
    expect(text).toContain("Result 1: [cite this source inline as [1]]");
    expect(text).toContain("Result 2: [cite this source inline as [2]]");
    expect(citations.map((c) => c.n)).toEqual([1, 2]);
    expect(citations[0]).toMatchObject({ n: 1, title: "Legal Status" });
  });

  it("keeps a URL's number stable across rounds and never re-numbers it", () => {
    const reg = newRegistry();
    annotateAndNumber(MCP_TEXT, reg); // round 1: assigns [1], [2]
    // round 2: a fresh source URL plus the same internal-doc URL seen in round 1
    const round2 = MCP_TEXT.replace(
      "https://docs.opencollective.com/open-source-europe/terms-of-service",
      "https://docs.opencollective.com/open-source-europe/code-of-conduct"
    );
    const { text, citations } = annotateAndNumber(round2, reg);
    // the repeated internal-doc URL keeps [2]; the new page gets [3]
    expect(text).toContain("[cite this source inline as [3]]");
    expect(text).toContain("[cite this source inline as [2]]");
    expect(citations.map((c) => c.n)).toEqual([1, 2, 3]);
    expect(
      citations.filter((c) => c.url === "https://docs.opencollective.com/oc-europe-internal-doc/the-foundation")
    ).toHaveLength(1);
  });

  it("leaves malformed blocks untouched (no marker, no number)", () => {
    const reg = newRegistry();
    const malformed = "Found 1 results:\n\nResult 1:\nType: section\nContent:\nNo source here.\n";
    const { text, citations } = annotateAndNumber(malformed, reg);
    expect(text).not.toContain("cite this source inline");
    expect(citations).toHaveLength(0);
  });
});
