# 2026-09-25 — LB-155: a rule with 67 violations, and the carve-out that makes it enforceable

**Branch:** `lane-b/lb155-bare-api-fetch-carveout` · **Lane:** Implementation B

"Client GETs of `/api/*` use `cachedFetch` with a `readCacheSync` seed, never bare `fetch`" was prose
only, and prose lost. Two entries filed against it this week — RV-79 and LB-154 — each singled out
one call site as though it were exceptional. Neither had counted.

## The defect is the missing carve-out, not any call

There are **67** bare `/api/` GETs in client code, and **about half of them should stay that way**.
So a ban would be wrong and a silent prose rule is worse: it produces a steady trickle of entries
that each fix one site and never notice the population.

`scripts/check-bare-api-fetch.js` splits it three ways and ratchets only the last:

| population | count | treatment |
|---|---|---|
| BLE + admin debug consoles | 33 | exempt wholesale — live is the useful reading while holding the device, the precedent CLAUDE.md already sets for these directories under the timezone rule |
| exempt **endpoints** | 8 | `/api/version`, `colmi/status`, `scale-ble/{pending,today}`, `sync/pull`, `oura-ble/rollup-state`, `exercise-library`, `ai-periodization/session` |
| tracked | 26 across 19 files | shrink-only baseline |

Exemptions are keyed by **endpoint, not `file:line`** — the reason belongs to the route, and line
numbers drift. Several of those eight already pass `cache: 'no-store'` explicitly, which is the tell
that the bare fetch was deliberate. Caching `sync/pull` would be a correctness bug, not a staleness
one.

## The number was wrong twice, and that is the durable lesson

I published **69**. That included a false positive: the scan dropped calls with `method:` but not the
shorthand `{ method, headers }`, which has no colon, so a POST in `supplements-section.tsx` counted
as a GET. The real figure was **68**, and it is **67** now because RV-79's own fix removed one. Each
figure was right when measured — but I had already, earlier the same day, had a sibling scan report
**7** sites where there were **191**, because its regex demanded `(` immediately after the name and
every call site was `cachedFetch<T>(…)`.

Two wrong counts from two scanners in one day, in opposite directions. So the test pins the **scan**,
not the count: the multi-line URL form, and all three ways a method can be declared. A figure from an
unpinned scanner is a guess with a number attached.

RV-79's journal entry carries an inline correction rather than a silent edit, since 69 was published
there and in its merged PR body.

## What is left, and why it is triaged inside the baseline

The ~20 conversions stay open, ordered in the `BASELINE` map itself so nobody re-derives the
judgement. Weakest are the six **per-query** reads (`?q=`, `?code=`, `?threadId=`, `?sessionId=`),
where a key must carry the query and a search-as-you-type key churns the cache for nothing.
Strongest are the **duplicated endpoints**, where one key would serve several sites: `day-checkin` at
three call sites, `phase-sets` ×2 and `workout-templates` ×2, `bedtime-estimate` ×2.

And the script's failure message carries RV-79's finding, because it is the thing most likely to be
forgotten: `cachedFetchCore` stores the response after any 2xx, so a route that can return `null`
needs `shouldCache` — without it a correct-looking conversion reintroduces the session-167 re-prompt.

**Not exercised:** nothing renders differently; this PR adds a check, a baseline and a test. `Ran 79
of 79` Custom Rules steps, up from 78 — which is why that count is read from the YAML rather than
hardcoded anywhere.
