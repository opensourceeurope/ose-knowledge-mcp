import asyncio, os, sys
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

BASE = os.environ.get("MCP_URL", "http://localhost:8000")
CANDIDATES = [BASE.rstrip("/") + p for p in ("/mcp", "/mcp/", "/")]
QUERY = "What is Open Source Europe?"

async def try_url(url: str) -> int:
    async with streamablehttp_client(url) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = (await session.list_tools()).tools
            names = [t.name for t in tools]
            print(f"CONNECTED {url} TOOLS={names}")
            assert "search_docs" in names, f"search_docs not exposed at {url}"
            result = await session.call_tool("search_docs", {"query": QUERY})
            text = "\n".join(getattr(c, "text", "") for c in result.content if getattr(c, "text", ""))
            print("RESULT (first 400 chars):\n", text[:400])
            assert text.strip(), "empty result"
            assert ("open source" in text.lower() or "opensource" in text.lower()
                    or "opencollective" in text.lower()), "result did not reference OSE docs"
            print("HTTP SMOKE TEST PASSED")
            return 0

async def main() -> int:
    last = None
    for url in CANDIDATES:
        try:
            return await try_url(url)
        except Exception as e:
            last = e
            print(f"  (failed at {url}: {e})")
    print("ALL CANDIDATE PATHS FAILED:", last)
    return 1

if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
