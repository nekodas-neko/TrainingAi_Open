# 2026-09-09 — three admin tools, and a report naming a source that was deleted (PS-39, 22 → 19)

**Branch:** `test/admin-tool-routes` · **One product change**, in `admin/model-assets`.

27 cases over `admin/generate-exercise-media`, `admin/model-assets` and `admin/fix-exercise-units`.
They share the admin gate and nothing else, which is the batch: the gate is the part that has
regressed before, and three routes exercise it three ways in one file.

`generate-exercise-media` heads the list because **#1019 changed it and left no test behind** — two
of the twelve Q-548 sites that PR fixed are in this file, held until now by a static check and its
own self-test. A mechanical sweep is exactly the kind of change that looks obviously right.

## The report was naming a source that no longer exists

`admin/model-assets` answers one question: where are the eight ONNX models actually coming from? It
answered `bucket.verdict === 'complete' ? 'object storage' : 'the repo tree (fallback)'`.

**Q-49 A4b deleted the local `.onnx` copies.** The fallback branch in `getSession` is still there,
but there are no files behind it — so any non-complete bucket was reported as being served by the
repo tree, in the same payload as a `disk` report listing every required file as missing. A reader
following that answer goes looking in a directory that holds only fixtures.

`disk.ok` was already being computed and returned; it just was not consulted. The answer is now
three-way — object storage, the repo tree when the repo tree really has them, and
`nothing — neither source has every model` when neither does. That last string is the true state of
a deploy whose bucket is unreachable today, and it is the one the report existed to surface.

The constants half is deliberately asymmetric and stays that way: that loader is synchronous and
reads whichever directory boot settled on, so there is no per-request fallback to report. Both
halves are now pinned, including the "not delivered — the loader will throw" case.

## What the other two decide

- **`generate-exercise-media` skips on "has a GIF", not "has a row".** A row whose generation died
  halfway carries a null `gifUrl` and must get another go; the fixture pair separates them.
- **A generation failure is 500 and writes nothing** — no half-generated pair reaches
  `exercise_media` to read later as a real picture.
- **With storage unconfigured it stores a data URL and masks it in the response.** Worth noting a
  second path into that branch: a *configured* upload that returns null falls back too, and still
  reports `storageMode: 's3'` — a response claiming the upload path ran while the row holds base64.
  Pinned as-is rather than changed, and filed as **LA-87** — the fix is one line and the decision is
  which line (report the path actually taken, or treat a null from a configured uploader as a 502),
  which is a queue entry rather than something to settle inside a test PR.
- **`fix-exercise-units` routes on one optional boolean.** The same body is a read or a rewrite of
  logged history depending on `apply`, and nothing else in the request distinguishes them. Both
  spellings of "no" — absent and explicit `false` — are checked, because they reach the default
  through different paths.
- Its `beforeDate` regex is **dash-only, and that is correct here**: the house rule about accepting
  both separators exists because `localDateString()` emits slashes, and this param is filled by an
  `<input type="date">` in `components/admin/exercise-unit-fix.tsx`, which emits dashes and nothing
  else. The test pins the agreement, not the regex.

## The fixture the mutation pass rejected — a twelfth variant

**A symmetric pair counted with equal totals.** The GET returns `generatedMale` and
`generatedFemale`, and the obvious fixture is one of each — at which point both counters read 1, and
a mutant computing the male total from the female rows survives untouched. One of each *looks* like
the balanced case and is the single shape where the two predicates cannot be told apart. The fixture
is now two male and one female. Recorded in the PS-39 checklist.

One harness note worth carrying: the GET selects from **two** tables in one `Promise.all`, so the
Drizzle stand-in routes by table rather than returning one list. A single shared list would make the
library read and the media read indistinguishable, and every assertion about either would really be
about both.

## Mutation pass

**16 of 16 caught** after that fix; the seventeenth is an equivalent mutant planted as a control and
survived as designed.

## Gate

`pnpm lint` 0 errors (597 warnings) · `npx tsc --noEmit` clean · `check-test-typecheck` none above
baseline · **Custom Rules 70 of 70** · `pnpm build` clean · full suite green · route ratchet lowered
**22 → 19**.

**Not exercised:** Drizzle is a chainable stand-in, so no SQL runs — what is pinned is which values
reach the select and the upsert. Image generation, GIF encoding and object storage are mocked, so
this says nothing about whether a generated frame is any good, nor about the upsert's own conflict
handling. Web/Node only: no device, no native surface.
