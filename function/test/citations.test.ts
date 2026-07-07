import { describe, it, expect } from "vitest";
import { parseCitations, annotateAndNumber, newRegistry } from "../src/mcp.js";

// opencrane's search_docs emits the documentation page URL on the "Source:" line
// (from metadata.source_url), a Metadata "Location:" breadcrumb (turned into a
// "Page – Section" title), and — for sub-section chunks — a "Section Anchor:"
// slug we append to the URL so citations link to the exact section.
const MCP_TEXT = `Found 2 results:

Result 1:
Source: https://docs.opencollective.com/open-source-europe/terms-of-service
Source Name: open-source-europe
Type: list_item
Chunk ID: aaa111
Metadata:
  Location: Terms of Service > Payouts > Legal Status
  Section Anchor: legal-status (link to this section as Source#legal-status)
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
  it("links to the exact section (source_url#anchor) with a Page – Section title", () => {
    const citations = parseCitations(MCP_TEXT);
    expect(citations[0]).toEqual({
      url: "https://docs.opencollective.com/open-source-europe/terms-of-service#legal-status",
      source_name: "open-source-europe",
      title: "Terms of Service – Legal Status",
    });
  });

  it("falls back to the plain page URL and no title without breadcrumb/anchor", () => {
    const citations = parseCitations(MCP_TEXT);
    expect(citations[1]).toEqual({
      url: "https://docs.opencollective.com/oc-europe-internal-doc/the-foundation",
      source_name: "oc-europe-internal-doc",
    });
  });

  it("strips leading emoji from the section in the label", () => {
    const text = `Result 1:
Source: https://x/donate
Source Name: ose
Metadata:
  Location: Contributions in cryptocurrencies > ✅ Eligibility Requirements
  Section Anchor: eligibility-requirements
Content:
text
`;
    expect(parseCitations(text)[0]).toEqual({
      url: "https://x/donate#eligibility-requirements",
      source_name: "ose",
      title: "Contributions in cryptocurrencies – Eligibility Requirements",
    });
  });

  it("collapses a single-segment breadcrumb to just the page title", () => {
    const text = `Result 1:
Source: https://x/overview
Source Name: ose
Metadata:
  Location: Overview
Content:
text
`;
    expect(parseCitations(text)[0]).toMatchObject({ url: "https://x/overview", title: "Overview" });
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
    expect(citations[0]).toMatchObject({ n: 1, title: "Terms of Service – Legal Status" });
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

  it("strips raw Source URLs + Section Anchor lines from the model-facing text, keeping Source Name and citations", () => {
    const reg = newRegistry();
    const { text, citations } = annotateAndNumber(MCP_TEXT, reg);
    // The model must not see raw URLs — that is what it echoes into a duplicate
    // "Sources:" list. Both the Source: and Section Anchor: lines are gone.
    expect(text).not.toMatch(/^\s*Source:\s*https?:\/\//m);
    expect(text).not.toMatch(/^\s*Section Anchor:/m);
    expect(text).not.toContain("https://docs.opencollective.com");
    // The human-readable name, the [N] marker, and the parsed (deep-linked)
    // chip citations all survive.
    expect(text).toContain("Source Name: open-source-europe");
    expect(text).toContain("[cite this source inline as [1]]");
    expect(citations[0].url).toBe(
      "https://docs.opencollective.com/open-source-europe/terms-of-service#legal-status"
    );
  });
});
