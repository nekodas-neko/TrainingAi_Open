# 2026-08-13 — the AI food scan reports its failures (Q-218, v1.303.1)

**Branch:** `fix/scan-route-reports-failures`

`/api/nutrition/scan` caught its own errors and did `console.error('Gemini scan error:', err)` plus a
502. It never called `reportServerError`, so **30 days of `error_events` held nothing for it** — on the
food-logging path the owner actually uses. A scan failing repeatedly was invisible unless someone read
Railway's stdout by hand. Its sibling AI routes (`/api/exercises/generate`, `/api/phase-sets/clone`,
`/api/complete-workout`) have reported since they were written; this one was the gap.

Found while investigating the owner's "barcode and photo logging aren't working" report. It was **not**
the cause — that scan measured **200 in 129,073 ms**, i.e. it worked and the phone gave up, which was
Q-213. But the investigation had to reach for Railway's HTTP logs to establish that, precisely because
this route reports nothing.

`maxRetries: 0` is left as it is, deliberately. The backlog entry asked for reporting first and a
retry decision once the failure rate is actually visible — with no data on how often it fires, adding
a retry would be guessing at both the frequency and the cost.

## Verified

Full suite green — 460 files, 3,787 tests. `tsc --noEmit` clean, lint clean, all 20 custom-rule checks
pass. The observability suite (22 tests across 3 files) covers `reportServerError`'s own contract,
including the `err.cause` unwrapping this route's Gemini errors will arrive wrapped in.

**Not exercised:** a real Gemini failure. Provoking one needs either a revoked key or an outage, and
neither is available here — the catch itself is unchanged and already proven by the 502 it has always
returned; what is new is the reporting call beside it. Also not exercised: the S25, native SQLite,
Capacitor plugins, safe-area, WebView — this is a server-side one-line change on a route with no UI.

## Also in this change

**Q-213 Stage 3 was re-verified against `main` and deprioritised rather than implemented.** The
coalescing predicate is still wrong — `frames.length < 255` means "any batch" rather than "the drain's
last batch", so it bypasses the 8-second window nearly every time. But Stage 1 cut the cost that
predicate multiplies from ~10 s to ~1 s per run, so "one rollup per batch instead of per drain" is now
ordinary redundancy, not the pathology it was this morning. It stays in Q-213 as opportunistic work
behind Stage 2 (moving the rollup off the request event loop), which is the remaining structural fix.

Recording the reasoning rather than silently reordering: the backlog protocol asks for a plan to be
re-verified before implementing, and this is a case where shipping the plan as written would have
spent a PR on something the previous PR had already made small.
