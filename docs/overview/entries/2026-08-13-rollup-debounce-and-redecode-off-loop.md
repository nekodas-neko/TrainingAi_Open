# 2026-08-13 — Q-213 closed: the rollup coalesces properly, and redecode leaves the request loop

**Branch:** `claude/trainingai-backlog-v0abea`

Two remaining pieces of Q-213, plus one live report handled on the way.

## Stage 3 — the coalescing predicate meant "any batch"

`isFinalOrSmallBatch = frames.length < DRAIN_BATCH_EVENTS` (255) was written to mean "the drain's
LAST batch". Per `docs/oura-ble-operations.md` §2 a routine drain is 1–2 batches and almost always
under 255 frames, so it read as "any batch" and bypassed the 8 s window nearly every time — the exact
case it existed to coalesce.

Replaced with a **trailing-edge debounce with a max-wait** (`lib/oura-ble/rollup-debounce.ts`): run
3 s after the batches stop, and at least every 20 s during a stream that never pauses. The timer is
`unref`'d, so a pending run can never hold the process open at shutdown — and skipping it is safe,
because `oura_rollup_state` persists the watermark and the next run starts from there.

It lives in its own module rather than in the route because **a Next route file may only export its
HTTP verbs**, and timing logic that cannot be tested at its boundaries is how an off-by-one in a
debounce ships. The clock and timer are injected, so the tests assert scheduling decisions instead of
sleeping.

## The admin redecode route now runs in the worker too

The previous PR moved the ingest rollup off the request loop and deliberately left
`app/api/oura-ble/samples/redecode/route.ts` alone, on the grounds that moving only its aggregate
would leave the heavier `redecodeOuraRawSamples` on the thread and read as finished. Both phases now
go through the worker via `runRedecodeOffLoop`, which keeps the route's contract exactly: per-phase
results, per-phase errors, and **a redecode failure still cannot prevent the re-aggregate**. This is
the heaviest pair of calls in the app — a redecode walks all history and the aggregate rebuilds every
day from it — and on the request thread it was the same starvation that took production down, self
inflicted and minutes long. The caller still waits for its result; the rest of the process no longer
does.

## The live barcode report, and what it is honest to conclude

Mid-session: *"im still unable to scan barcodes — is that route still down?"*, then *"its working now
— about 1 hour ago it didnt work."*

Checked while it was still fresh:

- **Open Food Facts is up** — a real product lookup returned `status: 1, product found`, HTTP 200 in
  **0.86 s**. Not a repeat of the 2026-08-13 OFF outage.
- **Nothing barcode-shaped reached production.** The live deployment had **9 HTTP requests total**
  and **zero** to `/api/nutrition/*`.
- **`error_events` has nothing and structurally cannot.**

That last point is the actual finding. `/api/nutrition/barcode` caught its OFF failure, did
`console.error`, and returned 503 — it never called `reportServerError`, so the failure left no
durable record. **Q-218 gave exactly this treatment to the sibling `/api/nutrition/scan` route and
stopped there.** The barcode route now reports. The other **12** `app/api/nutrition/*` routes still
do not; barcode was fixed because it is the one that just failed, not because it is the only gap.

**Recorded as unexplained, not fixed** — a Known-Issues row says so plainly. *Something that stopped
is not something that was fixed.* The plausible story is the Q-213 starvation that measured the
owner's photo scan at *200 in 129,073 ms*, and it is only plausible: a barcode request was never
recorded either way.

## First production evidence for Stage 2

While reading Railway's HTTP logs for the barcode question, the live deployment showed
`POST /api/oura-ble/samples` at **76–458 ms**. That is the route that was returning 500s after 27.6 s
during the outage. One quiet hour is not a proof, but it is the first production number since the
worker shipped and it points the right way.

## Verified

Full suite green — 464 files, 3,813 tests, zero failures. `tsc --noEmit` clean, lint 0 errors,
`pnpm check:rules` 33 of 33.

**Mutation-verified, three ways on the debounce** — each is a bug someone could plausibly write:

- Removed the max-wait → *"still runs during a stream that never pauses"* fails (`expected 0 to be
  greater than or equal to 2`). That is the starvation case.
- Fired on every `schedule()` — i.e. reintroduced the predicate being replaced → **5 of 6 tests
  fail**.
- Measured the max-wait from the last batch instead of the burst start → the same stream test fails,
  because the window then never elapses.

**Exercised on the dev server**, both changed routes:

- `GET /api/nutrition/barcode?code=737628064502` → 200 in 2.0 s with full nutrition; a nonexistent
  code → `{"notFound":true}` 404, so the unavailable/notFound distinction still holds.
- Three ingest POSTs in quick succession → three 200s (864/338/334 ms) and **one** rollup, fired
  after they stopped, watermark advanced to the last batch's timestamp. `rollup worker ready` logged
  once.
- `POST /api/oura-ble/samples/redecode` → 200 in 0.9 s with both phases populated and both errors
  null.

**Not exercised:** production, and for the debounce that is where the batch-arrival pattern is real —
the dev check used three hand-made batches, not a ring drain. Also not exercised: the S25, native
SQLite, Capacitor plugins, safe-area, WebView. Server-side only; ships through a Railway deploy with
no new APK.

**Deliberately not done:** the 12 other `app/api/nutrition/*` routes that do not report failures. It
is a real gap and it is now written down rather than swept in unmeasured.
