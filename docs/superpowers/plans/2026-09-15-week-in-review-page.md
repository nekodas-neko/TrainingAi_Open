# BF-5 — the week in review becomes a page, drawn from returned numbers

**Status:** planned 2026-09-15 (Lane A). Splits into **PR 2a — engine (Lane A)** and
**PR 2b — surface (Lane B)**. 2a is shippable alone and changes nothing a user can see.

**Owner request, 2026-08-23, verbatim:** *"rather than chevron type display; id rathee its own page
that you can get to from a banner notifcation; or a permanent link in the health tab somewhere - the
page shohld be more indepth; kinda like the training calendar entry; but for the whole week. so it
can visually compare the week based on the metrics its talking about."*

---

## 1. What is actually true today (re-verified against `main` 5e4c8df/656aef8, 2026-09-15)

`app/api/weekly-digest/route.ts` (263 lines) computes every number the banner describes, flattens
them into a newline-joined `context` string (line 216), hands that to `generateText` (line 248), and
returns **`{ digest, weekStart, generatedAt, cached }`** (line 262). The structured values are
discarded. That is the blocker, and it is confirmed.

**Three of the backlog entry's supporting claims are stale. Correcting them here so the
implementer does not re-derive them:**

| Entry says | Actually |
|---|---|
| returns `{ digest, weekStart }`, prose at "line ~255" | returns four fields; `context` is built at 216, the return is at 262 |
| notification carries `extra: { route: '/' }` at `day-review-reminders.ts:99` | **`extra: { route: '/?review=week' }` at line 105** — the deep link already exists (Q-112a) |
| `day-detail-content.tsx` is 253 lines | 299 |

The middle row is the one that matters. Retargeting the notification is still roughly a one-line
change, but it is **not** a change from "goes nowhere" to "goes somewhere" — there is a live
contract, `WeeklyRecapBanner forceOpen`, and **a test that pins it**:
`lib/__tests__/reminder-deep-links.test.ts` holds a three-row table asserting that each reminder's
`extra.route` names a param some screen actually reads. Moving the weekly reminder to `/health/week`
means editing that row in the same PR, and the new page must read whatever param replaces it (or the
row becomes `route: '/health/week'` with no query, which the test's `route.split('?')` does not
currently handle — see §5).

## 2. The decision this plan takes: the metrics ARE the return value, and the prose is formatted FROM them

Two rules constrain the shape before any preference does:

- **Never parse the numbers back out of the model's text.** `CLAUDE.md` bans `JSON.parse` of free
  text, and this is worse: the prompt says *"quote its numbers, never invent or recompute any"*,
  which is an instruction, not a guarantee.
- **One formula, one place.** If the route builds a structured object *and* keeps its current
  hand-written `context` lines, the same numbers get formatted twice and drift. So the structured
  object is computed first and **the context lines are derived from it**.

That second point is why 2a is a little more than "also return an object", and it is the reason to
do it as its own PR: the prose fed to the model must come out **byte-identical**, and that is
assertable.

### What 2a adds

`packages/shared/src/health/weekly-digest-metrics.ts` — a new module owning:

- **`WeeklyDigestMetrics`**, the returned shape (§3). Lives in `packages/shared` because Lane A
  produces it and Lane B's page consumes it; a type in `app/api/**` is not importable from a screen
  without reaching across the lane boundary.
- **`buildWeeklyDigestContext(metrics): string`** — the prose block the prompt receives, produced
  from the metrics rather than from the raw rows.

The route keeps every one of its current computations (they are all correct and several carry
hard-won comments — the nights-only sleep scoring, the series-then-window ordering, the live
readiness fallback); it assembles them into `WeeklyDigestMetrics` instead of into strings, then calls
`buildWeeklyDigestContext`.

**The response gains `metrics` on both paths, including the cached one.** The metrics are computed
*before* the cache check at line 236, so the early return at 237 can carry them at no cost. This
matters more than it looks: the cached path is the common one (the banner fetches once per week), so
a page that only got metrics on a cache miss would be blank almost always.

**No migration.** `ai_health_insights.insight` is `text` and stores prose only — confirmed in
`lib/data/postgres/schema.ts:876`. The entry offers "add a JSONB column" or "recompute on load"; this
plan takes **recompute**, per the entry's own *"recomputing is the cheaper first cut"*. The route
already does the full computation on every call including cache hits, so recomputing costs nothing
that is not already being paid.

## 3. The daily series is free, which dissolves the entry's open scoping question

The entry says: *"HRV, readiness and sleep are currently single averages; a daily series is what
makes them chartable, and whether that is in scope is a scoping decision, not an assumption."*

**Checked per metric against the route. Every one is already computed per day and then averaged
away:**

| Metric | Per-day source already in hand |
|---|---|
| readiness | `liveReadinessByDay(derivedRows, ouraRows)` returns a `Map<day, value>` — line 161 |
| sleep score | `computeSleepScoreSeries(...)` returns per-session rows with `.session.date` — line 131 |
| sleep hours | `recapSleep` rows carry `.date` and `.durationHours` — line 118 |
| daytime stress | `derivedRows` carry `.day` and `.stressHighMinutes` — line 185 |
| volume / sessions | `recapWeekSessions` carry `startedAt` and per-exercise `volume` — line 78 |
| HRV | `sleepSessions` carry `.date`/`.averageHrvMs`; `bodyMetrics` carry `.date`/`.hrvMs` — line 147 |

So the series is not a scope increase — it is *not throwing away* what the route already has. The
scoping decision is therefore **take the series**, and the thing that would have been expensive
(re-querying per day) never arises.

**One real subtlety, in HRV and only HRV.** The aggregate picks its *source* for the whole window:
`sleepVals.length > 0 ? sleepVals : bmVals` — overnight HRV if any night has it, otherwise the
body-metrics column. A per-day series must **keep that window-level source selection** and map days
within the chosen source, not fall back per day. Falling back per day produces a chart whose points
come from two different instruments with no marking, which is exactly the class of thing the
readiness work spent weeks separating. Days with no value in the chosen source are `null` — a gap in
the line, which is honest.

**Volume must be bucketed in the user's timezone** — `formatInTimeZone(ws.startedAt, tz, 'yyyy-MM-dd')`,
never `toISOString().slice(0,10)`. A session started at 08:00 Brisbane is 22:00 UTC the previous day,
so a UTC bucket moves it to the wrong bar and, at a week boundary, out of the week entirely.

### `WeeklyDigestMetrics`, concretely

```ts
interface DailyPoint { date: string; value: number | null }

interface WeekOverWeek {
  week: number | null
  priorWeek: number | null
  byDay: DailyPoint[]          // 7 entries, recap-week Mon..Sun, null where unmeasured
}

interface WeeklyDigestMetrics {
  weekStart: string            // recap-week Monday, user-local ISO
  weekEnd: string              // recap-week Sunday
  priorWeekStart: string

  training: {
    sessions: number
    priorSessions: number
    volumeKg: number
    priorVolumeKg: number
    volumeChangePct: number | null       // null = "first week of data", never 0
    byDay: { date: string; volumeKg: number; sessions: number }[]
  }
  muscleSets: { muscle: string; sets: number }[]   // weighted, sorted desc
  prs: { exerciseName: string; estimated1rm: number; description: string }[]

  hrv: WeekOverWeek & { source: 'overnight' | 'body-metrics' | null }
  readiness: WeekOverWeek
  sleepScore: WeekOverWeek
  sleepHours: WeekOverWeek
  stressHighMinutes: WeekOverWeek

  illness: { flag: string; biomarkers: Record<string, { z: number }> | null } | null
  resilience: { level: number; band: string; asOf: string } | null
  ots: { avg: number; hasHighLoadDay: boolean } | null
  weightChangeKg: number | null          // over the 2-week window, as today
  friendCount: number | null
}
```

**`volumeChangePct` is `null`, not `0`, when there is no prior week.** The current code renders that
case as the string `'first week of data'`; a number cannot carry it, and `0` would draw as "no
change", which is a different and false claim. The page must render the null case as its own state.

**`prs[].description` is `describePersonalRecord(...)`, kept alongside the raw number.** A bodyweight
PR is `BW_REF`-relative and must never be announced as a weight (Q-19) — the formatter already knows
that and the page must not re-derive it from `estimated1rm`.

## 4. PR 2a — Lane A, engine (this is what to build first)

1. Add `packages/shared/src/health/weekly-digest-metrics.ts` with the type and
   `buildWeeklyDigestContext`.
2. Rework `app/api/weekly-digest/route.ts` to build `WeeklyDigestMetrics`, format the context from
   it, and return it on both the cached and the fresh path.
3. Tests:
   - **The context block is byte-identical to today's.** Freeze the current output for a fixture
     input and assert equality. This is the whole safety argument for 2a: the model's input does not
     change, so the prose does not change, so nothing user-visible changes.
   - Per-day series land on the right days for a user in a non-UTC timezone, with a session started
     inside the UTC-crossing window (the 08:00 Brisbane / 22:00 UTC case) — derive the fixture from
     the clock or inject it, never hardcode one side of a rolling window.
   - HRV source selection: a window with one overnight value and five body-metrics values reports
     `source: 'overnight'` and five `null` days, not a mixed series.
   - `volumeChangePct` is `null` when the prior week is empty.
   - The cached path returns `metrics`.
4. Mutation pass with at least one deliberately-equivalent control.

**Contract risk to state plainly:** adding a field to a JSON response is additive and no existing
client reads it, so 2a cannot break the banner. `WeeklyRecapBanner` types its `.then` as
`{ digest: string; weekStart: string }` and ignores the rest.

## 5. PR 2b — Lane B, surface (do not start before 2a merges)

- `app/health/week/` as `page.tsx` + `week-detail-content.tsx`, alongside `app/health/day/`, which
  is the shape the owner named (*"kinda like the training calendar entry"*).
- Charts drawn from `metrics`. `react-chartjs-2` is installed; do not hand-roll.
- The banner's chevron becomes navigation rather than an expander. Keep its once-per-week +
  dismissed-in-`localStorage` behaviour — it is the entry point, not the content.
- **A permanent entry point in Health**, because the owner asked for one and because a page reachable
  only from a dismissible banner is unreachable for the rest of the week.
- Retarget the reminder and **update `lib/__tests__/reminder-deep-links.test.ts` in the same PR.**
  Note its `ROUTES` rows are parsed as `route.split('?')` then `query.split('=')`, so a
  query-less `/health/week` would need the test generalised rather than just the row edited. The
  cheaper option that keeps the test as-is: keep a param the page reads.
- **The stray trailing `*`** the entry noticed (*"maintaining these gains.\*"*) is a markdown artifact
  reaching the user through `<Response>`. A page makes it more visible. Fix it where the prose is
  rendered; it is not a metrics problem.

## 6. What this plan deliberately does NOT do

- **No JSONB column and no stored metrics.** A page opening *last* week recomputes. If the owner ever
  wants an arbitrary past week, that is a real query-range change and its own entry, not a column
  bolted on now.
- **No change to what the model is told or how the prose reads.** 2a is byte-identical by
  construction and asserted as such; any wording change is a separate decision.
- **No new AI call.** The page draws the numbers the route already has.
