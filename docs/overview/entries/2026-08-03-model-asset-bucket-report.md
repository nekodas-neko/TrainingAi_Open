# 2026-08-03 — the Q-49 gate was "read the deploy logs"; now it is a button

_Branch `feat/model-asset-bucket-report` · v1.252.3 · domain `platform` (Q-49 Phase A1)_

## Why

#1021 made `getSession` read the eight ONNX models from object storage first and the repo tree
second, deliberately keeping the local copies as a safety net. The remaining step — delete the local
copies and make the boot check fatal — was gated on this evidence:

> eight `[oura-models] … loaded from object storage` lines on the first deploy

That gate does not work well:

- **The loaders are lazy.** A model is only read when something needs it, so those lines appear
  whenever a sleep rollup next happens to run, not at deploy time.
- **Absence proves nothing.** No line could mean the bucket is empty, or that nothing has asked for
  a hypnogram yet. The two are indistinguishable from the log.
- **It is one-shot and unrepeatable.** Scroll past it and the evidence is gone.

So the gate is now a question you can ask the bucket directly, at any time.

## What shipped

`GET /api/admin/model-assets` (admin-only, read-only) and a **Model asset delivery** card under
Admin → Tools → Additional tools. It reports, per file, what object storage holds and what the repo
tree holds, and reduces it to one of three verdicts:

| Verdict | Meaning |
|---|---|
| `complete` | All 8 present and non-empty in the bucket — the local copies can go, boot check can become fatal. |
| `incomplete` | The bucket answered but something is missing or zero-length. **Do not delete anything**; re-run `scripts/upload-model-assets.js`. |
| `unreachable` | Could not talk to the bucket. Nothing can be concluded about its contents. |

**The third verdict is the whole point of the design.** `downloadMedia` collapses "absent" and "auth
rejected" into the same `null`, which is correct for a read path with a fallback and badly wrong for
a report — this exact confusion cost a session earlier, when
`scripts/upload-model-assets.js --check` announced all eight files absent while the real problem was
a rejected credential, and the reflex was to go re-upload files that were already there. So
`statMedia`/`listMediaKeys` (new, in `lib/exercise-storage.ts`) surface non-404 errors instead of
swallowing them, and `buildBucketReport` refuses to report a single missing file when the bucket
could not be reached.

Zero-length counts as unusable, not present: a truncated upload leaves a file that exists but fails
to parse, which is the same silent-degradation shape the boot check exists to catch.

## Verification

- Six tests on `buildBucketReport` (pure, so all three verdicts are testable without a bucket —
  no session sandbox can authenticate to one). They pin the two collapses that would make the report
  lie: an unreachable bucket must not produce a missing-files list, and an empty bucket must not be
  reported as unreachable.
- Route exercised on the dev server against all three auth states: **401** unauthenticated, **403**
  as a non-admin, **200** as an admin.
- The `unreachable` path is exercised **for real**, not just in tests: the sandbox's bucket
  credentials are rejected, so the live response is
  `{"verdict":"unreachable","error":"SignatureDoesNotMatch (403)"}` with `missing: []` — which is
  precisely the behaviour the design is about. `disk.ok` is `true` alongside it, correctly reporting
  that the repo tree is what production would serve from.

## Not verified

- **The `complete` and `incomplete` verdicts against a real bucket.** They cannot be reached from a
  sandbox that cannot authenticate. Their logic is unit-tested; the round trip through S3 is not.
- **The card's rendering.** It sits behind two client-side toggles (Tools tab → Additional tools),
  so it is absent from the server-rendered HTML, and this repo has no React render-test setup
  (`vitest` runs in the `node` environment, no `@testing-library`). It follows
  `set-hr-backfill-card.tsx`'s shape exactly and typechecks, but no one has looked at it. On the
  owner checklist.

Ships through Railway — no APK needed.
