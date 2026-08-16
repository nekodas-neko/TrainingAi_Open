# 2026-08-02 — the app now says out loud when its model files are missing (Q-49 A1, step 5)

_Branch `feat/model-asset-boot-check` · PR #1017 · no version bump · domain `platform`_

Phase A1 step 5 of the [public-repo migration](../../superpowers/plans/2026-08-02-public-repo-migration-roadmap.md),
which that plan calls "the real deliverable" of A1. Shipped **ahead of** the rest of A1 rather than
with it — see the sequencing note below.

## The problem it exists for

Every loader in `lib/oura-models/inference/` is infallible by contract: `getSession` returns `null`
when the file is missing and each caller falls back rather than throwing. Its own doc comment says
so — *"callers must fall back, never throw."*

That is right per request; a hypnogram is not worth a 500. But it means a deployment with **no model
files at all** looks perfectly healthy while silently serving degraded sleep staging and daily steps.
Nothing anywhere reports it. A1 turns that from theoretical into live: it moves these files out of
git and fetches them at build time, so a broken fetch produces exactly that invisible failure.

## What shipped

`lib/oura-models/required-models.ts` — `REQUIRED_MODEL_FILES` (the eight `.onnx` files production
actually loads) plus `verifyModelAssets(dir)`, which reports missing and zero-length files
separately. **Zero-length counts as unusable**: a truncated download leaves a file that exists, so a
presence-only check would pass while every `InferenceSession.create` failed at request time.

The list is hand-maintained on purpose — a check that discovers its expectations from the directory
can never notice an absent file — so a test cross-checks it against the `.onnx` literals in
`inference/*.ts`. Adding a model without listing it fails there. It passes today, which is what
validates the eight.

Wired into `instrumentation-node.ts`, the existing server-boot hook. Dependency-light on purpose
(`node:fs`, `node:path`, nothing else): that file documents why it must not pull in the Drizzle
adapter, which drags `onnxruntime-node` into a bundle webpack cannot build.

## Why it logs instead of failing the boot, for now

The plan says to fail the boot. It will — but not yet, and the distinction is deliberate rather than
a shortcut.

The files are still committed to git today, so the check **can only fire on a false positive**. A
fatal assertion in that state has zero upside and a real downside: get the required-list wrong, or
hit a path quirk in the Railway filesystem, and the next deploy takes production down over nothing.

The value appears the moment the assets leave git — which is the same PR that should flip it. That
flip is one `throw`; the checker, the list and the drift test are the part worth having in place
first. **Building the guard before the hazard is the right order**, not a deferral.

## Verified by actually breaking it

Unit tests cover a non-existent directory (every file reported missing, no throw) and the
zero-length case. But the boot wiring is the thin part, so I checked it end to end rather than
trusting that it compiled: moved `illness_detection_0_5_1.onnx` aside, started `pnpm dev`, and got

```
[instrumentation] MODEL ASSETS DEGRADED — 1 of 8 model files unusable — missing: illness_detection_0_5_1.onnx
```

then restored the file and confirmed a clean boot. Without that step all I would have known is that
the code compiled.

## What is still blocked

**The rest of A1 needs the owner**: a private storage bucket (Cloudflare R2 or a private GitHub
release) and a Railway build secret. Until those exist the files cannot leave git, because a deploy
that cannot fetch them is a deploy that silently degrades — the exact thing this check is for.
