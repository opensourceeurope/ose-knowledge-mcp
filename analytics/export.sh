#!/usr/bin/env bash
# Export opt-in chat analytics from Scaleway Cockpit (Loki) to a private bucket.
#
# Runs as a Scaleway Serverless Job *inside the EU region* — the analytics data
# (question text from users who opted in) never leaves Scaleway's EU
# infrastructure. This is deliberately NOT a GitHub Actions job: GitHub-hosted
# runners are US-based (Azure eastus), and we don't want EU user questions
# transiting US compute. The container image is built in CI (carries no data);
# only this script, running on Scaleway, ever touches the logs.
#
# Source of the data: function/src/handler.ts logs one line per opted-in answer:
#   ANALYTICS {"q":"<question, first 500 chars>","rounds":<n>}
# We pull those lines from Cockpit, normalise them to {timestamp, q, rounds},
# and write JSONL (source of truth) + CSV (human review) to the bucket.
#
# Required env (set on the job definition):
#   LOKI_URL          https://<data-source-id>.logs.cockpit.<region>.scw.cloud
#   COCKPIT_TOKEN     Cockpit token secret key — X-Token auth for Loki   [secret]
#   ANALYTICS_BUCKET  target private bucket, e.g. ose-knowledge-analytics
#   SCW_REGION        e.g. pl-waw
#   SCW_ACCESS_KEY    Scaleway API key  (used as AWS_ACCESS_KEY_ID)       [secret]
#   SCW_SECRET_KEY    Scaleway API secret (AWS_SECRET_ACCESS_KEY)         [secret]
# Optional:
#   LOOKBACK_DAYS     how far back to query (default 6 — 2x the 3-day cadence,
#                     so a single missed run self-heals on the next run)
#   LOG_SELECTOR      LogQL stream selector
#                     (default '{resource_name="ose-chat-function"}')

set -euo pipefail

: "${LOKI_URL:?LOKI_URL is required}"
: "${COCKPIT_TOKEN:?COCKPIT_TOKEN is required}"
: "${ANALYTICS_BUCKET:?ANALYTICS_BUCKET is required}"
: "${SCW_REGION:?SCW_REGION is required}"
: "${SCW_ACCESS_KEY:?SCW_ACCESS_KEY is required}"
: "${SCW_SECRET_KEY:?SCW_SECRET_KEY is required}"

LOOKBACK_DAYS="${LOOKBACK_DAYS:-6}"
LOG_SELECTOR="${LOG_SELECTOR:-{resource_name=\"ose-chat-function\"}}"

# Loki wants nanosecond epochs. Pure arithmetic — no GNU `date -d` (busybox-safe).
NOW_S="$(date -u +%s)"
END_NS="${NOW_S}000000000"
START_NS="$(( NOW_S - LOOKBACK_DAYS * 86400 ))000000000"
RUN_DATE="$(date -u +%F)"

JSONL_FILE="analytics-${RUN_DATE}.jsonl"
CSV_FILE="analytics-${RUN_DATE}.csv"

# Keep only ANALYTICS lines from the function's stream.
QUERY="${LOG_SELECTOR} |= \`ANALYTICS\`"

echo "Querying Cockpit logs: ${LOOKBACK_DAYS}d back, selector ${LOG_SELECTOR} |= ANALYTICS"

raw="$(curl -fsSG "${LOKI_URL}/loki/api/v1/query_range" \
  -H "X-Token: ${COCKPIT_TOKEN}" \
  --data-urlencode "query=${QUERY}" \
  --data-urlencode "start=${START_NS}" \
  --data-urlencode "end=${END_NS}" \
  --data-urlencode "limit=5000" \
  --data-urlencode "direction=FORWARD")"

# Parse Loki result -> {timestamp, q, rounds}. Strip everything up to "ANALYTICS ",
# then parse the JSON payload (tolerant of malformed lines via try/catch).
# `sort -u` removes exact-duplicate records introduced by the overlapping window.
echo "$raw" | jq -c '
  .data.result[]? | .values[]?
  | { ts: .[0], line: .[1] }
  | select(.line | test("ANALYTICS "))
  | (try (.line | sub("^.*?ANALYTICS "; "") | fromjson) catch null) as $p
  | select($p != null)
  | { timestamp: ((.ts | tonumber) / 1000000000 | todate),
      q: $p.q,
      rounds: $p.rounds }
' | sort -u > "$JSONL_FILE"

count="$(wc -l < "$JSONL_FILE" | tr -d ' ')"
echo "Collected ${count} analytics record(s) into ${JSONL_FILE}"
if [ "$count" -ge 5000 ]; then
  echo "WARNING: hit the 5000-line query limit — some records may be missing. Shorten the cadence or lower LOOKBACK_DAYS."
fi

# CSV for quick human review. @csv handles quoting commas/quotes inside questions.
{
  printf 'timestamp,rounds,question\n'
  jq -r '[.timestamp, .rounds, .q] | @csv' "$JSONL_FILE"
} > "$CSV_FILE"

# Upload to the private bucket. aws CLI is an S3 client here, pointed at Scaleway
# Object Storage — no Amazon involved (see analytics/README.md).
export AWS_ACCESS_KEY_ID="$SCW_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$SCW_SECRET_KEY"
export AWS_DEFAULT_REGION="$SCW_REGION"
ENDPOINT="https://s3.${SCW_REGION}.scw.cloud"

for f in "$JSONL_FILE" "$CSV_FILE"; do
  aws s3 cp "$f" "s3://${ANALYTICS_BUCKET}/${f}" --endpoint-url "$ENDPOINT"
done

echo "Uploaded ${JSONL_FILE} + ${CSV_FILE} to s3://${ANALYTICS_BUCKET}/"
