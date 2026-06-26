# Chat analytics export

Opt-in chat questions (the checkbox "Help us improve — share my anonymous
question…") are logged by the chat function as `ANALYTICS {...}` lines and land in
**Scaleway Cockpit** (EU, region `pl-waw`). Cockpit keeps logs for **7 days** by
default, so this job archives them to a **private bucket** before they expire.

## What runs where (data residency)

```
Scaleway Cron (every 3 days, EU)
        │ triggers
        ▼
Scaleway Serverless Job  ─── runs inside Scaleway EU, never touches US infra ───┐
   1. query Cockpit Loki: last 6 days, lines matching  |= "ANALYTICS"           │
   2. normalise → {timestamp, q, rounds}, dedupe exact dups (window overlaps)   │
   3. write  analytics-YYYY-MM-DD.jsonl  +  analytics-YYYY-MM-DD.csv            │
   4. upload both to the private bucket                                         │
        └────────────────────────────────────────────────────────────────────┘
```

The container **image** is built in GitHub Actions (US runners) — but it carries
no data, only the script. The **log fetch** happens at runtime on Scaleway in the
EU, so opt-in user questions never transit US compute. That is the whole reason
this is a Scaleway job and not a GitHub Actions cron.

**Cadence vs retention:** runs every 3 days but queries the last **6 days** (2×),
so the windows overlap. That overlap means a single missed/failed run self-heals
on the next run (the data is still within Cockpit's 7-day window), and it works on
the free default retention — no retention bump, no extra cost. Overlap produces
duplicate records across consecutive files; `sort -u` removes exact dups within a
file, and see "Combine + dedupe" below for across files.

## Files produced

- `analytics-YYYY-MM-DD.jsonl` — source of truth, one record per line:
  `{"timestamp":"2026-06-26T08:08:20Z","q":"how do I claim an eSIM?","rounds":3}`
- `analytics-YYYY-MM-DD.csv` — same data, columns `timestamp,rounds,question`,
  for eyeballing in a spreadsheet.

`q` is the user's question (first 500 chars). No IP, no identity — anonymous, as
promised in the UI. (A user could still type personal data *into* a question; the
data is not scrubbed.)

---

## Quick start: fetch the data locally

The bucket is plain S3-compatible storage, so the `aws` CLI works as a generic S3
client pointed at Scaleway — **no Amazon account involved**. Any S3 tool works
(`rclone`, `s5cmd`, …); `aws` shown here.

```bash
# 1. Credentials = your Scaleway API key (the public access key + its secret).
export AWS_ACCESS_KEY_ID=SCWXXXXXXXXXXXXXXXXX
export AWS_SECRET_ACCESS_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export AWS_DEFAULT_REGION=pl-waw
EP=https://s3.pl-waw.scw.cloud          # Scaleway Object Storage endpoint
B=s3://ose-knowledge-analytics          # the private analytics bucket

# 2. List what's there
aws s3 ls "$B/" --endpoint-url "$EP"

# 3. Download the latest CSV (open it in a spreadsheet)
aws s3 cp "$B/analytics-2026-06-26.csv" . --endpoint-url "$EP"

# 4. Peek at a JSONL file WITHOUT saving it
aws s3 cp "$B/analytics-2026-06-26.jsonl" - --endpoint-url "$EP" | jq .

# 5. Sync everything locally (incremental — only new files)
aws s3 sync "$B/" ./analytics-data/ --endpoint-url "$EP"
```

### Combine + dedupe across files

Because the query windows overlap, the same question can appear in two daily
files. Merge and de-duplicate by `(timestamp, q)`:

```bash
cat analytics-data/*.jsonl | jq -s 'unique_by(.timestamp, .q)' > all-analytics.json

# Most common questions (quick signal for doc gaps)
jq -r '.q' all-analytics.json | sort | uniq -c | sort -rn | head -20

# Questions where the agent needed the most tool rounds (hardest to answer)
jq -r 'select(.rounds >= 4) | .q' all-analytics.json | sort -u
```

> **Note:** downloading to your machine pulls the data out of EU infrastructure to
> wherever you are. That's a maintainer choice for analysis and fine; just be aware
> it leaves the EU-only path the job itself maintains.

---

## One-time setup (maintainer)

The deploy workflow ([deploy-analytics-job.yml](../.github/workflows/deploy-analytics-job.yml))
builds the image **and creates the job definition** (cron + env + the Scaleway S3
keys) on its first run. It deliberately does NOT set `COCKPIT_TOKEN` — that is
added by hand so the token never enters GitHub and the log path stays EU-only. On
later runs the workflow only rolls the image forward, so it never clobbers the
hand-added token.

1. **Private bucket** (must NOT be public — unlike the website bucket):
   ```bash
   aws s3 mb s3://ose-knowledge-analytics --endpoint-url https://s3.pl-waw.scw.cloud
   ```
   Leave it private; do not attach a public-read bucket policy. If the job's upload
   later fails with `AccessDenied`, attach a **private** writer-only bucket policy
   (project principal, no public statement) — see the chat-bucket policy for shape,
   minus the public-read statement.

2. **Cockpit token + Loki URL** — Scaleway console → Cockpit (region **pl-waw**) →
   Tokens, create a token with **logs read**; copy its secret. The Loki URL is the
   Cockpit "Logs" data source URL: `https://<data-source-id>.logs.cockpit.pl-waw.scw.cloud`.

3. **Set repo variables** (non-secret config the workflow reads):
   ```bash
   gh variable set ANALYTICS_BUCKET       --body "ose-knowledge-analytics"
   gh variable set OSE_ANALYTICS_LOKI_URL --body "https://<data-source-id>.logs.cockpit.pl-waw.scw.cloud"
   ```

4. **Let the workflow run** (any push under `analytics/**`, or run it manually).
   It creates the `ose-analytics-export` job definition.

5. **Add the token + start a run.** In the console → Serverless Jobs →
   `ose-analytics-export` → add an env var `COCKPIT_TOKEN` (the secret from step 2),
   then start a run:
   ```bash
   scw jobs definition start <job-definition-id> region=pl-waw
   ```
   The first run *before* the token is added will fail (no `COCKPIT_TOKEN`) — that's
   expected; add it and re-run. Then check the bucket ("Quick start" above) for the
   dated files, and the run's logs in Cockpit.

> **Security note:** the workflow sets `SCW_ACCESS_KEY`/`SCW_SECRET_KEY` as plain
> env vars on the job (needed for the bucket upload), so they're visible in the job
> config to anyone with project access. To harden, move them (and `COCKPIT_TOKEN`)
> into Scaleway Secret Manager and reference them via `scw jobs secret create`
> instead of plain env vars.
