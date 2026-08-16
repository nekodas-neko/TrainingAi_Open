# R8 — Dates & Formulas Consolidation

**Source review:** `docs/reviews/2026-07-06-full-app-overview-review.md` §8 (batch R8),
re-verified against `main` on 2026-07-09 (review was 3 days old; line numbers updated,
already-fixed findings dropped — see the tail of this doc). **Branch:**
`refactor/dates-formulas-consolidation`. All changes are **server/JS + client-only** — they
ship via Railway into the WebView with **no APK rebuild**. Everything here is fully testable
on the local dev DB (`pnpm dev`) plus unit tests; every date-window change gets a boundary
test at **23:59 / 00:01 user-local** (the AEST-day-straddle regression class, CLAUDE.md
"Date Arithmetic"). No migrations, no schema change.

**Goal:** kill the last `Date.now() − N×86400000` window-anchor bugs and mixed-"today"-source
mismatches that corrupt AI answers and the Home week-strip, route every remaining `date` param
through `normalizeDateParam`, and fold the surviving duplicate formulas (linear-regression /
plateau, score-band, sleep-stage palette, ACWR thresholds, target-80, weighted-set constant,
`median`/date-formatters) back to one implementation each.

Governing CLAUDE.md rules, in force throughout:
- **Timezone** — never `new Date().toISOString().slice(0,10)`; use `todayInTz(tz)`.
- **Date Arithmetic beyond `todayInTz()`** — range/window starts anchor at the user's local
  midnight (`todayMidnightUtc(tz)`), never `now − N×86400000`; every route `date` param routes
  through `normalizeDateParam` before any arithmetic; new date aggregations get a 23:59/00:01
  boundary test.
- **One Formula, One Place** — two implementations of the same metric is a bug by definition;
  when fixing a formula, grep its duplicates and fix/delete them in the same PR.
- **Sibling-surface sweep** — a fix applied to one surface and not its siblings is half done.

---

## Chunk 1 — AI-answer-correctness date bugs (DATE-A3, DATE-A7)

Governing rules: **Date Arithmetic** (local-midnight window anchor; tz-aware year),
**One Formula One Place** (`shiftDateStr`), **Timezone** (one "today" source per feature).

These are the highest-severity items in the batch: they change the *numbers the AI reports*
and the *rest-day dots the Home screen paints*, not just internal hygiene.

### 1. `lib/ai-chat/tools.ts` — anchor every lookback window at `todayMidnightUtc(tz)`

`getTrainingLoadRisk` (currently lines 248–261) already does this correctly
(`const todayMid = todayMidnightUtc(tz)`); it is the in-file reference. Six other tools still
use the banned `Date.now() − N×86400000` pattern, so their windows straddle two AEST days:

| Tool | Current line | Current (banned) | Fix |
|------|--------------|------------------|-----|
| `getWorkoutsByExercise` | 19 | `new Date(Date.now() - (days ?? 90) * 86_400_000)` | anchor at `todayMid` |
| `getRecoveryVsPerformance` | 139 | `new Date(Date.now() - (days ?? 60) * 86_400_000)` | anchor at `todayMid` |
| `getDayOfWeekTrends` | 181 | `new Date(Date.now() - 90 * 86_400_000)` | anchor at `todayMid` |
| `getPlateauReport` | 197–198 | `Date.now() - 180…` / `- 10*365…` | anchor at `todayMid` |
| `getProgressVsPast` | 235–238 | raw-ms bucket edges (worst — below) | anchor at `todayMid` |
| `getMilestones` | 267–268 | `Date.now() - 10*365…` + `new Date().getFullYear()` | anchor + tz-year |

Compute the anchor once at the top of `buildChatTools` so every tool shares it:

```ts
import { todayMidnightUtc, shiftDateStr } from '@/lib/date-utils'

export function buildChatTools(repo: WorkoutRepository, userId: string, tz: string, todayIso: string) {
  const todayMid = todayMidnightUtc(tz)          // user-local midnight, as a UTC Date
  const daysAgo = (n: number) => new Date(todayMid.getTime() - n * 86_400_000)
  // …tools reference daysAgo()/todayMid instead of Date.now()…
```

Then per tool:

```ts
// getWorkoutsByExercise (line 19)
const from = daysAgo(days ?? 90)

// getRecoveryVsPerformance (line 139)
const from = daysAgo(days ?? 60)

// getDayOfWeekTrends (line 181)
const sessions = await repo.getWorkoutSessionsFrom(userId, daysAgo(90))

// getPlateauReport (lines 197–198)
const from180d = daysAgo(180)
const from10y  = daysAgo(10 * 365)
```

**`getProgressVsPast` (lines 233–244) — the worst case.** Raw-ms edges are used as the
*bucket boundaries* that split "current" vs "past", so a session logged in the AEST evening can
land in the wrong period. Anchor the whole comparison at `todayMid`:

```ts
execute: async ({ period }) => {
  const windowDays = period === 'month' ? 30 : 90
  const currentEnd   = todayMid                                   // local midnight, not `new Date()`
  const currentStart = daysAgo(windowDays)
  const pastStart    = daysAgo(windowDays * 2)
  const sessions = await repo.getWorkoutSessionsFrom(userId, pastStart)
  return {
    period,
    current: summarizePeriod(sessions, currentStart, currentEnd),
    past:    summarizePeriod(sessions, pastStart, currentStart),
  }
},
```

**`getMilestones` (lines 267–268) — tz-aware "PRs this year".** `new Date().getFullYear()` is
the UTC year, and `Date.UTC(year,0,1)` is Jan-1 00:00 **UTC** = Dec-31 10:00 AEST, so late-Dec
or early-Jan PRs are miscounted. Derive Jan-1 from the tz-local year via `dateStrMidnightInTz`:

```ts
import { dateStrMidnightInTz } from '@/lib/date-utils'
// todayIso is already 'YYYY-MM-DD' in the user's tz (passed into buildChatTools)
const jan1ThisYear = dateStrMidnightInTz(`${todayIso.slice(0, 4)}-01-01`, tz)
const from10y = daysAgo(10 * 365)
```

**Inline next-day shift (`getRecoveryVsPerformance`, line 158).** Replace the hand-rolled
`new Date(new Date(date + 'T00:00:00Z').getTime() + 86_400_000)` + `formatInTimeZone(...,'UTC',…)`
with the canonical helper:

```ts
const nextDay = shiftDateStr(date, 1)   // date is 'YYYY-MM-DD'
```

(These date keys are pure UTC-day strings used only as map keys on both sides, so
`shiftDateStr` — which is UTC-day arithmetic — is exactly right and drops the inline copy.)

### 2. `components/home/home-card-widget.tsx` + `session-select-content.tsx` + `workout-select-content.tsx` — one "today" source (DATE-A7)

This is the un-root-caused **"Home week-strip rest-day hydration mismatch"** Known Issue
(`projectOverview.md` line 2088, found session 208). Root cause confirmed: the server buckets
workout/rest days in **hardcoded AEST** (`adapter.ts` `to_char(… AT TIME ZONE 'Australia/Brisbane'…)`,
lines 917 & 972 — see Chunk 2), while the client builds the matching day keys in the **device
timezone**:

- `session-select-content.tsx` line 94 `deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone`,
  lines 96–98 `aestDateString()` and lines 897–907 `weekStrip` both key off `deviceTz`.
- `workout-select-content.tsx` lines 20–26 — same `deviceTz` + `aestDateString`.
- The morning-checkin marker keys off `todayInTz()` — a **third** "today" source in the same view.

On the S25 the device tz *is* Australia/Brisbane so it appears to work, but any DST-observing
device (or a traveller) mismatches, and the marker/strip/server can disagree by a day at the
23:00–10:00 window even on-device.

**Fix — pick `todayInTz()` (server-tz, `DEFAULT_TZ` unless a session tz is threaded) as the
single source in each of these views**, matching the server's AEST bucketing:

```ts
// session-select-content.tsx and workout-select-content.tsx
import { todayInTz, shiftDateStr } from '@/lib/date-utils'

// replace the deviceTz-based aestDateString(daysAgo):
function dayKey(daysAgo = 0): string {
  return shiftDateStr(todayInTz(), -daysAgo).replace(/-/g, '/')   // 'YYYY/MM/DD' to match server keys
}
```

Rebuild `session-select-content.tsx`'s `weekStrip` (lines 897–910) off `todayInTz()` instead of
`deviceTz` + `Date.now()`, so `todayStr`, the Monday anchor, and each `dateKey` all come from
the one server-tz source. Use `todayInTz()` for the morning-checkin-marker comparison too, so
strip, marker, and server buckets are identical.

`home-card-widget.tsx`'s sleep widget (lines 172–175) builds `_today`/`_yesterday` via
`new Date().toLocaleDateString('sv', { timeZone: deviceTz })`. Replace with:

```ts
const _today     = todayInTz()
const _yesterday = shiftDateStr(_today, -1)
const latest = sleepData.find(s => s.date === _today || s.date === _yesterday) ?? null
```

(The sleep-stage colours on line 178 of this same block are fixed in Chunk 3 — do both in one
edit to this file.)

**Verify (Chunk 1):**
- Unit test `lib/ai-chat/__tests__/tools-windows.test.ts`: with a **fake clock at 23:55 and at
  00:05 Australia/Brisbane** on the same civil day, `getProgressVsPast` and each lookback window
  return **identical** period boundaries (the anchor is `todayMid`, not `Date.now()`), and
  `getMilestones`' Jan-1 anchor lands on the correct tz-local year across a Dec-31-23:30 /
  Jan-01-00:30 AEST pair.
- `pnpm dev` → AI chat: ask "how am I doing vs last month" and "PRs this year" and confirm the
  session/PR counts match a manual DB query against the seed data.
- `pnpm dev` at ≤640px → `/session-select`: week-strip rest/trained dots, the morning-checkin
  marker, and the server-returned day summaries all agree for today and yesterday; sleep widget
  shows last night's row. (Device-tz vs server-tz divergence is not observable in the sandbox
  when both are AEST — note this as exercised only in AEST; the DST case rides the unit test.)
- `pnpm test` green; `pnpm lint` (the tightened rule from Chunk 2 must still pass this file).

---

## Chunk 2 — `normalizeDateParam` sibling sweep, tz-literal cleanup, lint tightening (DATE-A6, DATE-A5, DATE-A1)

Governing rules: **Date Arithmetic** ("every API route that accepts a `date`/`localDate` param
routes it through `normalizeDateParam` before any date arithmetic"; thread session tz, never
re-declare `DEFAULT_TZ`), **No global element-selector styling** analogue for the lint rule.

### 1. Route the surviving unvalidated `date` params through `normalizeDateParam` (DATE-A6)

The session-212 fix covered only `/api/day-log`. A raw param reaching `split('-')`/`aestMidnight`
is a `RangeError: Invalid time value` 500. Confirmed still-unguarded:

**`app/api/day-timeline/route.ts` (line 68).** Currently `const date = searchParams.get('date') ?? todayInTz(tz)`, then `shiftDateStr(date, -1)` and `new Date(\`${date}T00:00:00\`)`:

```ts
import { DEFAULT_TZ, todayInTz, shiftDateStr, normalizeDateParam } from '@/lib/date-utils'
// …
const raw = searchParams.get('date')
const date = raw ? normalizeDateParam(raw)?.replace(/\//g, '-') ?? null : todayInTz(tz)
if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
```

Also close the **`endMs` NaN-guard gap** at lines 212–216: the `startMs` finiteness check
(line 211) exists, but the `endTime` branch (line 214) can still produce `NaN` from a malformed
`log.endTime`. Guard it:

```ts
if (log.endTime) {
  const e = fromZonedTime(new Date(`${log.date}T${log.endTime.slice(0, 5)}:00`), tz).getTime()
  if (Number.isFinite(e)) endMs = e
} else if (log.durationMin != null) {
  endMs = startMs + log.durationMin * 60_000
}
```

**`app/api/workout-sessions/day/route.ts` (line 11–14).** Currently `date` is used as
`date.replace(/-/g, '/')` with no validation:

```ts
const raw = req.nextUrl.searchParams.get('date')
const slashDate = raw ? normalizeDateParam(raw) : todayInTz(tz).replace(/-/g, '/')
if (!slashDate) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
```

(`normalizeDateParam` already returns the `YYYY/MM/DD` slash form `getDayLog` expects.)

**`app/api/oura/hr-day/route.ts` (lines 14–19).** `dateParam.split('-').map(Number)` is unguarded:

```ts
const raw = req.nextUrl.searchParams.get('date')
const norm = raw ? normalizeDateParam(raw) : todayInTz(tz).replace(/-/g, '/')
if (!norm) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
const dateParam = norm.replace(/\//g, '-')       // downstream expects 'YYYY-MM-DD'
const [y, m, d] = dateParam.split('-').map(Number)
```

**`lib/validators/chat.ts` (line 12).** `localDate: z.string().optional()` accepts anything;
constrain the format so a malformed value is a 400 at the edge, not a 500 in
`log-exercise`/tools:

```ts
localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
```

**`lib/workout/log-exercise.ts` (lines 125–127).** A cheap guard before `aestMidnight` (the
route is also reachable via the sync `pushMutations` branch, so validate at the shared function):

```ts
const norm = normalizeDateParam(localDate ?? todayInTz(tz))
const rawDate = norm ?? todayInTz(tz).replace(/-/g, '/')
const [y, m, d] = rawDate.split('/').map(Number)
const startOfDay = aestMidnight(y, m, d)
```

### 2. Thread session tz / import `DEFAULT_TZ` — stop re-declaring the AEST literal (DATE-A5)

`'Australia/Brisbane'` is re-typed as a string literal (instead of importing `DEFAULT_TZ`) in
these product files (confirmed via grep 2026-07-09):

- Routes: `app/api/next-session/route.ts`, `app/api/workout-data/route.ts` (×2),
  `app/api/log-exercise/route.ts`, `app/api/achievements/route.ts`,
  `app/api/confirm-early-deload/route.ts`, `app/api/profile/[userId]/route.ts`.
- Clients: `components/overview-screen.tsx`, `app/session-select/session-select-content.tsx`
  (line 94), `app/workout-select/workout-select-content.tsx` (line 23).

Replace each literal with `import { DEFAULT_TZ } from '@/lib/date-utils'` and use `DEFAULT_TZ`.
(The two client `deviceTz` fallbacks at `session-select`/`workout-select` are subsumed by
Chunk 1's `todayInTz()` switch — once those views no longer read `deviceTz`, delete the literal
outright rather than swapping it for `DEFAULT_TZ`.)

Repo day-window helpers still hardcode AEST in raw SQL and helper defaults:

- `lib/data/postgres/adapter.ts` lines **917** and **972**:
  `to_char(${s.workoutSessions.startedAt} AT TIME ZONE 'Australia/Brisbane', 'YYYY/MM/DD')`.
- `lib/data/postgres/slices/oura.ts` line **423**: `shiftDateStr(todayInTz(DEFAULT_TZ), -30)`
  inside `getOuraWorkouts` (uses `DEFAULT_TZ` rather than the caller's tz).
- `lib/date-utils.ts` `aestMidnight`/`toAestDay`/etc. default their `tz` param to `DEFAULT_TZ`.

**Scope note:** fully threading the session tz through `getDaySessionSummaries`/`getDayLog` and
the two `AT TIME ZONE` literals is a wider signature change touching the repository interface.
This finding is **tracked-adjacent** (review §8 marks it so) and the app is AEST-only in
practice. For this PR: (a) do the cheap import cleanups above; (b) parameterise the two
`adapter.ts` `AT TIME ZONE` literals and `slices/oura.ts` line 423 to read from a `tz` argument
**where the calling method already has the session tz in hand**; (c) where the caller does not
yet pass tz, leave a `// TODO(tz): thread session tz — DEFAULT_TZ assumed` marker rather than
inventing a new plumbing path here. Do **not** re-declare `DEFAULT_TZ` locally anywhere.

### 3. Tighten the timezone lint rule (DATE-A1)

`eslint.config.mjs` (lines 29–43) has a `no-restricted-syntax` rule with exactly two selectors:
`.toISOString().slice(…)` and `.toISOString().split('T')[0]`. Escape hatches that silently pass
today (no live violations found, but they leave the door open):

- `.toISOString().substring(0, 10)` — `substring` not matched.
- `.toISOString().split('T')` read via an **intermediate variable** or non-literal index.
- `.toJSON()` (returns the same ISO string as `toISOString`).
- `new Date().toLocaleDateString('sv' | 'en-CA')` — the ISO-date locales, used as a
  `toISOString`-equivalent (this exact pattern is what `home-card-widget` used, Chunk 1).
- `scripts/**` is fully exempt (line 22) — acceptable for build scripts, but call it out.

Add selectors so the whole family is caught. Widen `slice` → `slice`|`substring`, add a `.toJSON()`
arm, and add the `sv`/`en-CA` `toLocaleDateString` arm:

```js
// substring/slice on a toISOString() result
{ selector: "CallExpression[callee.property.name=/^(slice|substring)$/][callee.object.callee.property.name='toISOString']",
  message: "Use todayInTz() from @/lib/date-utils — .toISOString().slice/substring returns UTC, wrong before 10am AEST." },
// .toJSON() date string
{ selector: "CallExpression[callee.property.name='toJSON'][callee.object.type=/NewExpression|Identifier/]",
  message: "Use todayInTz() — Date.toJSON() is the UTC ISO string, wrong before 10am AEST." },
// toLocaleDateString('sv' | 'en-CA') — ISO-date locale used as a UTC 'today'
{ selector: "CallExpression[callee.property.name='toLocaleDateString'] > Literal.arguments:matches([value='sv'],[value='en-CA'])",
  message: "Use todayInTz() / shiftDateStr() — toLocaleDateString('sv'/'en-CA') on a bare Date is a UTC date string." },
```

Run `pnpm lint` after adding: the only expected hits are the ones Chunk 1/2 already remove — if
a new hit surfaces elsewhere, fix it in this PR (sibling-surface sweep). Leave `scripts/**`
exempt but add a one-line comment above the `ignores` array noting the date rule does not cover
build scripts by design.

**Verify (Chunk 2):**
- Unit test `lib/date-utils/__tests__/normalize-route-params.test.ts` (or extend the existing
  date-utils test): each of the four routes' guard returns 400 for `2026-06-31`, `2026-13-01`,
  `2026/06/31`, and `garbage`; returns the correct slash/dash form for a valid `2026-07-09`.
- Boundary test: `day-timeline` and `oura/hr-day` with `date` at the civil day whose local
  midnight is computed at **23:59 vs 00:01 AEST** produce the same UTC window edges (no
  off-by-one-day).
- `pnpm dev` → hit `/api/day-timeline?date=2026-06-31`, `/api/workout-sessions/day?date=bad`,
  `/api/oura/hr-day?date=2026-13-01` → each returns 400 JSON, **not** a 500 stack.
- `pnpm lint` green with the tightened rule; grep confirms no `'Australia/Brisbane'` literal
  remains in the seven routes + three clients listed (only `lib/date-utils.ts`'s `DEFAULT_TZ`
  definition and intentional test fixtures).

---

## Chunk 3 — Formula consolidation: regression/plateau, score-band, sleep palette (DATE-B9, DATE-B4, DATE-B6)

Governing rule: **One Formula, One Place** — "two implementations of the same metric is a bug
by definition"; **Semantic palettes are defined once in `lib/` and imported** (Hypnogram's
`STAGE_COLOR` is the named reference).

### 1. Linear regression + plateau — one `linearFit`, one plateau definition (DATE-B9)

`lib/health/strength-projection.ts` **already exports `linearFit`** (lines 9–22) — it is the
canonical least-squares fit. Two other files re-implement the same slope math inline:

- `lib/ai-chat/analytics.ts` `classifyTrend` (lines 42–58) — index-spaced, normalised by mean,
  ±1%/session threshold.
- `lib/health/long-term-goal-progress.ts` `computeWeightRateKgPerWeek` (lines 10–19) —
  index-spaced ×7, kg/week.

And **two competing plateau definitions** disagree for the same exercise:
`strength-projection.ts` `projectRm` (lines 31–50) = **day-spaced**, ≥4 points spanning ≥21
days, |slope| < 0.2%/week (`PLATEAU_PCT_PER_WEEK`); `analytics.ts` `classifyTrend` =
**index-spaced**, ±1%/session. `getPlateauReport` (tools.ts) calls `classifyTrend`, so the AI
chat's "plateaued" verdict can contradict the Health screen's projection card.

**Fix:**

(a) Rebuild `classifyTrend` and `computeWeightRateKgPerWeek` on the exported `linearFit` so
there is one regression implementation:

```ts
// lib/ai-chat/analytics.ts
import { linearFit } from '@/lib/health/strength-projection'

export function classifyTrend(values: number[]): TrendClassification {
  if (values.length < 3) return 'plateaued'
  const fit = linearFit(values.map((y, x) => ({ x, y })))
  if (!fit) return 'plateaued'
  const meanY = values.reduce((a, b) => a + b, 0) / values.length
  const normalizedSlope = meanY !== 0 ? fit.slope / meanY : 0
  if (normalizedSlope > 0.01) return 'improving'
  if (normalizedSlope < -0.01) return 'declining'
  return 'plateaued'
}
```

```ts
// lib/health/long-term-goal-progress.ts
import { linearFit } from './strength-projection'

export function computeWeightRateKgPerWeek(weights: number[]): number | null {
  if (weights.length < 3) return null
  const fit = linearFit(weights.map((y, x) => ({ x, y })))
  return fit ? Math.round(fit.slope * 7 * 10) / 10 : null
}
```

(b) Reconcile the plateau **verdict** so the AI chat and Health screen agree. `getPlateauReport`
(tools.ts, lines 214–221) already has the dated series (`sorted` = `{date, orm}[]`). Feed it
into the day-spaced `projectRm` and derive the trichotomy from the same definition the Health
screen uses, instead of the index-spaced `classifyTrend`:

```ts
// lib/ai-chat/tools.ts, getPlateauReport
import { projectRm } from '@/lib/health/strength-projection'
// …
const sorted = entries.sort((a, b) => a.date.getTime() - b.date.getTime())
const proj = projectRm(sorted.map(e => ({ date: formatInTimeZone(e.date, tz, 'yyyy-MM-dd'), rm: e.orm })))
const trend: TrendClassification =
  !proj ? 'plateaued'
  : proj.plateau ? 'plateaued'
  : proj.slopePerWeek > 0 ? 'improving'
  : 'declining'
```

`classifyTrend` stays exported for any index-spaced caller, but now shares `linearFit`; the
**plateau verdict** now has a single day-spaced definition (`projectRm`). Document the retained
±1% index-spaced `classifyTrend` semantics with a one-line comment noting it is for
non-dated/equal-spacing series only.

### 2. Score-band re-derivations → `scoreBand()` (DATE-B4)

`lib/health/score-band.ts` `scoreBand(score)` (70/50 thresholds → `High`/`Moderate`/`Low` +
colour) is canonical. Two private re-derivations with the **same thresholds but drifted labels**:

- `lib/session-explain/group-signals.ts` `readinessBand` (lines 27–29) → `'Good'`/`'Fair'`/`'Low'`.
- `app/api/ai/health-insight/route.ts` `bandLabel` (lines 19–24) → `'high'`/`'moderate'`/`'low'`
  (plus a `null → 'unknown'` case).

Both call `scoreBand().label` instead. Where the surrounding copy needs a specific casing/word,
map from the canonical label rather than re-thresholding:

```ts
// group-signals.ts — delete readinessBand, at its call site:
import { scoreBand } from '@/lib/health/score-band'
const readinessLabel = scoreBand(score).label   // 'High' | 'Moderate' | 'Low'
```

```ts
// health-insight/route.ts — delete bandLabel, at its call site:
import { scoreBand } from '@/lib/health/score-band'
const label = score == null ? 'unknown' : scoreBand(score).label.toLowerCase()
```

If the demoted "the numbers" copy in `group-signals.ts` genuinely wants softer words
(`Good/Fair`), keep that as a **display map keyed on the canonical band** (`{ High:'Good',
Moderate:'Fair', Low:'Low' }[scoreBand(score).label]`) so the thresholds live in exactly one
place — never re-write the 70/50 numbers.

### 3. Sleep-stage palette → one `lib/` export (DATE-B6)

Canonical `STAGE_COLOR` (blue-family ramp: `deep #1e3a70`, `light #3f7dc9`, `rem #7ec3ea`,
`awake #e9d9c8`) currently lives in the **component** `components/health/hypnogram.tsx`
(lines 7–12) and is imported correctly by `components/health-metric-sheet.tsx` (line 6). But
`components/home/home-card-widget.tsx` (line 178) inlines a **drifted** palette
(`Deep #6366f1`, `REM #8b5cf6`, `Light #a78bfa`, `Awake #f59e0b`).

Move `STAGE_COLOR` to `lib/health/hypnogram.ts` (which already exports the `SleepStage` type,
line 3) so it is a pure `lib/` palette per the CLAUDE.md rule, then import at every site:

```ts
// lib/health/hypnogram.ts (add next to SleepStage)
export const STAGE_COLOR: Record<SleepStage, string> = {
  deep:  '#1e3a70', light: '#3f7dc9', rem: '#7ec3ea', awake: '#e9d9c8',
}
```

```ts
// components/health/hypnogram.tsx — re-export for existing importers, drop the local literal
export { STAGE_COLOR } from '@/lib/health/hypnogram'
```

```ts
// components/home/home-card-widget.tsx (line 178) — use the canonical palette
import { STAGE_COLOR } from '@/lib/health/hypnogram'
const stages = latest ? [
  { label: 'Deep',  hours: latest.deepSleepHours,  color: STAGE_COLOR.deep },
  { label: 'REM',   hours: latest.remSleepHours,   color: STAGE_COLOR.rem },
  { label: 'Light', hours: latest.lightSleepHours, color: STAGE_COLOR.light },
  { label: 'Awake', hours: latest.awakHours,       color: STAGE_COLOR.awake },
] : []
```

`health-metric-sheet.tsx` (line 6) keeps importing `STAGE_COLOR` from the component (the
re-export) — no change needed there, or repoint it to `lib/health/hypnogram` for cleanliness.

**Verify (Chunk 3):**
- `pnpm test` — `lib/health/__tests__/strength-projection.test.ts` still green after
  `classifyTrend`/`computeWeightRateKgPerWeek` rebuild; add cases asserting `classifyTrend` on a
  known monotonic-up / flat / down series returns `improving`/`plateaued`/`declining`, and that
  `getPlateauReport`'s verdict for a fixture exercise matches `projectRm(...).plateau` for the
  same dated series (the cross-screen agreement this fixes).
- `pnpm dev` → Health screen strength-projection card and AI-chat "what's stalled" report the
  **same** plateaued/improving verdict for the same exercise on seed data.
- Visual: Home sleep widget stage bars now use the navy→cream ramp identical to the Health
  hypnogram (previously indigo/violet). Verify at ≤640px in both light and dark themes (the
  palette is theme-neutral hex, but confirm contrast against both card backgrounds).
- Grep: no remaining inline `#6366f1`/`#8b5cf6` sleep-stage literals; `readinessBand`/`bandLabel`
  private functions deleted.

---

## Chunk 4 — Smaller formula dedup (DATE-B1, DATE-B2, DATE-B5, DATE-B7)

Governing rule: **One Formula, One Place**; **Sibling-surface sweep**.

### 1. ACWR band thresholds hardcoded in `readiness-score` (DATE-B1)

`app/api/readiness-score/route.ts` hardcodes the ACWR band boundaries (0.8 / 1.3 / 1.5) twice as
score modifiers: `computeBlendedScore` (lines 65–68) and `loadScore` (lines 184–188). The
canonical bands live in `lib/ai-periodization/acwr.ts` `acwrBand()` (lines 58–63).

Export the raw thresholds from `acwr.ts` and consume them so the modifier logic tracks the band
definition:

```ts
// lib/ai-periodization/acwr.ts
export const ACWR_THRESHOLDS = { lowMax: 0.8, optimalMax: 1.3, highMax: 1.5 } as const
// acwrBand() rewritten to read these constants (single source)
```

`readiness-score/route.ts` imports `ACWR_THRESHOLDS` and references
`ACWR_THRESHOLDS.lowMax`/`.optimalMax`/`.highMax` in both blocks instead of the bare numbers.
(The *score-modifier magnitudes* — `+3`, `−15`, the `6 × (acwr−1.3)/0.2` ramp — stay local to
this route; only the **band boundaries** move to the shared constant.)

### 2. Target-80 and 1RM-trend re-derivations (DATE-B2)

- `lib/ai-chat/context.ts` `build1RmTargets` (line 57) computes target working weight as
  `mround(orm * 0.8, 1.25)` — wrong rounding (1.25 vs the canonical 0.25) and ignores the
  style's `targetPct`. Use the canonical `estimateOneRm`/`target80` path. Since this helper only
  has the stored `estimated1rm` (not the raw sets), compute target80 with the canonical rounding
  and, where the exercise's style `targetPct` is available, honour it:

  ```ts
  import { mround } from '@/lib/1rm'
  // …
  lines.push(`${name}: est 1RM ${mround(orm, 0.25)}kg → target working weight ${mround(orm * 0.8, 0.25)}kg`)
  ```

  (Matches `calculate1RM`'s `target80 = mround(estimated1rm * 0.8, 0.25)`. If the caller can
  thread the per-exercise `targetPct`, prefer `mround(orm * targetPct / 100, 0.25)` — the same
  expression `estimateOneRm` uses — otherwise the 80% default is the documented fallback.)

- `lib/ai-periodization/signals.ts` (lines 140–146) re-implements ±0.5 kg 1RM-trend
  classification inline. Replace with the canonical `oneRmTrendStatus(projected, previous)` from
  `lib/1rm.ts` (returns `'up' | 'even' | 'down' | 'none'`), mapping `'even'/'none'` → `'flat'`
  for this file's `rm1Trend` type:

  ```ts
  import { oneRmTrendStatus } from '@/lib/1rm'
  const status = oneRmTrendStatus(current1rm ?? 0, prev1rm)
  const rm1Trend = status === 'up' ? 'up' : status === 'down' ? 'down' : 'flat'
  const rm1ChangeKg = current1rm != null && prev1rm != null ? current1rm - prev1rm : 0
  ```

### 3. Muscle folding + weighted-set constant in weekly-digest (DATE-B5)

`app/api/weekly-digest/route.ts` (line 81) folds muscles with a bare `ma.muscle.toLowerCase()`,
so synonyms don't fold — use the canonical `normalizeMuscle` from `lib/muscles.ts`:

```ts
import { normalizeMuscle } from '@/lib/muscles'
const muscle = normalizeMuscle(ma.muscle)
```

The `main = 1.0 / secondary = 0.5` weighted-set constant appears in ≥4 places (two raw-SQL, two
JS — the digest copy at line 80 among them). Extract the JS weighting into a tiny shared helper
in `lib/muscles.ts` (next to `normalizeMuscle`) and import it at the JS sites; the two SQL copies
stay but get a `-- weighted-set: main 1.0 / secondary 0.5 (see lib/muscles.ts roleWeight)`
comment so the coupling is visible:

```ts
// lib/muscles.ts
export const roleWeight = (role: 'main' | 'secondary') => (role === 'main' ? 1.0 : 0.5)
```

```ts
// weekly-digest/route.ts line 80
const weight = roleWeight(ma.role)
```

### 4. `median` + date-formatter duplicates (DATE-B7)

- **`median`:** `lib/workout/time-audit.ts` (lines 36–41) exports `median(values): number | null`.
  `lib/workout/session-recap.ts` (lines 26–30) re-implements a private `median(nums): number`.
  Import the `time-audit` export into `session-recap.ts` and delete the private copy (guard the
  empty case at the call site, since the shared one returns `null`). `app/api/weekly-digest`'s
  inline period summary stays on `summarizePeriod` (already shared via
  `lib/ai-chat/period-comparison.ts`) — the review's note there is documentary, not a live dup.
- **"days since last trained":** `app/session-select/components/recommendation-card.tsx`
  (lines 24–39) and `app/workout-select/workout-select-content.tsx` (lines 29–49) both compute
  "N days ago" from a cached `lastDate` via the same `todayAest.replace(/\//g,'-')` →
  `new Date(...T00:00:00Z)` diff. Extract to a shared client helper (e.g.
  `lib/date-utils.ts` `daysBetweenDateStrs(aIso, bIso)` operating on `YYYY-MM-DD`/`YYYY/MM/DD`)
  and have both call it, so the label logic lives once. After Chunk 1 both files already share
  `todayInTz()` for "today" — thread that in.
- **Slash-date display formatter (×3):** `components/workout/utils.ts` `formatSheetDate`
  (lines 41–44), `components/overview-screen.tsx` `fmtDate` (lines 72–75), and
  `app/stats/stats-content.tsx` (lines 225–228, inline in the SheetTitle) all do
  `new Date(raw.replace(/\//g,'-')).toLocaleDateString('en-AU', { month:'short', day:'numeric' })`.
  Promote one shared formatter (extend `components/workout/utils.ts`'s `formatSheetDate`, or a
  new `lib/date-utils` display helper) and import at all three; `stats-content`'s variant uses
  the long `weekday/day/month` form, so expose a small `{ style: 'short' | 'long' }` option
  rather than forking.

**Verify (Chunk 4):**
- `pnpm test` — add/extend `lib/__tests__/muscles.test.ts` to assert `roleWeight` and that
  `weekly-digest`'s muscle map folds a known synonym pair after `normalizeMuscle` (e.g. two
  synonyms sum into one bucket). Assert `session-recap`'s recap still produces the same median
  duration as before on a fixture.
- Unit: `oneRmTrendStatus`-driven `rm1Trend` in `signals.ts` matches the previous inline output
  across `+0.6`, `0`, `−0.6`, `null-prev` cases (a snapshot of the mapping).
- `pnpm dev`: AI context 1RM-target lines now round to 0.25 kg (spot-check one exercise against
  `calculate1RM`'s `target80` for the same estimate); readiness-score unchanged numerically
  (thresholds moved, magnitudes identical — assert one blended score before/after on seed data);
  weekly-digest muscle line, recap median, and the three date-formatter sites render identically.
- Grep: no remaining private `median`, no inline `0.8`/`1.25` target rounding in `context.ts`,
  no bare `role === 'main' ? 1.0 : 0.5` in JS outside `roleWeight`.

---

## End-of-session (rides in the implementer PR, not this planning PR)

Per CLAUDE.md, the implementer session that works this plan removes its backlog entry, appends
the journal + `projectOverview.md` update in the **same** PR, and — because Chunk 1 fixes a
user-visible correctness bug (AI numbers) and resolves the **"Home week-strip rest-day hydration
mismatch"** Known Issue (`projectOverview.md` line 2088) — strikes that Known-Issue row, bumps
`package.json` (patch) and adds a `lib/changelog.ts` entry. No device rebuild needed (server/JS
+ client only); the merge gate is green `pnpm dev` + `pnpm test` (including the 23:59/00:01
boundary tests) since none of these touch native/BLE/safe-area surfaces — though the Home
week-strip fix's DST divergence is only exercised by the unit test, not observable in the
AEST-only sandbox: note that in the presented work.

---

## Findings dropped / adjusted after 2026-07-09 re-verification against `main`

- **`linearFit` already exists and is exported** (`lib/health/strength-projection.ts:9`) — the
  review implied it needed creating; it does not. Chunk 3 builds the two duplicate regressions
  onto the existing export rather than adding a new one.
- **`getTrainingLoadRisk` (DATE-A3) already correct** — it uses `todayMidnightUtc(tz)`
  (`tools.ts:252`). Dropped from the fix list; kept as the in-file reference pattern.
- **`recommendation-card.tsx` "days since" is not verbatim-identical** to
  `workout-select-content.tsx` (one renders a weekday name via `toLocaleDateString`, the other
  an "N days ago" string). Still consolidated in Chunk 4, but noted as *near*-duplicate sharing
  the same core diff, not a copy-paste.
- **`weekly-digest` `summarizePeriod` "inline equivalent" (DATE-B7)** — the digest computes its
  volume/count inline but the shared `summarizePeriod` (`lib/ai-chat/period-comparison.ts`)
  already carries a documented "candidate to migrate, not forced" note. Left as-is (documentary,
  not a live divergence); only the `median` and date-formatter dups are actioned in Chunk 4.
- No R8 finding was found **already fully fixed** on `main` — all cited divergences still
  present as of 2026-07-09 (line numbers updated throughout this doc from the review's originals).
