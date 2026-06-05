/**
 * Exact-match origin allowlist check.
 *
 * `allowedOrigins` is the raw `ALLOWED_ORIGINS` env value: `"*"` allows every
 * request (local dev), otherwise a comma-separated list of exact origins
 * (e.g. `https://chat.example.org`). Matching is exact array membership —
 * never substring/prefix — so `https://chat.example.org.evil.com` cannot pass.
 *
 * When an allowlist is configured, requests **without** an Origin header are
 * rejected too: browsers always send Origin on cross-origin (and fetch) POSTs,
 * so a missing header means a non-browser client.
 */
export function isOriginAllowed(origin: string | undefined, allowedOrigins: string): boolean {
  if (allowedOrigins === "*") return true;
  if (!origin) return false;
  return allowedOrigins
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(origin);
}
