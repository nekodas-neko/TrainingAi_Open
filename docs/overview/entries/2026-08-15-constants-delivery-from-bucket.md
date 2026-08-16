# 2026-08-15 — the constants can now come from the bucket (Q-49 A4a)

**Branch:** `feat/constants-delivery-from-bucket` · **PR:** #1353 · **No version bump:** nothing
user-visible ships here.

A3 made the model constants readable at **runtime** instead of build time, which is what let the
11.6 MB tree stop being a build dependency. Nothing then put them anywhere else, so deleting them
would have left production with no source at all. This is the mechanism, added deliberately *before*
the deletion — so that the deletion is a deletion, not a deletion plus a download path nobody ran.

## What it does

`ensureConstantsAvailable()` resolves in order: the repo copy while it exists → `.oura-constants/`
in the deploy's working directory → the `oura-model-constants/` bucket prefix.

Preferring the repo copy is not a fallback so much as the point of the ordering: local dev and CI
need no bucket credentials at all, which is the same split that lets the model tests run from
recordings.

It is **awaited** in `instrumentation-node.ts`, unlike its three `void`-ed neighbours. The loader is
synchronous and throws on a missing file, so a fire-and-forget download would race the first request
and fail it. `register()` is awaited by Next, so awaiting here genuinely blocks boot.

Two failure modes are kept apart on purpose: an empty listing means the upload has not happened (an
action), a failed listing means the bucket is unreachable (an outage). Collapsing them sends someone
debugging credentials over a missing upload. A partial download reports unavailable rather than
succeeding — a half-set is worse than none, because the loader would serve what arrived and throw on
the rest, so half the app works and half 500s with no common cause.

## The verification half, and why it earned itself the same day

The models have had a bucket report since A1. The constants had nothing, so the only evidence an
upload worked was the upload script's own output — which rules out a **manual** upload through the
bucket console entirely. That matters because the owner uploaded the eight ONNX files that way in
July, and did the constants the same way.

Worse, script-only evidence stops working exactly when it matters most: once the tree copies are
deleted, nothing in the repo knows what the set should contain.

So the 34 filenames are pinned in `model-files.json` beside the ONNX list (filenames only, no vendor
data — the same names already appear throughout the loaders), a test cross-checks them against the
tree and **skips itself once the tree is gone**, and `GET /api/admin/model-assets` grew a `constants`
section reporting verdict, missing, empty, and which directory the running process settled on.

**It caught a real gap within the hour.** The owner's console upload landed **33 of 34** —
`stress_daytime_sensing_1_1_0.tables.json` (1,238 bytes, the smallest file in the set) was dropped.
`getDaytimeStressConstants()` reads it for both saturation tables, so daytime stress would have
started throwing the moment the tree copy was deleted, with nothing pointing at the cause. The
pinned list is the only reason the gap was visible before it became a production fault.

Two extras also landed — `index.ts` and `README.md`, our own files, not vendor material. The
downloader filters `.json`, so they are inert.

## `constantsDir()` is a function now

It was a module-scope `const`. Instrumentation sets `OURA_CONSTANTS_DIR` at boot *after* downloading,
and a const captures whatever the variable held at **import** time. That is correct today only
because nothing imports `constants/index.ts` during instrumentation — a fragile thing to depend on,
and once the tree is gone it would fail by silently reading a path that no longer exists.

## #1322 was superseded, and how

This branch started as #1322, which also carried Q-221. A parallel session took Q-221 off the backlog
and merged it as **#1323** nine minutes after #1322 opened, with a better implementation — a rate
limit on the route, and `cachedFetch` with a synchronous seed instead of the hand-rolled
`localStorage` cache in #1322. #1322 is closed; this branch is cut fresh from `main` carrying only
the half `main` lacked.

Worth recording as a pattern rather than an anecdote: the collision was invisible until `git merge`
reported an **add/add** conflict on a route file. Two sessions working the same backlog need to
re-check the open-PR list before starting an item, not only the queue file — the same discipline
CLAUDE.md already states for Q numbers and migration numbers, applied to the work itself.

## Not exercised

**The bucket branch has never run.** Sandbox storage credentials are placeholders that reject with
`SignatureDoesNotMatch`, so only the tree branch and the pure report-building logic have executed.
`ensureConstantsAvailable()`'s download path runs for the first time on Railway *after* the files are
deleted — which is exactly why the boot check flips to fatal in that change rather than this one.
Today it logs loudly and continues, because today the only way to reach it is a false negative.

Verified: `tsc --noEmit` clean · lint 0 errors · `pnpm check:rules` 33 of 33 · `next build` exit 0 ·
full suite 470 files, 3,876 tests.
