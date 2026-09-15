# BF-5 PR 2a — the weekly digest returns its numbers instead of throwing them away

**Lane A · branch `lane-a/bf5-weekly-digest-metrics` · engine half only.**

## What shipped

`app/api/weekly-digest` computed every number the "week in review" banner describes — week-over-week
volume and session counts, weighted sets per muscle, PRs, HRV, readiness, sleep score and hours,
daytime stress, resilience, OTS, weight change — flattened them into a prose block for the model,
and returned only the model's sentences. A page that wanted to *chart* the week had nothing to read
but those sentences.

Now `packages/shared/src/health/weekly-digest-metrics.ts` owns `WeeklyDigestMetrics` and
`buildWeeklyDigestContext`, the route assembles the metrics and formats the prompt **from** them,
and the response carries `metrics` on the fresh path **and the cached one**.

The cached path matters more than it looks: the banner fetches once per completed week, so the cache
hit is the common case and a page fed only by cache misses would be blank almost every time. The
metrics were already computed above the cache check — the cache only ever covered the prose.

No migration. `ai_health_insights.insight` is a `text` column holding prose; the metrics are
recomputed per request, which is what the route already did on every call including cache hits.

## The one claim worth checking, and how it was checked

The risk in this change is entirely that a template drifted and the model quietly got told something
different. Asserting "the prose is unchanged" from a transcription would share the error mode with
the transcription that produced the code.

So it was measured: one rich fixture — every context line populated, all values distinct — run
through `origin/main`'s route and through the rewritten one, both context blocks written to disk and
diffed. **Identical.** That captured block is now frozen in
`lib/__tests__/weekly-digest-metrics-route.test.ts` as the expected value, so any future wording
drift fails there.

Six mutations were run and all six were caught: rewording a line, swapping week/prior-week in the
readiness line, bucketing days in UTC instead of the user's timezone, letting HRV fall back per day,
returning `0` instead of `null` for a missing prior week, and dropping `metrics` from the cached
return. The deliberately-equivalent control — rewriting `meanOrNull`'s reduce as a loop — passed, as
it should.

## Two design points that are easy to get wrong later

**The daily series was never a scope increase.** The backlog entry left it open as a scoping
decision. Every metric was *already computed per day and then averaged away* — readiness comes out
of `liveReadinessByDay` as a `Map<day, value>`, sleep score out of `computeSleepScoreSeries` per
night, stress and volume off rows that carry their own dates. Returning the series is not extra
work, it is not discarding what is in hand.

**HRV chooses its source for the whole window, never per day.** The aggregate falls back from
overnight HRV to the `body_metrics` column only when no night in the window carries one, and the
series keeps that rule: days with no value in the chosen source stay `null`. A per-day fallback
would draw two instruments on one line with nothing marking where it changed — which is the exact
class of thing the readiness work spent weeks separating.

`volumeChangePct` is `null` rather than `0` when there is no prior week, for the same reason: `0`
draws as "no change", which is a different and false claim. The prose still renders that case as
"first week of data".

## Corrections to the entry's own claims

Three were stale and are fixed in the plan rather than re-derived later:

- The weekly reminder already carries `extra: { route: '/?review=week' }` (`day-review-reminders.ts`
  line 105) — **not** `'/'` at line 99. There is a live deep-link contract and
  `lib/__tests__/reminder-deep-links.test.ts` pins it, so 2b's retarget edits a test too. Its
  `ROUTES` rows are parsed as `route.split('?')`, so a query-less `/health/week` needs the test
  generalised rather than the row edited.
- `day-detail-content.tsx` is 299 lines, not 253.
- The route returned four fields, not two.

## What is NOT done

**PR 2b, the whole surface half, is owed and is Lane B's** — the page at `app/health/week/`, its
permanent Health entry point, the banner's chevron becoming navigation, the notification retarget,
and the stray trailing `*` the digest prose ends with. The backlog entry stays queued for it and its
`Lane:` is reclassified B accordingly.

**Nothing user-visible changed**, so no version bump and no changelog entry: the prompt is
byte-identical, the response only gained a field, and `WeeklyRecapBanner` types its `.then` as
`{ digest, weekStart }` and ignores the rest.

## Failure surfaces NOT exercised

Server/JS only — it reaches the device through a Railway deploy with no APK rebuild, and it touches
no offline-first domain, native plugin, safe-area, gesture or notification path, so no device smoke
run is owed. Not exercised: the real Gemini call (mocked in tests; the local dev run returned a real
200 through Postgres but the model response is the part the prompt feeds), Samsung WebView
rendering, and drifted production data — the local run used the dev seed shifted into the recap
window, and the shift was reverted afterwards.

Exercised on `pnpm dev` against the local Postgres with a real authenticated session: 200 with the
full metrics shape, `volumeChangePct` −25 across two real weeks, days bucketed to the right local
dates, gaps as `null`, and `hrv.source` correctly reporting `body-metrics` where the seed has no
overnight HRV.
