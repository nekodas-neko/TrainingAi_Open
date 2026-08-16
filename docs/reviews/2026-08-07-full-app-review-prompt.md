# Prompt — full-app deep review (saving · caching · performance · logic)

**Written:** 2026-08-07 · **For:** a fresh review session · **Type:** planning/review, docs-only output

This file is a **ready-to-paste prompt**. Everything below the horizontal rule is the prompt.
It was written against `main` at `891ffc8` (v1.267.15): 201 API routes, 40 page routes,
~182k lines of TS/TSX, 405 test files, 169 Postgres migrations, local SQLite v21.

---

## Prompt

You are running a **full-app deep review** of TrainingAI. The last comparable sweep was
`docs/reviews/2026-07-20-wiring-caching-perf-audit.md`; roughly 400 commits and 40+ features have
landed since. The owner wants to know whether **saving, caching, performance, and domain logic
still work the way they are supposed to**, across every screen and every route — not a spot check.

### What this session is and is not

- **It IS**: a read-and-measure sweep that produces a review document, `projectOverview.md`
  Known-Issues rows, and prioritised backlog entries.
- **It is NOT** an implementation session. Ship **one docs-only PR**. The only code changes
  permitted are one-line fixes so trivially safe and obviously correct that queueing them would
  cost more than doing them — and if you make any, say so explicitly in the review doc and bump
  `package.json` + `lib/changelog.ts`. Everything else becomes a backlog entry.
- Per **Backlog-driven implementation** in `CLAUDE.md`: plan now, build later.

### Read first, in this order

1. `projectOverview.md` — current status, and especially the **Known Issues & Risks** tables.
   There are ~234 `###` sections in that file. **You must not re-raise anything already
   recorded there.** Build a list of the open (🔴/🟠/⚠️) rows before you start looking at code, so
   you can recognise a re-discovery when you hit one.
2. `docs/implementation-backlog.md` — same reason. An already-queued item is not a finding.
3. `CLAUDE.md` — the rule sections *are* the review checklist. Every strict rule in that file
   exists because the bug class it names shipped at least once, usually more.
4. `docs/domains/README.md` and each pillar index you touch.
5. `docs/module-map.md` — before you flag anything as "should be shared", check whether the shared
   thing already exists.

### Step 0 — production reality check, before you read any code

Two reads that only work against live data. Do both first; they steer everything after.

**a) `error_events`** (prunes at 30 days — a fault that stopped is a fault nobody will ever see
again):

```bash
curl -sX POST https://trainingai-production.up.railway.app/api/admin/db-query \
  -H "Authorization: Bearer $CLAUDE_DB_QUERY_SECRET" -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT url, source, left(message,160) AS message, count(*) AS hits, min(created_at) AS first_seen, max(created_at) AS latest FROM claude_ro.error_events WHERE created_at > now() - interval '"'"'30 days'"'"' GROUP BY 1,2,3 ORDER BY hits DESC LIMIT 60"}'
```

Every distinct signature gets a verdict: known-and-recorded, new-and-recorded-this-session, or
stopped-with-no-explanation. *Something that stopped is not something that was fixed.*

**b) Write-path liveness.** For each synced domain, ask the DB when it was last written and
whether the shape looks right. The list of synced domains is authoritative in
`packages/shared/src/sync/mutation-schema.ts` (`SYNCED_MUTATION_DOMAINS`) and mirrored by the
`pushMutations` branches in `lib/data/postgres/adapter.ts` — today that is `activity_logs`,
`body_metrics`, `complete_workout`, `day_checkins`, `fitness_tests`, `food_items`, `food_logs`,
`injuries`, `mood_logs`, `oura_daily_derived`, `oura_daily_summary`, `prescribed_run`,
`saved_meals`, `session_rpe`, `sleep_session`, `supplement_logs`, `supplements`, `workout_log`.
For each: `max(created_at)`, row count over the last 30 days, and the null-rate of the columns the
UI renders. **A column that is 100% null is a dead write path** — that exact signature has now been
found three times (`workout_hr_stats`, `onset_latency_sec`, the `program_phases` scope column).
`docs/reviews/2026-08-05-data-collection-gap-sweep.md` is the prior art; diff against it rather
than repeating it.

Findings from Step 0 outrank anything you find by reading code. A silently-broken write path in
production beats a theoretical cache bug every time.

### Step 1 — build the coverage ledger

Do not review "the app". Review a list, and show the list.

```bash
find app/api -name route.ts | sed 's|app/api/||; s|/route.ts||' | sort   # 201 routes
find app -name page.tsx | sort                                          # 40 pages
```

Re-derive both — do not trust the counts in this prompt. Group them by the eleven pillars
(`sleep`, `readiness`, `heart-rate`, `cardio`, `activity`, `workouts`, `nutrition`, `body`,
`devices`, `app-shell`, `platform`) and carry the grouped list into the review doc as a **coverage
table with a verdict per group**. A group you did not reach is recorded as *not reviewed*, not
omitted. Silent partial coverage reads as "we checked everything" when you didn't — that is the
single most damaging thing this review can do.

Two things the ledger should surface on its own:
- **Dead routes.** For every route, does anything call it? `grep -rn "api/<route>" app components lib`.
  The 2026-07-20 audit found unwired routes; new ones accumulate the same way. A route with zero
  callers is either dead code to delete or a feature that silently never shipped — decide which.
- **Legacy redirects.** `app/sheet/[id]/*` are redirect shims to `/workout`, `/config`, `/chat`,
  `/overview`. Confirm they are still reachable/needed, or queue their removal.

### Step 2 — the eight lenses

Run these as parallel sweeps. Each lens has a rule section in `CLAUDE.md` that defines the
correct behaviour — read the rule, then go looking for its violations. The greps below are
starting points, not the sweep.

---

**Lens 1 — Saving: write paths and the offline outbox.**
Rules: *Offline Sync*, *Offline-First*, *Canonical Runtime* ("one write function per domain").

The recurring failure is drift between the web API route and the `pushMutations` branch in
`lib/data/postgres/adapter.ts` (6,323 lines). Web works, the APK strands silently. For each synced
domain, diff the two paths on: defaults, Zod validation, `ON CONFLICT` target, ownership scoping,
and side effects (PR upserts, phase counters). `scripts/check-push-mutations.js` only catches raw
`this.db`/`sql` usage — it cannot catch semantic drift.

Then, per domain, verify the full chain in one pass: local table columns = server payload fields =
`getSyncDelta` output = `pullDelta` mapping = `applyDelta` upsert columns, **including reference
tables needed to render**. Check `applyDelta` gates on `sync_status === 'synced'` before
overwriting (a pull must never revert a pending local edit), and that every UPDATE/DELETE is
`user_id`-scoped.

Poison-pill handling: does one 4xx mutation quarantine, or does it wedge the queue behind it?
Three production incidents (#47, #74, #82). Confirm confirm/delete is by mutation `id`, never a
`domain:date` composite.

Read-site check: **if a domain writes to the local store, its UI must read from the local store.**
The sanctioned exceptions are cross-session server aggregates (`weekly-stats`,
`weekly-muscle-sets`, `weights-summary`, `muscle-recovery`) and `home-day-timeline.tsx`. Anything
else reading server-only after writing locally is a finding.

```bash
grep -rn 'fetch("/api/' components app --include=*.tsx | grep -v cachedFetch   # unqueued writes
grep -rn '\.catch(() => {})' app components lib                                 # swallowed failures
```

Also chase the one open production fault in this area: the `/api/sync/pull` intermittent
per-domain query failure (Known Issue, found 2026-08-05/06, **not fixed**, cursor stuck 4+ days on
one device). It is the highest-value open thread in the sync layer — if you can pin the cause,
that alone justifies the session.

---

**Lens 2 — Caching and invalidation.**
Rule: *Cache Invalidation* — 12+ incidents, the most-repeated bug class in the project.

83 files touch `cachedFetch`/`readCacheSync`; `lib/cache-groups.ts` is 428 lines;
`packages/shared/src/cache-ttl.ts` is 103.

- Every mutation invalidates via a named group in `lib/cache-groups.ts`. There are currently 3
  `invalidateCache(` call sites outside that file — check each one is legitimate.
- For every cache key, enumerate **every** writer whose data feeds it and confirm the key is in
  each writer's group. The 2026-07-20 audit found `achievements:` missing from the nutrition and
  body-metric writers for exactly this reason.
- One canonical TTL per key. `READINESS_SCORE_TTL` is the reference pattern; any key fetched at ≥2
  sites needs a named constant in `cache-ttl.ts`.
- One fetch variant per key — always `cachedFetch` or always `cachedFetchToday`, never both.
- Any "today" cache embeds the local date in its key **or** guards the date on read, on both the
  seed path *and* the `cachedFetch` onData hit path.
- `freshWithinTtl: true` requires a written invalidation proof: list every writer, show the key is
  in each group.
- No bare key that is a prefix-sibling of a group prefix (`health-trends` vs `health-trends:`).
- New aggregate GET routes ship `Cache-Control: private, max-age=60, stale-while-revalidate=120`.
- Legacy seed keys: confirm `ta_recommendation_v1`/`ta_meta_v1` are still cleared through
  `clearLegacyHomeSeeds()` from both `invalidateWorkoutSummaries()` and
  `invalidateProgramStructure()`, and that no new legacy seed has appeared.

---

**Lens 3 — Performance: instant paint and render discipline.**
Rules: *Mobile UI & Performance*.

- Every screen/widget seeds synchronously from cache and revalidates in the background. A skeleton
  flash on a repeat visit is a bug. Seed in `useEffect`, **never** a `useState` lazy initializer
  (hydration mismatch — and note there is an open Known Issue: *React hydration error on the home
  screen, 283 occurrences, still happening*. Chase it under this lens; it is 🔴 and unfixed).
- `React.memo` only works with stable props — an inline arrow or object literal at the call site
  defeats it silently. Both long-standing memos in this codebase were broken exactly that way.
  Check call sites, not just the memo.
- Zustand: narrow selectors, hot-path fields read by the leaf that renders them. The workout
  orchestrator's broad `useShallow` pick was flagged 2026-07-20 — verify whether it was fixed or
  quietly grew.
- Timers (`setInterval`, `useCountUp`, `useElapsedSec`, rAF) live in the leaf that displays the
  number, never in an orchestrator.
- Heavy widgets (chart.js, markdown/KaTeX, AI chat) via `next/dynamic({ ssr: false })`; a
  `loading:` skeleton on a cache-seeded card is a contradiction.
- Component size. Current files over 800 lines: `components/workout-screen.tsx` (1851),
  `app/session-select/session-select-content.tsx` (1478), `components/config-screen.tsx` (997),
  `app/health/health-content.tsx` (991), `components/config/program-editor-sheet.tsx` (963),
  `components/more/profile-tab.tsx` (849). Re-derive with
  `find app components -name '*.tsx' -exec wc -l {} + | sort -rn | awk '$1 > 800'`. The workout
  orchestrator has grown ~170 lines since it was last flagged. Propose concrete extractions, not
  "should be split".
- Saves feel instant: UI feedback fires synchronously after the local write, never after
  `await fetch`. No serial `await` POSTs in a loop. No slow external round-trips auto-fired on
  screens the user is leaving.
- Waterfalls and over-fetching: routes awaiting sequentially what could be `Promise.all`; pages
  firing N requests where one aggregate exists.

---

**Lens 4 — Domain logic and correctness.**
Rules: *One Formula, One Place*; *Stored Counters*; *Date Arithmetic*; *Timezone*.

- Grep for duplicated formulas before trusting that consolidation held: 1RM, ACWR, weekly cadence,
  expected RPE, score bands, muscle-name normalisation, macro/sleep palettes. `scoreBand()` and
  `packages/shared/src/health/score-band.ts` are the canonical homes. Two implementations of one
  metric is a bug by definition.
- Stored counters: every one in this project has drifted. `sessions_in_phase` was fixed three
  times. Find every stored counter, and for each confirm it is either derived at read time or
  paired with a reconcile-on-read self-heal.
- Timezone. The forbidden patterns:
  ```bash
  grep -rn "toISOString().slice(0, *10)\|toISOString().split('T')" app components lib packages
  grep -rn "toLocaleTimeString\|toLocaleDateString" app components lib | grep -v timeZone
  grep -rn "86400000\|864e5" app components lib packages     # ms-offset windows
  ```
  `components/oura-ble/` and `components/admin/` are deliberately exempt from the `toLocale*` rule.
- Every route accepting a `date`/`localDate` param routes it through `normalizeDateParam`, **and**
  its Zod regex accepts both separators (`/^\d{4}[-/]\d{2}[-/]\d{2}$/`) because the client's
  `localDateString()` emits slashes. A dash-only regex rejects every real request before the
  handler runs, invisibly. `body-metadata` is the reference.
- Window boundaries anchor at the user's local midnight, never `now − N×86400000`.
- Validate `new Date(string)` built from DB/API values.

---

**Lens 5 — Route hygiene: auth, validation, ownership, rate limits.**
Rules: *AI & Security Defaults*; *Process & Review Discipline*.

Per route (all 201): does it authenticate; is the body Zod-validated at the boundary; are
client-supplied row ids ownership-verified (including tables with no `user_id`, via a join to the
owning table); does a user-scoped UPDATE check the affected-row count before any dependent child
write; is a raw request body ever passed into Drizzle `.set()`; does an AI/expensive route carry
the standard rate limit; do failure paths surface an error state rather than returning `null`.

Webhook routes verify signatures before the response can diverge on unverified payload fields.
Security checks fail **closed**.

AI routes: structured output via `generateObject`/response schema, never `JSON.parse` of free
text; every `generateText`/`streamText` in try-catch returning a JSON error; no LLM self-reported
number gating an automatic action.

The admin surface is large (~25 routes under `app/api/admin/`) and includes `db-query` and the
`ADMIN_EXPORT_SECRET` bearer path on `day-review`. Confirm both are still `requireAdmin`-gated and
fail-closed on a missing env var.

---

**Lens 6 — UI: safe area, theme, primitives.**
Rules: *Safe-Area Insets*; *Android WebView Gotchas*; *Visual consistency & theme*.
Load the `ui-ux-pro-max` skill for this lens.

- Bottom-anchored controls use a **floored** utility (`pb-safe-action`, or `pb-safe-action-lg` for
  navless/full-screen flows) — never bare `pb-safe`, never bare `env()`. 10+ regressions.
  Verify each referenced class actually exists in `globals.css`.
- Bottom sheets own their inset; never add `pb-safe*` inside one.
- No nested `<button>`; no interactive content inside a real `<button>`.
- Theme tokens, not hex literals (455 currently bypass them — measure the current number and
  report the trend, don't try to fix it here). No `var(--x)` strings passed to canvas paint APIs.
  No white/black-alpha literals as chart defaults.
- Colour is never the only state signal; `scoreBand()` colour always ships with its label.
- Duplicated primitives: five inline `<polyline>` sparkline implementations bypass
  `components/ui/sparkline.tsx` (`activity/exercise-review-sheet`, `body-battery-card`,
  `exercise-history-sheet`, `health-metric-sheet`, `workout/active-workout-screen`). Re-count and
  check whether more have appeared. A bare `grep -rn '<polyline'` over-counts by three.

---

**Lens 7 — Data integrity in production.**
Use `POST /api/admin/db-query` over the `claude_ro` schema for whole-history questions the sandbox
cannot answer: counter drift, null-rates, orphan rows, duplicate-row classes, table/index bloat,
rows whose derived values disagree with a recomputation from source. Prior art:
`docs/reviews/2026-07-27-prod-data-audit.md` and `-audit-2-derived-metrics.md`.

A bug that reproduces in production but not locally is **prod data drift vs the fresh local seed**
until proven otherwise. The local DB is always seeded correct; that is what makes it misleading.

---

**Lens 8 — Verification honesty.**
Sweep the ⚠️ "NOT verified on device" Known-Issues rows. Several features have shipped
device-unverified and the rows have accumulated. Produce a single consolidated list of what is
outstanding on device, grouped so the owner can clear several in one smoke run against
`docs/device-smoke-checklist.md`. This is a deliverable in its own right — it is currently spread
across dozens of rows nobody can act on as a batch.

---

### Rules of evidence

1. **Every finding carries `file:line`.** A claim without a location is not a finding.
2. **Verify against current `main`.** This prompt's line counts, file lists, and rule quotations
   were true at `891ffc8` and will rot. Re-derive anything you rely on.
3. **Do not re-raise** what `projectOverview.md` Known Issues or `docs/implementation-backlog.md`
   already record. If you find a recorded issue is *worse* or *differently caused* than recorded,
   that is a finding — say what changed.
4. **State the user-visible consequence.** "Missing invalidation" is not a finding; "logging a meal
   leaves the achievements card stale for 5 minutes" is.
5. **Severity by blast radius**, in this order: silent data loss > wrong number shown as fact >
   stale/incorrect UI > performance > code hygiene.
6. **Say what you did not check.** Name the failure surfaces you could not exercise — native
   SQLite/Capacitor, safe-area insets, Samsung WebView rendering, real Oura/Health Connect tokens,
   drifted prod data. Per *Communication*, a "works locally" claim without this list is incomplete.
7. **No orphaned findings.** Every finding gets a backlog entry or a Known-Issues row **in this
   same PR**. A documented finding with no queue entry is a dropped finding.

### Traps that have each cost a previous session

- `pnpm test` behaviour depends on which `DATABASE_URL` form is in your shell. The session-start
  hook exports the **Unix-socket** form; role-sensitive suites (`claude-ro-readonly-role.test.ts`)
  need the **TCP** form or they fail ~20 tests at once and read like a broken security guarantee.
- The Oura rollup tests run in a separate `rollup` vitest project at a 60 s timeout. A rollup test
  that times out **now** is worth believing, not re-running. Keep the glob in step with
  `grep -rl aggregateOuraRawSamples lib/data/postgres/__tests__/`.
- `faketime` shifts node's clock but not Postgres — DB-backed tests that mix node time with `now()`
  fail spuriously past ~1h skew. That is the method misfiring.
- CI check state comes from the GitHub MCP tools. A bash `curl` to `api.github.com` with
  `$GITHUB_TOKEN` is **not authenticated** here and its silence means nothing.
- `get_check_runs` returning `total_count: 0` several minutes after opening a PR means a **stale
  base**, not slow CI. `git fetch origin main && git merge origin/main`, push.
- A check run that fails in 2–3 seconds with no logs is an Actions startup blip. Re-trigger with an
  empty commit.

### Suggested shape

Roughly one agent per lens, run in parallel, each returning findings with file:line evidence. Then
a synthesis pass that deduplicates against `projectOverview.md` + the backlog, ranks by blast
radius, and writes the doc. Budget the Step 0 production reads **before** the fan-out — they
change what the lenses should prioritise. If a lens returns nothing, say so; a clean lens is a
result.

### Deliverables (one docs-only PR)

1. `docs/reviews/2026-08-07-full-app-review.md` — the coverage table with a verdict per route
   group, then findings grouped by lens, ranked by severity, each with file:line, consequence, and
   a proposed fix.
2. `projectOverview.md` — a Known-Issues row for every finding that is live and user-visible, each
   heading carrying its `[domain]` tag(s), primary first.
3. `docs/implementation-backlog.md` — an entry per actionable finding, inserted at the priority you
   judge right, tagged by pillar. Claim Q numbers from the "Next free Q number" line and update it.
4. `docs/domains/<pillar>/README.md` — link the review from every pillar it covers.
5. `docs/overview/entries/2026-08-07-<branch-slug>.md` — the session journal entry, a **new file**.
6. The consolidated device-verification list from Lens 8.

Branch from a freshly-fetched `main`, open the PR, let CI run, merge when green (docs-only merges
with zero ceremony).
