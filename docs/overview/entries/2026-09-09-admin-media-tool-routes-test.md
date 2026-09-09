# 2026-09-09 — covering the routes #1019 changed blind (PS-39, 24 → 22)

**Branch:** `test/admin-media-tool-routes` · **No product change.**

17 cases over `admin/reference-figure` and `admin/mirror-dataset-gifs`.

## Why these two, before the other twenty

[#1019](https://github.com/nekodas-neko/TrainingAi_Open/pull/1019) rewrote `check-admin-guard-catch.js` and fixed twelve Q-548 sites. Nine of
those, including both of these routes, had **no route test at all** — what held them was the
rewritten static check and its self-test. A mechanical sweep is exactly the kind of change that
looks obviously right, so covering the routes it touched was worth more than covering the ones it
did not.

The 503-not-403 behaviour is now pinned at the route rather than only by a checker.

## What the cases decide

- **`mirror-dataset-gifs` skips an exercise that already has a GIF unless forced** — otherwise every
  press re-downloads and re-uploads the whole library. The condition is *"has a GIF"*, not *"has a
  row"*, and a second case carries a row with a **null** URL to keep those apart: a fixture with only
  the first cannot tell them apart, and the difference decides whether a half-written row is ever
  repaired.
- **A failed dataset download is 502, not 500.** The dataset is someone else's server; calling it our
  fault sends the reader into our own logs. Both shapes are covered — a bad status and a thrown
  fetch.
- **With storage unconfigured it falls back to a data URL and says so.** `storageMode` reports which
  path ran, and the response returns `[data-url]` rather than a megabyte of base64 that no reader
  wants and no log should hold — while the *stored* value is the real data URL.
- **`reference-figure` GET treats a missing object as `url: null`**, and survives a storage read that
  throws. "No reference figure yet" is the normal state of a fresh install; a 404 or a 500 there
  reads as a broken admin screen.

## One inconsistency pinned rather than endorsed

Both routes resolve the caller as `session?.user?.id ?? ''` and hand the empty string to
`requireAdmin`, which throws — so an anonymous caller gets **403 where every sibling route says
401**. Nothing leaks either way, so this is tidiness rather than a defect, but it is the kind of
difference that wastes someone's afternoon. Stated in a test rather than left to be rediscovered.

## Mutation pass

**17 of 18 caught** — both gates, both rate limits, the force flag, the null-GIF condition, the 502,
the ignored HTTP status, the storage-mode claim, the data-URL masking, both matcher stages, and the
upload's MIME type. The survivor is an equivalent mutant planted as a control.

## Not exercised

Drizzle is replaced by a small chainable stand-in, so the SQL is not run — what is pinned is which
values reach the insert. Storage, `fetch` and the dataset matcher are all mocked: no S3, no network,
no real GIF. Web/Node only — no device, no native surface.
