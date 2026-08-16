# UI bug fixes — HR sleep bands · rest-day offer · unreadable charts · training-load latency

> Source: user report (2026-07-04, screenshots). Four independent, small fixes to
> already-shipped features. All four were investigated and prototyped in the
> reporting session, so the approach below is verified against the code — exact
> anchors and diffs are given. Ships as **one PR** (or split if any single fix
> turns out to need more; none is expected to). Wallpaper/per-page-background is a
> **separate** request already covered by backlog item "Per-screen wallpapers
> (Batch L)" — do not duplicate it here.

## Context / root causes (all confirmed in-session)

1. **HR "Sleep" bands scattered across the day.** The Home "Heart Rate · Today"
   chart shades sleep from the Oura per-reading `source` field, but includes
   `rest` as well as `sleep`. Oura tags any brief daytime stillness (sitting,
   lying down) as `rest`, so every quiet daytime stretch ≥20 min renders as its
   own purple "Sleep" band. Root: `components/health/hr-day-chart.tsx:125`
   passes `['sleep', 'rest']` to `findSourceWindows`.
2. **No rest/deload offer after 3 consecutive training days.** The AI-dynamic
   recommendation gate only flags deload/rest at **≥4** consecutive days
   (`lib/ai-periodization/ai-dynamic.ts:162`, `consecutiveTrainingDays < 4`). The
   counter counts trained days ending *yesterday*, so on the day after 3 straight
   days it returns 3 → `3 < 4` → nothing offered. User expected the Deload/Rest/Full
   option to appear.
3. **Health trend charts render black / unreadable.** `TrendSparkline`
   (`components/health/trend-sparkline.tsx`) draws on a chart.js `<canvas>`.
   Canvas `strokeStyle`/`fillStyle` **cannot resolve CSS custom properties** — a
   `color="var(--color-brand)"` prop silently falls back to **black**. The
   "Session Duration" chart (`workout-density-card.tsx:27`) and the Oura "Wear
   Time" chart (`oura-section.tsx:181`) both pass `var(--color-brand)` → black
   fill. Charts passing a concrete hex (e.g. Workout Density `#f97316`) render
   fine. Secondary bug: the translucent-fill shortcut `color + "18"` only works
   for `#rrggbb`; a resolved `oklch()`/`rgb()` value would break it.
4. **"Recommended" (Home) + "Training Load" (Health) feel slow.** Both are
   already cache-seeded + SWR (`next-session` seed at
   `session-select-content.tsx:135`; `training-load` seed at
   `health-content.tsx:257`), and both routes ship
   `max-age=60, stale-while-revalidate=120`. So repeat visits paint instantly;
   the residual cost is the **cold/post-invalidation** compute. The one clear
   waste: `/api/training-load` calls `repo.getWorkoutSessionsFrom` which hydrates
   full exercise **and set_log** trees for 28 days, then only sums per-session
   `exercise_logs.volume` — the `set_logs` fetch is entirely discarded.
   Recommendation has no comparable low-hanging waste; leave its engine alone.

## Task 1 — HR sleep band: source it from the actual sleep session, not per-reading source

**Revised 2026-07-04 after the user tested it.** The band today is inferred
client-side from each reading's `oura_heartrate.source`
(`hr-day-chart.tsx:125`, `findSourceWindows(readings, …, ['sleep','rest'])`), which
has **two** failure modes:
1. Including `rest` scatters phantom purple bands across the day (Oura tags brief
   daytime stillness as `rest`) — the original complaint.
2. On days where the readings carry **no** `sleep`/`rest` source tag at all, the
   band **and its legend disappear entirely** (`hasSleep = sleepWindows.length > 0`
   gates both, `hr-day-chart.tsx:178-200`) — the user confirmed the band vanished
   on their device. Simply narrowing to `['sleep']` (the earlier draft) makes this
   *worse* — it vanishes on any day Oura doesn't tag readings `sleep`.

**The band must show the actual sleep period, always, as one coherent block.** So
drive it from the real **sleep-session interval**, not the reading source:

- **API** — `app/api/oura/hr-day/route.ts`: alongside `readings`, also return the
  primary sleep interval covering that date's night. Load `sleep_sessions` for
  `date` **and the prior day** (sleep spans midnight), pick the main one with
  `pickPrimarySleep` (reuse the helper from `app/api/day-timeline/route.ts:46`,
  `MIN_MAIN_SLEEP_H = 3`), and return `sleep: { start, end }` (ISO
  `bedtime_start`/`bedtime_end`) or `null`. Ship the existing SWR headers.
- **Chart** — `hr-day-chart.tsx`: replace the `['sleep','rest']` source-window
  call with a single band built from the returned interval, converted to
  minute-offsets and **clipped to the chart's `[0, 1440]` window** (a night that
  ends ~07:00 on `date` renders 00:00→07:00; if bedtime starts before the
  displayed midnight only the morning portion shows; an evening sleep onset near
  22:00 shows 22:00→24:00). Keep the indigo fill/stroke and the "Sleep" legend
  (now gated on the interval being present, not on reading-source windows).
- Keep `findSourceWindows` **only** for the workout bands (unaffected). If no
  sleep session exists for the night, draw no sleep band (don't fall back to the
  `rest` heuristic).

**Why this is right:** the sleep session is the ground truth for "actual sleep
time" — one contiguous block, never scattered by daytime rest, and present
whenever the ring recorded sleep, independent of how individual HR samples are
tagged. The home screen already fetches `sleep-sessions`, so the data exists; the
cleanest single source is to return the interval from the hr-day route it's paired
with.

**Verify:** on a day with a synced primary sleep session, the chart shows exactly
one indigo band spanning the real sleep time (e.g. 00:00→~07:30) plus the "Sleep"
legend; no daytime bands; on a day with HR but no sleep session, no band (and no
crash). Seed a `sleep_sessions` row with known `bedtime_start`/`end` locally to
confirm the clip math at the midnight boundary.

## Task 2 — Offer rest/deload after 3 consecutive days

`lib/ai-periodization/ai-dynamic.ts:162`, in `computeDeloadStrength`:

```ts
if (consecutiveTrainingDays < 3) {   // was < 4
  return { recommended: false, strength: 'soft', temperatureAlert: false }
}
```

Because the counter (`countConsecutiveTrainingDays`, counts ending yesterday)
returns 3 on the morning after 3 straight days, `< 3` makes the Deload/Rest/Full
offer surface then. With high readiness the strength is `'soft'` (which suppresses
the "N sessions in a row" caption per `recommendation-card.tsx:239`) but the
3-button offer still renders — that IS "the option" the user wanted. The engine
keeps returning a normal session with `deloadOrRestRecommended: true`; it does
**not** need to return `isRestDay: true`.

Update the 3 threshold tests in `lib/__tests__/ai-dynamic.test.ts` (the
"below 4 / at 4 consecutive days" cases) to the 3-day boundary — done in-session,
27/27 green. Concretely: the "does not flag below" case uses 2 trained days
(`['Push','Pull']`, expect `consecutiveTrainingDays === 2`, not recommended); the
"soft/strong at threshold" cases use 3 trained days (`['Push','Pull','Legs']`).

## Task 3 — Make canvas sparklines resolve theme colors (fix black charts)

Fix once in `components/health/trend-sparkline.tsx` so every caller (incl. the two
`var(--color-brand)` ones) is safe. Add two helpers above `deltaChip`:

```ts
// Chart.js paints on a <canvas>, whose fillStyle/strokeStyle cannot resolve CSS
// custom properties — a `var(--x)` color silently falls back to black. Resolve it
// to the concrete computed value (this component is client-only / ssr:false).
function resolveColor(color: string): string {
  if (color.startsWith("var(") && typeof window !== "undefined") {
    const name = color.slice(4, -1).split(",")[0].trim();
    const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (resolved) return resolved;
  }
  return color;
}

// Translucent fill for the area under the line. The `+"18"` hex-alpha shortcut
// only works for #rrggbb; anything else (oklch, rgb, resolved var) needs color-mix.
function fillColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color)
    ? color + "22"
    : `color-mix(in srgb, ${color} 14%, transparent)`;
}
```

Then in the component, before building the dataset:

```ts
const lineColor = resolveColor(color);
const areaColor = fillColor(lineColor);
```

and use `borderColor: lineColor`, `backgroundColor: areaColor`,
`pointBackgroundColor: lineColor` in the dataset (replacing `color` and
`color + "18"`). In dark mode `--color-brand` resolves to
`oklch(0.723 0.219 149.579)` (vivid green — readable). oklch + color-mix on canvas
are supported on the S25 WebView (recent Chromium) and dev Chrome.

**Risk note / alternative:** if oklch-on-canvas is ever a concern on an older
engine, the bulletproof fallback is to pass concrete hex at the two call sites
instead (`workout-density-card.tsx:27` and `oura-section.tsx:181`, e.g.
`#38bdf8`), matching the all-hex palette the other charts already use. The
resolve-in-one-place approach is preferred because it preserves brand theming and
can't silently regress to black again.

**Verify:** on `pnpm dev` open Health → Training and confirm the Session Duration
line/fill render green (not black); toggle `.dark`/light. Local seed has real
session-duration data (today's session), so no synthetic rows needed.

## Task 4 — Trim training-load's discarded `set_logs` hydration

Add a lightweight aggregate repo method and use it in the route. Pure additive
read; no schema/migration.

- `lib/data/repository.ts`: new exported `SessionLoad` type +
  `getSessionLoadsFrom(userId, from): Promise<SessionLoad[]>` on the interface.

  ```ts
  export interface SessionLoad {
    startedAt: Date
    isEarlyDeload: boolean
    phaseType: ProgramPhaseType | null
    volume: number
  }
  ```

- `lib/data/postgres/adapter.ts` (after `getWorkoutSessionsFrom`, import
  `SessionLoad` from `../repository`):

  ```ts
  async getSessionLoadsFrom(userId: string, from: Date): Promise<SessionLoad[]> {
    const rows = await this.db
      .select({
        startedAt: s.workoutSessions.startedAt,
        isEarlyDeload: s.workoutSessions.isEarlyDeload,
        phaseType: s.workoutSessions.phaseType,
        volume: sql<number>`COALESCE(SUM(${s.exerciseLogs.volume}), 0)`,
      })
      .from(s.workoutSessions)
      .leftJoin(s.exerciseLogs, eq(s.exerciseLogs.workoutSessionId, s.workoutSessions.id))
      .where(and(eq(s.workoutSessions.userId, userId), gte(s.workoutSessions.startedAt, from)))
      .groupBy(s.workoutSessions.id)
      .orderBy(asc(s.workoutSessions.startedAt))
    return rows.map(r => ({
      startedAt: r.startedAt,
      isEarlyDeload: r.isEarlyDeload,
      phaseType: (r.phaseType as ProgramPhaseType | null) ?? null,
      volume: Number(r.volume),
    }))
  }
  ```

- `app/api/training-load/route.ts`: swap `getWorkoutSessionsFrom` →
  `getSessionLoadsFrom`; `isDeloadSession(ws: SessionLoad)`; inner loop uses
  `ws.volume` directly (drop the `ws.exercises.reduce(...)`). Import
  `SessionLoad` from `@/lib/data/repository`, drop the `WorkoutSession` import.

  This replaces 3 queries (sessions + exercise_logs + **set_logs**) with 1 grouped
  query and skips hydrating the largest table's rows the route never used.

- **Recommendation latency:** no code change. It's already seeded + SWR; the
  only remaining "slow" moment is the cold recompute after
  `invalidateWorkoutSummaries()` nukes the `next-session` seed post-workout. If
  the user still finds it slow after Task 4, a follow-up plan can optimistically
  preserve/patch the cached recommendation on `completeWorkout()` (mirrors the
  streak/calendar optimistic-stamp session 189 already added) — flagged, not done
  here, to avoid touching the recommendation correctness path speculatively.

**Verify:** `curl` `/api/training-load` against the local dev DB before/after —
identical `acwr`/`acuteLoad`/`chronicLoad`; confirm the ACWR card on Health →
Body still renders the same value. Add a repo-level test for `getSessionLoadsFrom`
if one fits the existing adapter test pattern.

## Wrap-up

- `pnpm tsc --noEmit && pnpm lint && pnpm test` (note: a pre-existing unrelated
  `lib/push.ts` `web-push` module-resolution tsc error exists on `main` — not
  introduced here). Both-theme manual pass on `pnpm dev` for Task 3.
- Patch fixes to shipped features → **patch** version bump + `lib/changelog.ts`
  entry; low-risk, exempt from the merge-confirmation gate per CLAUDE.md.
- **Not exercisable in sandbox (declare in the PR):** real Oura `rest`/`sleep`
  source data for Task 1, on-device Samsung WebView oklch/color-mix canvas
  rendering for Task 3, real prod-scale timing delta for Task 4.
