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

// Build a "Page – Section" chip label from the Metadata "Location:" breadcrumb
// (e.g. "About Open Source Europe > Who We Serve" -> "About Open Source Europe –
// Who We Serve"). Leading emoji/symbols are stripped from each segment; a
// page-level breadcrumb collapses to just the page title.
function titleFromBreadcrumb(location?: string): string | undefined {
  if (!location) return undefined;
  const clean = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  const segments = location.split(">").map(clean).filter(Boolean);
  if (segments.length === 0) return undefined;
  const page = segments[0];
  const section = segments[segments.length - 1];
  return section !== page ? `${page} – ${section}` : page;
}

// Resolve a single "Result N:" body block into its citation. Each block carries
// Source (the documentation page URL, from the chunk's metadata.source_url) and
// Source Name. opencrane also emits a "Section Anchor:" slug for sub-section
// chunks; when present we link to the exact section as source_url#anchor,
// otherwise the plain page. The chip label is the breadcrumb's "Page – Section".
function citationFromBlock(block: string): Citation | null {
  const pageUrl = block.match(/^Source:\s*(\S+)/m)?.[1];
  const sourceName = block.match(/^Source Name:\s*([^\n]+)/m)?.[1]?.trim();
  if (!pageUrl || !sourceName) return null;
  const anchor = block.match(/^\s*Section Anchor:\s*(\S+)/m)?.[1];
  const url = anchor ? `${pageUrl}#${anchor}` : pageUrl;
  const location = block.match(/^\s*Location:\s*([^\n]+)/m)?.[1]?.trim();
  const title = titleFromBreadcrumb(location);
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

// Drop the raw "Source:" URL and "Section Anchor:" lines from a result body
// before it is shown to the model. The citation has already been parsed off them
// (into the numbered chip list the UI renders), and the model cites with the [N]
// tag — it never needs the raw URL. Leaving URLs in the tool text tempts the model
// into echoing them as a "Sources:" list that duplicates the UI (the exact
// duplication CHAT_CITATION_DIRECTIVE tries to prevent). "Source Name:" and
// "Location:" stay — they carry no raw URL and help the model attribute inline.
function stripSourceUrls(body: string): string {
  return body
    .split("\n")
    .filter((line) => !/^\s*Source:\s*\S/.test(line) && !/^\s*Section Anchor:\s*\S/.test(line))
    .join("\n");
}

// Tag each "Result N:" block in the search text with the stable footnote number
// of its source, so the model can place matching [N] markers in its prose, and
// strip the raw source URLs from what the model sees (see stripSourceUrls).
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
      ? `${header} [cite this source inline as [${assignNumber(reg, c)}]]${stripSourceUrls(body)}`
      : header + stripSourceUrls(body);
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
