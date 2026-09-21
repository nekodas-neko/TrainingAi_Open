# RV-79 could not be built as written — `cachedFetch` caches a null over an optimistic save

**Branch:** `docs/rv79-cachedfetch-caches-null` · **Lane B** · docs-only

## What happened

RV-79 is a clean-looking rule fix: `app/session-select/session-select-content.tsx` reads today's
mood with a bare `fetch`, against the standing *"client GETs of `/api/*` use `cachedFetch` with a
`readCacheSync` seed, never bare `fetch`"*. The entry's fix says to route it through `cachedFetch`
and **preserve the existing null-guard by applying it in the `onData` callback**.

That cannot work, and applying it would reintroduce the bug the same bullet calls load-bearing.
`cachedFetchCore` (`lib/sqlite/cache.ts:366`) ends a successful fetch with an **unconditional**
`await setCached(key, toStored(data), ttlSeconds)`, outside every null check, with `toStored` the
identity for `cachedFetch`. `onData` runs before it and has no power over it. There is no
`shouldCache`/`skipNull` option — the only opts are `freshWithinTtl` and `onError`.

## Measured, not read off the source

A probe seeded `mood:<date>` with an optimistic log, then ran `cachedFetch` against a stubbed 200
returning `null`:

- `onData` fired **twice** — `[{logDate…, energyLevel:'high'}, null]`. So React state is clobbered
  too, not only the cache.
- `readCacheSync('mood:<date>')` afterwards read **`null`**.

`setCached` writes sessionStorage, localStorage *and* SQLite, and `readCacheSync` parses a stored
`"null"` back to `null` rather than treating it as a miss. So the seeds at
`session-select-content.tsx:211` and `:319` would call `setMoodLog(null)` on the next visit and the
check-in card would re-prompt — the session-167 bug, reached through the helper the cache rule tells
every client GET to use.

The probe was written to answer the question and deleted; it is not in this diff. The numbers above
are its output.

## What was filed

**LB-123** (`Lane: A`) — give `cachedFetch` an opt-in `opts.shouldCache?: (data: T) => boolean`,
defaulting to always, threaded into `cachedFetchCore` to guard that one `setCached`. Additive, so
every existing caller is unaffected, and it lands for **any** nullable-payload key rather than only
this one. A narrower `skipNull` boolean would also work; the predicate is preferred because the next
case will not be `null` — an empty array reads the same way to a `readCacheSync` seed.

**RV-79** keeps its lane and gains `Needs: LB-123`, so it stops printing as startable for Lane B. It
is one line once the option exists.

The `⛔` this entry first used to mark the block was removed before pushing: that glyph is exactly
what `next-item.js` reads as the legacy prose blocker (LB-121), and the same PR that shipped RV-72
had just cleared one. A `Needs:` field is the mechanism; an emphasis glyph is an accident.

## Why this was not just built anyway

`lib/sqlite/**` is Lane A's. The bare `fetch` is a rule violation; caching the null is a live bug.
Trading the first for the second is a loss, so the call site is deliberately left as it is.

## Not established

How many other GET routes can legitimately answer `null` or `[]` was **not** swept — this was found
from one call site. That sweep is worth doing when the option lands and is not a blocker for it.

LB-123 is filed at RV-79's own queue position rather than promoted. It unblocks a live-bug fix, so
an argument for moving it up exists, but cross-lane priority is the Orchestrator's call.
