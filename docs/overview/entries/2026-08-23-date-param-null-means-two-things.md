# 2026-08-23 — A normaliser's `null` meant two different things (Q-453)

**Branch:** `fix/training-stress-date-param-validation` · **Lane A** · server only

```ts
const date = (raw ? normalizeDateParamIso(raw) : null) ?? todayInTz(tz)
```

That reads the normaliser's `null` as *"use the default"*. It is two states wearing one value:
**absent** — the caller omitted the param and is asking for today — and **present but malformed** —
the caller asked for a specific day and mistyped it. The second silently became the first.

Measured live across all 11 `app/api` routes reading a `date`/`localDate` param: nine reject
`?date=not-a-date` with 400, `/api/oura/hr-window` takes `start`/`end` and 400s throughout, and
`/api/training-stress` returned **200** — the 17th's numbers for a request naming the 10th. The
response carries no echo of which date it answered for, so nothing indicated the substitution.

## The sibling sweep found exactly one more

`/api/zone-minutes` carried the same shape on **both** ends of its range, and a range makes it
worse: a mistyped `from` silently widened the window to 30 days and answered as if that was what was
asked for.

The other four sites with a superficially similar shape — `oura/hr-day`, `workout-sessions/day`,
`day-timeline`, `mood` — were already correct, each with an `if (!date) return 400` on the next
line. Worth recording that they were checked, so the next reader does not re-check them.

## What the fix preserves

The absent case still defaults, and that is the case worth not breaking: omitting the param **is** a
request for today. Only a present-and-unparseable value is now rejected.

`?date=` (empty) deliberately still defaults. `searchParams.get` returns `''`, which is falsy, so it
takes the absent branch — indistinguishable from omission at this layer, and every sibling route
treats it the same way.

**Not done: echoing the resolved date in the response.** The entry names the missing echo as why the
substitution was invisible, and it was tempting. With the 400 in place there is no substitution left
to make visible — the only remaining default is the one the caller asked for by omitting the param.
Adding a field to document that would be scope the entry did not ask for.

## Verified

Both mutations — restoring `?? today` on either route — fail the malformed cases.

Live against a signed-in `pnpm dev`:

```
/api/training-stress                              200
/api/training-stress?date=2026-08-20              200
/api/training-stress?date=not-a-date              400
/api/training-stress?date=2026-13-45              400
/api/zone-minutes                                 200
/api/zone-minutes?from=2026-08-01&to=2026-08-20   200
/api/zone-minutes?from=oops                       400
/api/zone-minutes?to=2026-02-30                   400
```

The test asserts the repository is never reached on a malformed param — a mock that throws rather
than returning a plausible empty result, because a silent 200 is exactly the bug.

Full suite 549 files / 4,542 tests; `pnpm check:rules` 53 of 53.

**Not exercised:** the APK. Two route handlers, no native or offline-first path.
