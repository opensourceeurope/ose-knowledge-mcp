import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const SEARCH_TOOL = "search_docs";

export const toolSchema = {
  type: "function" as const,
  function: {
    name: SEARCH_TOOL,
    description:
      "Search the Open Source Europe documentation knowledge base. Returns relevant doc chunks with their source name and URL. Use this for every factual question about OSE.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
      },
      required: ["query"],
    },
  },
};

export interface Citation { source_name?: string; url?: string; title?: string; }
export interface NumberedCitation extends Citation { n: number; }
export interface SearchResult { text: string; citations: Citation[]; }

// Resolve a single "Result N:" body block into its citation. Each block carries
// Source (the specific documentation page URL, emitted by opencrane from the
// chunk's metadata.source_url) and Source Name. When a Metadata "Location:"
// breadcrumb is present we use its most specific (last) segment as the citation
// title, so the chat UI can label the chip with a human-readable page/section
// name instead of the source slug.
function citationFromBlock(block: string): Citation | null {
  const url = block.match(/^Source:\s*(\S+)/m)?.[1];
  const sourceName = block.match(/^Source Name:\s*([^\n]+)/m)?.[1]?.trim();
  if (!url || !sourceName) return null;
  const location = block.match(/^\s*Location:\s*([^\n]+)/m)?.[1]?.trim();
  const title = location?.split(">").pop()?.trim() || undefined;
  return title
    ? { url, source_name: sourceName, title }
    : { url, source_name: sourceName };
}

// Parse the search_docs result text into a de-duplicated citation list.
export function parseCitations(text: string): Citation[] {
  const citations: Citation[] = [];
  for (const block of text.split(/^Result \d+:/m).slice(1)) {
    const c = citationFromBlock(block);
    if (c) citations.push(c);
  }
  const seen = new Set<string>();
  return citations.filter((c) => (c.url && !seen.has(c.url)) ? (seen.add(c.url), true) : false);
}

// A request-scoped registry that assigns each distinct source URL a stable
// footnote number, shared across every search round in one conversation turn.
export interface CiteRegistry { byUrl: Map<string, NumberedCitation>; list: NumberedCitation[]; }
export function newRegistry(): CiteRegistry { return { byUrl: new Map(), list: [] }; }

function assignNumber(reg: CiteRegistry, c: Citation): number {
  const existing = c.url ? reg.byUrl.get(c.url) : undefined;
  if (existing) return existing.n;
  const numbered: NumberedCitation = { ...c, n: reg.list.length + 1 };
  reg.list.push(numbered);
  if (c.url) reg.byUrl.set(c.url, numbered);
  return numbered.n;
}

// Tag each "Result N:" block in the search text with the stable footnote number
// of its source, so the model can place matching [N] markers in its prose.
// Returns the annotated text plus the registry's current numbered citations.
export function annotateAndNumber(
  text: string,
  reg: CiteRegistry
): { text: string; citations: NumberedCitation[] } {
  // split keeps the "Result N:" headers as their own array entries
  const parts = text.split(/^(Result \d+:)/m);
  let out = parts[0] ?? "";
  for (let i = 1; i < parts.length; i += 2) {
    const header = parts[i];
    const body = parts[i + 1] ?? "";
    const c = citationFromBlock(body);
    out += c
      ? `${header} [cite this source inline as [${assignNumber(reg, c)}]]${body}`
      : header + body;
  }
  return { text: out, citations: reg.list.slice() };
}

export async function searchDocs(query: string, mcpUrl: string): Promise<SearchResult> {
  const client = new Client({ name: "ose-chat", version: "0.1.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
  await client.connect(transport);
  try {
    const res: any = await client.callTool({ name: SEARCH_TOOL, arguments: { query } });
    const text = (res.content ?? [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    return { text, citations: parseCitations(text) };
  } finally {
    await client.close();
  }
}
