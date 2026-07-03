# syntax=docker/dockerfile:1.4
# Slim MCP runtime image.
#
# It installs the PUBLISHED `ose-knowledge-mcp` package (built by release.yml's publish
# job), which already bundles the prebuilt Milvus index (data/milvus.db + chunks.json), and
# serves it over HTTP. There is NO fetch/llms/chunk/embed/index here — the index is the
# committed .opencrane/milvus.db (regenerated only when chunks change; see
# scripts/ensure-index.sh), which the publish job packs into the wheel. This image only
# adds the embedding model (needed at query time to embed the incoming question) and the
# HTTP server.
#
# Build arg PKG_VERSION pins the package version (= the release tag); the release pipeline
# passes it after publishing to PyPI.

FROM python:3.11-slim

ARG PKG_VERSION
ARG EMBEDDING_MODEL=nomic-ai/nomic-embed-text-v1.5

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ curl \
    && rm -rf /var/lib/apt/lists/*

# CPU-only torch first (avoids the multi-GB CUDA build), then the published package.
# Retry the package install to ride out PyPI index propagation right after a publish.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu && \
    if [ -z "$PKG_VERSION" ]; then echo "PKG_VERSION build-arg is required" >&2; exit 1; fi && \
    for i in 1 2 3 4 5 6 7 8; do \
      pip install "ose-knowledge-mcp==${PKG_VERSION}" && break || \
      { echo "waiting for ose-knowledge-mcp==${PKG_VERSION} on PyPI (attempt $i)..."; sleep 15; }; \
    done && \
    python -c "import ose_knowledge_mcp" || { echo "package install failed" >&2; exit 1; }

# Bake the embedding model so the runtime is fully offline (the package bundles the
# index, not the ~550MB model — see PyPI size limits).
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('${EMBEDDING_MODEL}', trust_remote_code=True)"

# Resolve the bundled index/chunks paths from the installed package, once, into an env file.
RUN python - <<'PY' > /etc/ose-mcp.env
import os, ose_knowledge_mcp
d = os.path.join(os.path.dirname(ose_knowledge_mcp.__file__), "data")
print("MILVUS_DB_PATH=" + os.path.join(d, "milvus.db"))
print("AI_DOCS_CHUNKS_FILE=" + os.path.join(d, "chunks.json"))
PY

ENV MCP_HTTP_PORT=8000
ENV TRANSFORMERS_OFFLINE=1
ENV PYTHONUNBUFFERED=1
EXPOSE 8000

# Load the package-data paths (built above), then serve over HTTP off the bundled index.
ENTRYPOINT ["/bin/sh", "-c", "set -a; . /etc/ose-mcp.env; set +a; exec opencrane serve --transport http"]
