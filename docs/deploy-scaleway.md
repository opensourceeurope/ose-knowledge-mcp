# Deploying the MCP server to Scaleway

The OSE Knowledge MCP server runs as a [Scaleway Serverless Container](https://www.scaleway.com/en/serverless-containers/).
The container image is built from `.opencrane/Dockerfile` (build context = repo root) and serves
MCP Streamable HTTP on port `8000`. The canonical MCP path is `<endpoint>/http` (`<endpoint>/mcp`
works too as a legacy alias), with a health probe at `<endpoint>/health`.

Deployment is automated by the [`deploy-mcp.yml`](../.github/workflows/deploy-mcp.yml) GitHub Actions
workflow: it builds the image, pushes it to the Scaleway Container Registry, and rolls it out to an
already-created serverless container. The one-time infrastructure below is created manually by a
maintainer using the `scw` CLI; the workflow only updates the running container with new images.

## One-time setup

These steps are run once by a maintainer who has the Scaleway CLI configured
(`scw init`, or `SCW_ACCESS_KEY` / `SCW_SECRET_KEY` / `SCW_DEFAULT_PROJECT_ID` exported).
Pick a region (e.g. `pl-waw`) and reuse it everywhere — the registry endpoint and the container
must live in the same region.

```sh
# 0. Choose a region and export it so the commands below pick it up.
export SCW_DEFAULT_REGION=pl-waw

# 1. Create the Container Registry namespace (this is SCW_REGISTRY_NAMESPACE).
#    Images will live at rg.<region>.scw.cloud/<namespace>/ose-mcp.
#    NOTE: the `opensourceeurope` namespace already exists in this account (pl-waw) —
#    skip this command if `scw registry namespace list` already shows it.
scw registry namespace create name=opensourceeurope is-public=false

# 2. Create a Serverless Containers namespace to hold the container.
scw container namespace create name=opensourceeurope

# 3. Create the serverless container itself.
#    Capture the returned container ID — it becomes SCW_CONTAINER_ID.
#    Replace <namespace-id> with the ID printed by step 2.
scw container container create \
  namespace-id=<namespace-id> \
  name=ose-mcp \
  port=8000 \
  min-scale=0 \
  max-scale=2 \
  memory-limit=2048 \
  cpu-limit=1000 \
  registry-image=rg.pl-waw.scw.cloud/opensourceeurope/ose-mcp:latest
```

Notes on the create flags:

- `port=8000` — the container listens for MCP Streamable HTTP on this port.
- `min-scale=0` — scale to zero when idle (no cost while unused; see the cold-start trade-off below).
- `max-scale=2` — cap at two instances.
- `memory-limit=2048` (MiB) — see the memory headroom note below.
- `cpu-limit=1000` (mvCPU = 1 vCPU).

You can list IDs at any time:

```sh
scw registry namespace list
scw container namespace list
scw container container list
```

## GitHub configuration

The deploy workflow reads the following from the repository's Actions configuration.

Secrets (Settings -> Secrets and variables -> Actions -> Secrets):

| Secret | Description |
| --- | --- |
| `SCW_ACCESS_KEY` | Scaleway API access key. |
| `SCW_SECRET_KEY` | Scaleway API secret key. Also used as the registry login password. |
| `SCW_DEFAULT_PROJECT_ID` | Scaleway project ID that owns the registry and container. |

Variables (Settings -> Secrets and variables -> Actions -> Variables):

| Variable | Description | Example |
| --- | --- | --- |
| `SCW_REGION` | Region for the registry and container. | `pl-waw` |
| `SCW_REGISTRY_NAMESPACE` | Container Registry namespace name (from step 1). | `opensourceeurope` |
| `SCW_CONTAINER_ID` | Serverless container ID (from step 3). | `11111111-2222-...` |

The registry login uses username `nologin` with `SCW_SECRET_KEY` as the password, which is the
Scaleway-documented way to authenticate Docker against the Container Registry.

## Running a deploy

The normal shipping path is publishing a **GitHub release** — that triggers this workflow
automatically (`release: types: [published]`), alongside the PyPI publish of the
`ose-knowledge-mcp` package. `workflow_dispatch` is available for ad-hoc redeploys without
a release. To deploy manually from the GitHub UI:

1. Go to the **Actions** tab.
2. Select **Deploy MCP to Scaleway**.
3. Click **Run workflow** and pick the branch to deploy.

Each run builds the image from `.opencrane/Dockerfile`, pushes it tagged with both `latest` and the
commit SHA, points the container at the SHA-tagged image, and deploys it with `--wait` so the job
fails if the rollout does not become ready.

After a successful deploy, the container endpoint (shown by `scw container container get <id>`) serves
the MCP server. Point an MCP client at `<endpoint>/http`.

## Resource notes

- **Memory headroom.** The image embeds the RAG model and a Milvus Lite index, so `memory-limit=2048`
  is intentional headroom over the baseline footprint. If you see OOM restarts, raise the limit before
  lowering it.
- **Cold starts (`min-scale=0`).** Scaling to zero means there is no cost while idle, but the first
  request after an idle period pays a cold start: the container must be scheduled and the image pulled.
- **Large image (~3.7 GB).** Because the image is large, a cold pull onto a fresh instance takes time.
  If consistent low latency matters more than idle cost, set `min-scale=1` to keep one instance warm.
- **MCP path.** Clients connect at `<endpoint>/mcp` (Streamable HTTP). Health checks hit
  `<endpoint>/health`.

## Tool surface

The deployed server exposes these MCP tools: `search_docs`, `health`, `get_list_members`,
`get_metadata_schema`.
