# Deploying the chat website

The public chat is two decoupled pieces, both EU-hosted:

- **`function/`** — a stateless Node 20 / TypeScript serverless function. It holds the
  inference API key, runs the agentic loop (`mistral-small-3.2-24b-instruct-2506`
  tool-calling on Scaleway Generative APIs -> the OSE MCP `search_docs` -> a final cited
  answer), and returns JSON `{ answer, citations }`. Entry point is `dist/server.js`,
  which listens on `$PORT`.
- **`chat/`** — a 100% static page (HTML/CSS/vanilla JS, self-hosted Manrope). It POSTs
  `{ messages, analyticsOptIn }` to the function and renders the answer plus citation
  chips. The operator points it at the function by editing `chat/config.js`.

This doc mirrors the style of [`deploy-scaleway.md`](deploy-scaleway.md) (the MCP server
deploy) and reuses the same `scw` conventions. Everything runs on **Scaleway**.

> **OVH note:** OVH Cloud was evaluated as the static-site host but is **not used** — this
> account has no OVH Web Hosting product, and the static site is served from Scaleway Object
> Storage instead. (Both are EU, so sovereignty is unchanged.) Ignore any older OVH/SFTP
> references.

## Sovereignty

The entire request path runs on European infrastructure:

- **Inference** — Scaleway Generative APIs (EU), `mistral-small-3.2-24b-instruct-2506`
  (Mistral Small, Apache 2.0, built in France).
- **Function + static page** — Scaleway (EU).
- **MCP** — the OSE MCP server on Scaleway (EU), per [`deploy-scaleway.md`](deploy-scaleway.md).

Self-hosted Manrope woff2 (no third-party font CDN) keeps every byte of the static page
served from European infrastructure too.

## Access control & cost posture

The function holds the inference API key server-side (it is never sent to the browser or
embedded in the static page), but every accepted request spends Scaleway credits, so
who may call it matters:

- **`ALLOWED_ORIGINS` is enforced server-side.** With it set (always do this in prod),
  the function returns `403` for any request whose `Origin` header is missing or not an
  exact allowlist match — this is a real rejection, not just a CORS header. It blocks
  all browser-based cross-site abuse and casual scripted calls.
- **Honest limitation:** the `Origin` header can be forged by a non-browser client, so
  a determined attacker can still call the endpoint directly. The hard backstop is
  platform-level: Scaleway free-tier/account limits bound total spend, and you can add
  rate-limiting in front of the function (gateway/CDN/WAF) if abuse appears.

There is **no custom rate-limiting** in the function itself. The spend controls you have:

- **`MAX_TOOL_ROUNDS`** (default `4`) caps how many tool-call rounds a single request can
  run, bounding the inference calls per question. Lower it to tighten the ceiling.
- **`MISTRAL_MODEL`** — keep the small model (`mistral-small-3.2-24b-instruct-2506`)
  rather than switching to a larger, pricier one on Scaleway, to reduce per-call cost.
- **Request bodies are capped at 128 KiB** and chat history is trimmed to the last 12
  turns, bounding per-request token volume.

For the measured token/€ cost per question and per session, see
[`chat-cost.md`](chat-cost.md) (short version: ~€1.60 per 1,000 sessions).

If you later need hard limits, add rate-limiting in front of the function (e.g. at the
gateway/CDN) rather than in this code.

## Environment variables (function)

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `MISTRAL_API_KEY` | yes | — | Inference API key (your Scaleway key for the hosted deployment); store as a **secret**, never as a plain env value. |
| `MISTRAL_MODEL` | no | `mistral-small-latest` | Model id. Set to `mistral-small-3.2-24b-instruct-2506` for Scaleway. Spend control (see above). |
| `MISTRAL_BASE_URL` | no | — | OpenAI-compatible endpoint. `https://api.scaleway.ai` for Scaleway Generative APIs (EU); a local Ollama URL for offline; unset = Mistral's own API. The SDK appends `/v1/chat/completions`, so do **not** include `/v1`. |
| `OSE_MCP_URL` | yes | — | Deployed MCP endpoint, e.g. `https://<endpoint>/http`. |
| `ALLOWED_ORIGINS` | no | `*` | **Enforced server-side** (403 when Origin is missing/not listed). Set to the **static site origin** in prod, e.g. `https://chat.example.org`. Comma-separated for multiple. `*` disables the check — never leave it in prod. In the automated deploy this is built for you: the bucket website URL plus the `CHAT_EXTRA_ORIGINS` repo variable (see below) — set that to your custom domain. |
| `MAX_TOOL_ROUNDS` | no | `4` | Spend control (see above). |
| `PORT` | no | `8080` | Injected by the platform on Scaleway/containers. |

Build once before deploying: `cd function && npm run build` (runs `build:persona`,
`build:pagemap`, then `tsc`, emitting `dist/`).

## Deploy the function

You have a Scaleway CLI configured (`scw init`, or `SCW_ACCESS_KEY` / `SCW_SECRET_KEY` /
`SCW_DEFAULT_PROJECT_ID` exported). Pick a region and reuse it:

```sh
export SCW_DEFAULT_REGION=pl-waw
```

### Option A — Scaleway Serverless Function (Node 20)

Cheapest and simplest: no image to build. Package the built function and its runtime
dependencies, then create a function with the Node 20 runtime, handler `dist/server.js`,
and the env vars above. `MISTRAL_API_KEY` must be a secret.

```sh
# Build, then zip dist/ + node_modules (production deps only) + package.json.
cd function
npm ci --omit=dev
npm run build
zip -r ../ose-chat-function.zip dist node_modules package.json

# Create a Serverless Functions namespace to hold the function.
scw function namespace create name=ose-chat

# Create the function (capture the returned ID; replace <namespace-id> from the step above).
scw function function create \
  namespace-id=<namespace-id> \
  name=ose-chat \
  runtime=node20 \
  handler=dist/server.js \
  min-scale=0 \
  max-scale=2 \
  memory-limit=256

# Upload the package and deploy it.
scw function function deploy <function-id> zip-file=../ose-chat-function.zip

# Set env vars and the secret (replace <function-id>).
scw function function update <function-id> \
  environment-variables.MISTRAL_BASE_URL=https://api.scaleway.ai \
  environment-variables.MISTRAL_MODEL=mistral-small-3.2-24b-instruct-2506 \
  environment-variables.OSE_MCP_URL=https://<mcp-endpoint>/http \
  environment-variables.ALLOWED_ORIGINS=https://chat.example.org \
  environment-variables.MAX_TOOL_ROUNDS=4 \
  secret-environment-variables.0.key=MISTRAL_API_KEY \
  secret-environment-variables.0.value=<your-scaleway-key>
```

> Flag names can drift between `scw` versions; run `scw function function create --help`
> and `scw function function deploy --help` to confirm the exact spelling for your CLI.
> The Node 20 entry is `dist/server.js`; the platform injects `$PORT`, which the server
> already honours.

The function URL is shown by `scw function function get <function-id>`. That URL is the
`FUNCTION_URL` the static page needs.

### Option B — Scaleway Serverless Container

Use this only if the plain-function packaging above is awkward on your account (it needs
a small `function/Dockerfile` — Node 20 base, `npm ci && npm run build`, `CMD ["node",
"dist/server.js"]`). The flow then matches the MCP container in
[`deploy-scaleway.md`](deploy-scaleway.md): build the image, push it to the Scaleway
Container Registry, and create a container with `port=8080` and the same env vars/secret.

```sh
scw container namespace create name=ose-chat
scw container container create \
  namespace-id=<namespace-id> \
  name=ose-chat \
  port=8080 \
  min-scale=0 \
  max-scale=2 \
  memory-limit=256 \
  registry-image=rg.pl-waw.scw.cloud/<namespace>/ose-chat:latest
```

Set env vars/secret with `scw container container update <container-id> ...` using the
same keys as Option A.

## Deploy the static page

The static page is just the files in `chat/`. Before uploading, edit `chat/config.js`:

```js
window.OSE_CHAT_CONFIG = {
  FUNCTION_URL: "https://<your-function-url>",
};
```

`FUNCTION_URL` is the function URL from the step above. After setting it, make sure
the function's `ALLOWED_ORIGINS` includes the origin you serve the page from. The
"Use it in your own tools or locally" panel content is static — it advertises the
PyPI-published `ose-knowledge-mcp` package, not this deployment's endpoint.

### Option A — Scaleway Object Storage static website

```sh
# Create a bucket and enable website hosting (index.html as the entry document).
scw object bucket create name=ose-chat region=pl-waw
scw object bucket website enable ose-chat index=index.html

# Upload chat/ with the S3-compatible API. The Scaleway endpoint is
# https://s3.<region>.scw.cloud and reuses your SCW access/secret keys.
aws s3 sync chat/ s3://ose-chat/ \
  --endpoint-url https://s3.pl-waw.scw.cloud \
  --acl public-read \
  --delete
```

The site is served at `https://ose-chat.s3-website.pl-waw.scw.cloud/` (put it behind a
custom domain / CDN if you want a clean origin). When you do, add that domain to the
function's allowlist via the `CHAT_EXTRA_ORIGINS` repo variable (see below) — otherwise
the browser calls from the custom domain are CORS-blocked.

> `aws s3 sync` works against Scaleway's S3-compatible endpoint when `aws configure` is
> set with your `SCW_ACCESS_KEY` / `SCW_SECRET_KEY`. The native `scw object` commands
> work too; `s3 sync` is shown because it handles `--delete` and content types cleanly.


## Automated static deploy (GitHub Actions → Scaleway Object Storage)

You never hand-edit `config.js`. The [`deploy-chat.yml`](../.github/workflows/deploy-chat.yml)
workflow renders it from repo variables (via `chat/render-config.sh` +
`chat/config.template.js`) and `aws s3 sync`s `chat/` to the Scaleway Object Storage bucket.
Run it from **Actions → Deploy chat website (Scaleway Object Storage) → Run workflow**. It
reuses the same Scaleway credentials as the MCP deploy — no extra secrets.

### One-time bucket setup

The bucket `ose-knowledge-chat` (`pl-waw`) is already created with static-website hosting +
a public-read policy, served at `https://ose-knowledge-chat.s3-website.pl-waw.scw.cloud`.
To recreate it (creds: `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` = your `SCW_ACCESS_KEY`/`SCW_SECRET_KEY`):

```sh
EP=https://s3.pl-waw.scw.cloud
aws s3api create-bucket --bucket ose-knowledge-chat --endpoint-url $EP \
  --region pl-waw --create-bucket-configuration LocationConstraint=pl-waw
aws s3 website s3://ose-knowledge-chat/ --index-document index.html \
  --error-document index.html --endpoint-url $EP
# public-read policy — note Scaleway's resource format is "<bucket>/*" (no arn: prefix)
aws s3api put-bucket-policy --bucket ose-knowledge-chat --endpoint-url $EP \
  --policy '{"Version":"2023-04-17","Statement":[{"Sid":"PublicRead","Effect":"Allow","Principal":"*","Action":["s3:GetObject"],"Resource":["ose-knowledge-chat/*"]}]}'
```

### Repository configuration

Variables (Settings → Secrets and variables → Actions → Variables):

| Variable | Description | Value |
| --- | --- | --- |
| `CHAT_FUNCTION_URL` | Deployed function URL → `config.js` `FUNCTION_URL`. | set after the function is deployed |
| `CHAT_S3_BUCKET` | Object Storage bucket name. | `ose-knowledge-chat` |
| `SCW_REGION` | Region. | `pl-waw` |
| `CHAT_EXTRA_ORIGINS` | Consumed by `deploy-function.yml`: extra origin(s) appended to the function's `ALLOWED_ORIGINS` on top of the bucket website URL. Comma-separated, no trailing slash. Set this to your custom domain. | `https://ask.opensourceeurope.org` |

Secrets: reuses `SCW_ACCESS_KEY` / `SCW_SECRET_KEY` (already set for the MCP deploy) — no new secrets.

The function's `ALLOWED_ORIGINS` is set automatically by `deploy-function.yml` on each
deploy — the bucket website URL plus anything in `CHAT_EXTRA_ORIGINS`. Because Scaleway
replaces the runtime env wholesale per deploy, a custom domain **must** live in
`CHAT_EXTRA_ORIGINS`; a value added by hand on the container is wiped on the next redeploy.

The workflow fails fast with a clear message if a required value is missing. The SFTP
upload does **not** delete remote files (a shared web root may hold unrelated content);
clear the target directory manually if you want a clean mirror. After the first deploy,
set the function's `ALLOWED_ORIGINS` to the page's public origin.

To render the config locally (e.g. for a manual upload):

```sh
FUNCTION_URL=https://<function-url> ./chat/render-config.sh
```

## Verify

1. Open the static page; confirm fonts load from `fonts/` (no Google Fonts requests).
2. Ask a question. The browser POSTs to `FUNCTION_URL`; you should get an answer with
   citation chips. If you see a CORS error or a `403 {"error":"origin_not_allowed"}`,
   fix `ALLOWED_ORIGINS` on the function — it must list the exact page origin
   (scheme + host + port).
3. Confirm enforcement works: `curl -X POST <FUNCTION_URL> -H 'content-type:
   application/json' -d '{"messages":[{"role":"user","content":"hi"}]}'` (no Origin
   header) must return `403`. If it returns an answer, `ALLOWED_ORIGINS` is still `*`.
4. The analytics toggle is **off by default**. When a user opts in, the function logs one
   anonymous line (`ANALYTICS {...}` — query text + round count, no IP/PII) to stdout,
   which lands in Scaleway Cockpit (EU).
