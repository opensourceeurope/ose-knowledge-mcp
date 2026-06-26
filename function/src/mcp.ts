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
export type PageMap = Record<string, { url: string; title: string }>;

// Resolve a single "Result N:" body block into its citation. Each block carries
// Source (root docs URL), Source Name and Chunk ID; when the chunk is in the page
// map (chunk_id -> specific doc page), cite that page instead of the source root.
function citationFromBlock(block: string, pageMap: PageMap): Citation | null {
  const rootUrl = block.match(/^Source:\s*(\S+)/m)?.[1];
  const sourceName = block.match(/^Source Name:\s*([^\n]+)/m)?.[1]?.trim();
  if (!rootUrl || !sourceName) return null;
  const chunkId = block.match(/^Chunk ID:\s*(\S+)/m)?.[1];
  const page = chunkId ? pageMap[chunkId] : undefined;
  return page
    ? { url: page.url, source_name: sourceName, title: page.title }
    : { url: rootUrl, source_name: sourceName };
}

// Parse the search_docs result text into a de-duplicated citation list.
export function parseCitations(text: string, pageMap: PageMap = {}): Citation[] {
  const citations: Citation[] = [];
  for (const block of text.split(/^Result \d+:/m).slice(1)) {
    const c = citationFromBlock(block, pageMap);
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
  pageMap: PageMap,
  reg: CiteRegistry
): { text: string; citations: NumberedCitation[] } {
  // split keeps the "Result N:" headers as their own array entries
  const parts = text.split(/^(Result \d+:)/m);
  let out = parts[0] ?? "";
  for (let i = 1; i < parts.length; i += 2) {
    const header = parts[i];
    const body = parts[i + 1] ?? "";
    const c = citationFromBlock(body, pageMap);
    out += c
      ? `${header} [cite this source inline as [${assignNumber(reg, c)}]]${body}`
      : header + body;
  }
  return { text: out, citations: reg.list.slice() };
}

export async function searchDocs(query: string, mcpUrl: string, pageMap: PageMap = {}): Promise<SearchResult> {
  const client = new Client({ name: "ose-chat", version: "0.1.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
  await client.connect(transport);
  try {
    const res: any = await client.callTool({ name: SEARCH_TOOL, arguments: { query } });
    const text = (res.content ?? [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    return { text, citations: parseCitations(text, pageMap) };
  } finally {
    await client.close();
  }
}
