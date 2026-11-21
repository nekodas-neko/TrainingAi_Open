#!/usr/bin/env bash
# #3933. A throwaway S3-compatible store (MinIO in Docker) holding PLACEHOLDER model files, so a
# production server can pass `checkModelAssets` (`instrumentation-node.ts`) in CI without a real
# bucket credential. The guard is untouched: it still lists the bucket and still refuses a boot
# that finds the files missing, empty or unreachable. Here they exist, as a few bytes of text.
#
# The placeholders are not ONNX models. Anything that tries to run inference on one fails and takes
# its documented fallback; the route smoke does not call inference. This job never exercises the
# real bucket listing: the release workflow's "Production serves this commit" step does.
#
# The credentials are made up here and protect a container that dies with the runner: not secrets.
#
#   S3_PORT       host port (default 9100)
#   S3_CONTAINER  container name (default trainingai-local-s3); an old one is replaced
#
#   eval "$(scripts/ci/start-local-s3.sh)"      # exports the STORAGE_* variables
#
# Stop it with `docker rm -f "$S3_CONTAINER"`.
set -euo pipefail

S3_PORT="${S3_PORT:-9100}"
S3_CONTAINER="${S3_CONTAINER:-trainingai-local-s3}"
ACCESS_KEY="localsmoke"
SECRET_KEY="localsmoke-not-a-secret"
BUCKET="trainingai-smoke"
root="$(cd "$(dirname "$0")/../.." && pwd)"

docker rm -f "$S3_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$S3_CONTAINER" -p "$S3_PORT:9000" \
  -e MINIO_ROOT_USER="$ACCESS_KEY" -e MINIO_ROOT_PASSWORD="$SECRET_KEY" \
  minio/minio:RELEASE.2025-04-22T22-12-26Z server /data >/dev/null

for _ in $(seq 1 30); do
  curl -sf -o /dev/null "http://localhost:$S3_PORT/minio/health/live" && break
  sleep 1
done
curl -sf -o /dev/null "http://localhost:$S3_PORT/minio/health/live" \
  || { echo "local S3 did not come up" >&2; docker logs "$S3_CONTAINER" >&2; exit 1; }

# Create the bucket and put a placeholder at every key checkModelAssets lists.
STORAGE_ENDPOINT="http://localhost:$S3_PORT" STORAGE_ACCESS_KEY_ID="$ACCESS_KEY" \
STORAGE_SECRET_ACCESS_KEY="$SECRET_KEY" STORAGE_BUCKET_NAME="$BUCKET" \
  node "$root/scripts/ci/seed-local-s3.mjs" >&2

echo "export STORAGE_ENDPOINT=http://localhost:$S3_PORT"
echo "export STORAGE_ACCESS_KEY_ID=$ACCESS_KEY"
echo "export STORAGE_SECRET_ACCESS_KEY=$SECRET_KEY"
echo "export STORAGE_BUCKET_NAME=$BUCKET"
