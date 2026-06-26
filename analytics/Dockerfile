# Minimal image for the analytics export Serverless Job.
# Ships only the export script + its CLI deps (curl, jq, aws CLI as an S3 client).
FROM alpine:3.21

RUN apk add --no-cache bash curl jq aws-cli ca-certificates

WORKDIR /app
COPY export.sh /app/export.sh
RUN chmod +x /app/export.sh

ENTRYPOINT ["/app/export.sh"]
