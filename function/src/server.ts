import { createServer } from "node:http";
import { handleChat, type Env } from "./handler.js";
import { isOriginAllowed } from "./origin.js";

const env = process.env as unknown as Env;
const allowed = process.env.ALLOWED_ORIGINS || "*";
// Generous cap for 12 chat turns; the handler trims history anyway.
const MAX_BODY_BYTES = 128 * 1024;

function cors(res: any, origin: string | undefined) {
  if (allowed === "*") {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && isOriginAllowed(origin, allowed)) {
    // Echo only an allowlisted origin; disallowed origins get no ACAO header.
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}

const server = createServer((req, res) => {
  const origin = req.headers.origin;
  cors(res, origin);
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  // Enforce the allowlist server-side, not only via CORS headers — CORS by
  // itself never blocks a request, it only limits what cross-origin JS can
  // read. Note: non-browser clients can forge the Origin header, so this stops
  // all browser-based abuse and casual scripts; platform-level rate limiting
  // remains the backstop against determined direct callers (see docs/deploy-chat.md).
  if (!isOriginAllowed(origin, allowed)) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "origin_not_allowed" }));
    return;
  }
  let data = "";
  let size = 0;
  let tooLarge = false;
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BODY_BYTES) {
      if (!tooLarge) {
        tooLarge = true;
        res.writeHead(413, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "payload_too_large" }));
        req.destroy();
      }
      return;
    }
    data += c;
  });
  req.on("end", async () => {
    if (tooLarge) return;
    let body: unknown;
    try {
      body = JSON.parse(data || "{}");
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_json" }));
      return;
    }
    try {
      const out = await handleChat(body as any, env);
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end(JSON.stringify(out.json));
    } catch (e: any) {
      // Log detail server-side only; never echo internals to the client.
      console.error("chat_error", e?.message || e);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal_error" }));
    }
  });
});
const port = parseInt(process.env.PORT || "8080", 10);
server.listen(port, () => console.log(`ose-chat-function on :${port}`));
