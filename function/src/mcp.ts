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
export interface SearchResult { text: string; citations: Citation[]; }
export type PageMap = Record<string, { url: string; title: string }>;

// Parse the search_docs result text into citations. Each "Result N:" block
// carries Source (root docs URL), Source Name and Chunk ID; when the chunk is
// in the page map (chunk_id -> specific doc page), cite that page instead of
// the source root.
export function parseCitations(text: string, pageMap: PageMap = {}): Citation[] {
  const citations: Citation[] = [];
  for (const block of text.split(/^Result \d+:/m).slice(1)) {
    const rootUrl = block.match(/^Source:\s*(\S+)/m)?.[1];
    const sourceName = block.match(/^Source Name:\s*([^\n]+)/m)?.[1]?.trim();
    if (!rootUrl || !sourceName) continue;
    const chunkId = block.match(/^Chunk ID:\s*(\S+)/m)?.[1];
    const page = chunkId ? pageMap[chunkId] : undefined;
    citations.push(
      page
        ? { url: page.url, source_name: sourceName, title: page.title }
        : { url: rootUrl, source_name: sourceName }
    );
  }
  const seen = new Set<string>();
  return citations.filter((c) => (c.url && !seen.has(c.url)) ? (seen.add(c.url), true) : false);
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
