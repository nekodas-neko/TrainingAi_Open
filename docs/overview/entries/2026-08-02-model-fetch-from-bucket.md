# 2026-08-02 — models load from object storage, with the repo tree as the safety net (Q-49 A1)

_Branch `feat/model-fetch-from-bucket` · PR #1021 · no version bump · domain `platform`_

The read half of Phase A1. The owner uploaded the eight `.onnx` files to the app's existing Railway
bucket under `oura-model-onnx/`; this teaches the loader to use them.

## Bucket first, disk second — and that order is the whole point

`getSession` now reads model bytes from object storage and falls back to `lib/oura-models/onnx/`.

The migration's endpoint is for these files to leave git. The tempting order is "delete them, then
fetch from the bucket", but that stakes production on a path nobody has ever exercised — and the
loaders are infallible by contract, so a misconfiguration degrades sleep staging and daily steps
**silently** rather than failing. Reading the bucket *first* while the local copies are still there
inverts that: production exercises the real path immediately, the logs say which source served each
model, and the fallback catches anything wrong. Deleting the local copies becomes a trivial
follow-up once the logs have shown the bucket serving all eight.

Same principle as shipping the boot check (#1017) before the move: build the safety net, then walk
the wire.

## Reusing the storage client rather than adding one

The bucket read goes through `downloadMedia` from `lib/exercise-storage.ts` — despite the name it is
a plain "GET this key" against the same private bucket the exercise gifs use, so this adds no second
storage client, no second set of credentials, and no new configuration. It is dynamically imported so
the AWS SDK is not pulled into any bundle that merely touches the module, matching the existing
treatment of `onnxruntime-node` in the same file.

`bucketPrefix` moved into `model-files.json` alongside the file list, so the loader and
`scripts/upload-model-assets.js` cannot disagree about where the files were put.

## Verified by watching the fallback actually fire

The sandbox cannot authenticate to the bucket (see below), which made it a free test of the failure
path. Loading a real model through `getSession`:

```
[oura-models] "dhrv_imputation_1_1_0.onnx" loaded from the repo tree (not object storage)
session created? true
```

The bucket read failed, the fallback served the file, the source was logged, and the session was
created. That is precisely the designed behaviour under a broken bucket — observed, not assumed.

Each file logs its source once per process, so one deploy's logs answer "did the bucket work?"
without repeating on every cache miss.

## What is NOT verified — and what will answer it

**Nobody has seen a model load *from* the bucket.** The session sandbox cannot authenticate to
Railway storage: the access key ID is valid (a deliberately fake ID returns `InvalidAccessKeyId`
while the real one returns `SignatureDoesNotMatch`, so the server recognises it), but no combination
of region, path-style, virtual-host style or checksum setting produces a valid signature. Either the
secret available here is stale or the sandbox's TLS-intercepting proxy alters something SigV4 signs.
Four client configurations were tried before concluding.

So the verification is **the first production deploy's logs**. Eight `loaded from object storage`
lines means the bucket works and the local copies can go. Any `loaded from the repo tree` line names
exactly which file is missing or misnamed in the bucket.

**Do not delete the local copies until those logs are read.** That is the one step this PR
deliberately does not take.
