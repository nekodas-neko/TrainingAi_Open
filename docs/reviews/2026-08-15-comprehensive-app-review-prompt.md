# Prompt — comprehensive app review: bugs · UI · performance · architecture · scoring accuracy vs the incumbents

**Written:** 2026-08-15 · **For:** this session, re-runnable by a fresh one · **Type:** review, docs-only output

Everything below the horizontal rule is the prompt. Written against `main` at `61507d3`
(**v1.317.0**): **208 API routes, 47 page routes, 471 components, ~205,000 lines of TS/TSX,
476 test files, 188 Postgres migrations, local SQLite v26, 244 `###` sections in
`projectOverview.md` (64 carrying an open marker), 910 lines of `CLAUDE.md`.**
Re-derive every one of those numbers; they rot within days.

The owner's framing, verbatim:

> *"do a thorough overview looking for bugs; ui issues or improvement, performance/efficiency
> improvements, overall architecture review and reccomendations for changes upgrades etc. as this
> is a gym/lifestyle app compare to how other apps like garmin/samsunghealth/strava work. use the
> railway endpoints and admin endpoints to pull and review actual user data and review how the
> scoring pillars are working and how accurate they are or changes that can be made. write each
> task as a backlog task and merge to main. I want this to be very thorough and in depth. use
> outside research on what to look for if needed - but this should have very granular reviews on
> each aspect of the app. use/research and mobile app testing documentation if it will help."*

## How this differs from the reviews that came before it

This project has had eleven review sweeps since 2026-07-04. Read the two most recent before
starting or you will spend the session re-finding their work:

- [`2026-08-07-full-app-review.md`](2026-08-07-full-app-review.md) — read-only sweep across
  security, correctness, performance. Its §7 "Checked and clean" is a skip-list; its §8 "Surfaces
  NOT exercised" is a worklist.
- [`2026-08-14-app-ui-flow-ia-review.md`](2026-08-14-app-ui-flow-ia-review.md) — information
  architecture and caching, 13 findings, Q-232…Q-244. **The IA lens is done and its cluster is
  mid-flight** (Q-255, Q-256, Q-257, Q-232-followup, Q-239 all open). Do not re-open it.

Two lenses in this review are genuinely new and are where the session's value is concentrated:

1. **Scoring-pillar accuracy measured against production data.** Prior sweeps measured *one*
   pillar each, in isolation and months apart: Sleep Score (2026-08-04, Q-72 — cannot discriminate),
   Activity Score (2026-08-07, Q-137 — 57 of 100 weight is constant), Body Battery (2026-08-04 —
   no validated target). Nobody has measured **all five together, on the same days, against the
   same production rows**, nor asked whether they *agree with each other* or double-count the same
   input. That is this session's primary lens.
2. **Comparison against the incumbents.** No prior review has looked outward at all. Garmin,
   Samsung Health, Strava, Whoop and Oura have each spent a decade deciding what a readiness score
   should be made of, what a training-load model owes the athlete, and which of these numbers a
   user is even allowed to see. Their published models are the closest thing this project has to a
   reference implementation, and the app is currently guessing where it could be borrowing.

The standing lenses (correctness, performance, UI mechanics, architecture) run after those two and
are **scoped to what is new or unmeasured**, not swept from scratch.

---

## Prompt

You are running a full-breadth review of TrainingAI. The output is a review document, one backlog
entry per actionable finding, `projectOverview.md` Known-Issues rows for anything found-but-not-fixed,
and a journal entry — all in **one docs-only PR** merged to `main`. Per *Backlog-driven
implementation* in `CLAUDE.md`: **plan now, build later.** You are not implementing the findings.

### Read before touching code

1. `projectOverview.md` — build the open-row list first (`grep -n '^### ' projectOverview.md | grep -E '🔴|🟠|🟡|⚠️|⛔'`).
   An already-recorded row is not a finding. **64 open rows** at the time of writing.
2. `docs/implementation-backlog.md` — an already-queued item is not a finding either. Note the
   "Next free Q number" line and claim against **both** this file and `list_pull_requests`; the
   pointer cannot see an unmerged PR, and that trap has fired four times in the last week.
3. `CLAUDE.md` — the rule sections *are* the checklist for Lens C.
4. `docs/module-map.md` — before flagging "this should be shared", check whether it already is.
5. `docs/domains/README.md` plus each pillar index you touch.

### Ground rule for every lens

**Measure before you claim.** This project's review culture has one repeated failure: a finding
written from reading code that production data would have refuted, or a fault called "fixed"
because a stop was mistaken for a repair. Every quantitative claim in your review document carries
the query or command that produced it. Where you could not measure, say so in the finding.

---

## Lens A (primary) — the five scoring pillars, measured against production

The app computes five user-facing scores. Their code lives here:

| Pillar | Formula | Route |
|---|---|---|
| Readiness | `packages/shared/src/health/readiness-composite.ts`, `live-readiness.ts` | `app/api/readiness-score` |
| Sleep Score | `packages/shared/src/health/sleep-score.ts` | (rollup + `sleep_sessions.sleep_score`) |
| Activity Score | `packages/shared/src/health/activity-score.ts` | `app/api/activity-*` |
| Body Battery | `packages/shared/src/health/body-battery-inputs.ts`, `body-battery-band.ts` | `app/api/body-battery` |
| Training Load / ACWR | `computeVolumeAcwr` | `app/api/training-load` |

Plus the audit layer under `packages/shared/src/health/score-audit/`, which already exists to
explain a day's score and is the natural place to hang any new diagnostic.

**A1 — Input completeness.** For each pillar, list every input the formula reads, then measure what
fraction of production days actually *have* that input. Use the admin endpoint:

```bash
curl -sX POST https://trainingai-production.up.railway.app/api/admin/db-query \
  -H "Authorization: Bearer $CLAUDE_DB_QUERY_SECRET" -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT ..."}'
```

An input that is null on most days is not an input — it is a constant with extra steps, and the
weight assigned to it is silently redistributed or silently zeroed. Q-137 found exactly this for
the Activity Score. Check whether the other four have the same shape.

**A2 — Discrimination.** For each pillar, pull the full production distribution: min, max, p10,
median, p90, stddev, and the count of distinct values. A score that occupies 12 points of its
100-point range cannot inform a decision. Q-72 established this for Sleep Score; establish it or
refute it for the rest. Where a subjective rating exists to correlate against (`mood_logs`, the
morning sleep-feel rating, `day_checkins`), correlate against it and report the coefficient.

**A3 — Agreement and double-counting.** The pillars share inputs. HRV feeds readiness *and* body
battery; sleep duration feeds sleep score *and* readiness; activity feeds activity score *and*
training load *and* body battery drain. Build the day-by-day matrix of all five scores and compute
the pairwise correlations. Two findings fall out of this on their own:
- **Redundancy** — two pillars correlating above ~0.9 are one pillar shown twice, and the second
  one is costing screen space that a genuinely independent signal could use.
- **Contradiction** — a day where readiness says "go hard" and body battery says "you are empty"
  is a bug in one of them, or a missing reconciliation. Find the days where they disagree most and
  read the underlying rows.

**A4 — The constants nobody validated.** Every threshold, band boundary and weight in those five
files was chosen once and never revisited against data. Enumerate them. For each, ask what evidence
would change it and whether that evidence exists in the database. Report the ones where it does —
those are cheap, high-value calibration wins.

**A5 — Producer health.** Q-270 found `training_load_ots` at 0 rows of 89 days *despite having a
live producer*. Sweep every derived/score column for the same shape: a column with a producer in
code and no rows in production. `pg_stat_user_tables.n_live_tup` gives real row totals;
per-column null rates come from the `claude_ro` views.

> **The `claude_ro` limit you must state in every finding:** those views are **row-scoped to one
> user** and `error_events` **prunes at 30 days**. Every count is *the owner's data only*. Write
> "nothing else of the owner's", never "nothing else is failing".

---

## Lens B (primary) — how the incumbents do it

Research, then compare. Sources to actually read rather than recall: Garmin's Body Battery and
Training Readiness documentation and the Firstbeat Analytics white papers behind them; Samsung
Health's Energy Score; Strava's Fitness/Freshness (CTL/ATL/TSB) and its Relative Effort model;
Whoop's recovery model; Oura's own Readiness contributors. Also worth reading: the sports-science
literature on ACWR, which has moved considerably against the naive 7:28 ratio this app implements.

**B1 — Model comparison.** For each of the five pillars, a table: what this app uses as inputs and
weights, versus what each incumbent uses. Call out inputs the incumbents treat as load-bearing that
this app does not collect at all, and inputs this app weights heavily that the incumbents have
deliberately dropped.

**B2 — Feature gap.** This is a gym *and lifestyle* app. Walk the surface area of each incumbent
and list what a user coming from them would look for and not find. Be honest about which gaps are
deliberate (single-user, no social layer) and which are simply absent. Rank by value to *this*
owner, not by how common the feature is.

**B3 — Presentation conventions.** How do the incumbents present a score — the number alone, the
number with its contributors, the trend, the "what do I do about it"? Where this app shows a bare
number that the incumbents always show with context, that is a UI finding, not a modelling one.

**B4 — What not to copy.** Name the incumbent features that would be wrong here, and why. A review
that only recommends adding things is not a review.

---

## Lens C — correctness, scoped to what is new

The standing bug classes are enumerated in `CLAUDE.md` and each has a CI check or a prior sweep
behind it. Do not re-sweep them from scratch. Instead:

**C1 — The production faults that are still unexplained.** `error_events` currently holds a
5,771-hit `[pg 21000]` (cardinality violation) on `POST /api/hr-ingest`. A cardinality violation on
an `ON CONFLICT DO UPDATE` means one statement is trying to touch the same row twice — a duplicate
key *within a single batch*. Find it, and check every other batch upsert for the same shape.
Anything in `error_events` without a Known-Issues row or a backlog entry gets one this session.

**C2 — Diff-scoped sweep.** Run the standing checks over everything merged since the 2026-08-14
review (`git log --since=2026-08-13 --name-only`), against the rule sections in `CLAUDE.md`:
cache-group invalidation, sync-push mirroring, timezone construction, ownership scoping on writes,
safe-area utilities on new anchored controls, persisted-store transient state.

**C3 — The gates themselves.** Run `pnpm check:rules` and quote the `Ran N of N` count. Then ask
the harder question: which of the recurring bug classes in `CLAUDE.md` have **no** automated check
behind them and are held by prose alone? Prose did not hold the hex-literal count (it grew 41 in
five days while the rulebook claimed it was shrinking). Each unchecked class is a candidate finding.

---

## Lens D — performance and efficiency

**D1 — Server.** Per-route query counts. `/api/sync/pull`'s ~21-query fan-out is known; find its
siblings. Look for N+1 shapes, unbounded full-table reads (Q-143), and routes doing work the client
throws away.

**D2 — Client render.** The rules in `CLAUDE.md` → *Render discipline* are the checklist:
memo defeated by inline props, broad Zustand selectors in orchestrators, timers above the leaf,
`readCacheSync` in a component body. Grep for each shape; report counts, not vibes.

**D3 — Payload.** Which routes return fields no caller reads? Measure a real response against the
consuming component's destructuring. This is the cheapest win available on a mobile link.

**D4 — Database.** Index bloat was 42 MB of invalid indexes once already. Re-check
`pg_stat_user_indexes` for unused indexes and `n_live_tup` for tables growing without a retention
policy — `oura_raw_samples` in particular.

---

## Lens E — UI and the testing capability behind it

**E1 — Against external standards, not just the repo's rules.** Material Design 3 touch-target and
contrast guidance, WCAG 2.2 AA, and the Android-specific conventions the repo's own rules only
partially encode. The 2026-08-08 sweep found 7×7 px tap targets; re-run that measurement and check
whether the class recurred.

**E2 — Mobile testing documentation.** Research what a mature mobile QA practice covers — the
Android testing pyramid, instrumentation vs. unit split, screenshot/visual regression, accessibility
scanning, monkey/fuzz testing, network-condition simulation, cold-start and jank measurement. Then
map it against what this project has: 476 test files, **zero** of which run the app (Q-249),
no emulator in CI (Q-250), no staging (Q-251), no error tracking with replay (Q-252). Those five
Q numbers already exist — your job is not to re-raise them but to say what *else* the standard
practice covers that they miss, and to sharpen their ordering with evidence.

**E3 — The screens the owner actually uses.** Q-51 says the perf work was aimed at the wrong screen.
Use production data — which routes are hit most — to rank the screens by real use, and check that
the UI investment matches.

---

## Lens F — architecture and recommendations

**F1 — Offline-first coherence.** The rule is: a domain that writes locally must read locally.
Re-audit the read sites; the last full audit was 2026-07-02 and the app has grown a great deal since.

**F2 — The sync engine under growth.** It was designed for one user and one device. The owner has
stated the intent is production and a Play Store listing. What breaks first at 10 users? At 100?
Name the specific thing, not "it might not scale".

**F3 — Boundaries.** `packages/shared` vs `lib` vs `components` — is the split still coherent, or
has it drifted into "wherever it was written"? Component-size hotspots are already tracked (Q-138);
look instead at *module* coupling.

**F4 — The AI layer.** Cost, latency, failure modes, and whether the model choice is still right.
Every LLM call returning structured data must use `generateObject`; verify, don't assume.

**F5 — Upgrade recommendations.** Framework versions, dependency health, and the two structural
projects already named (Q-49 public repo, the bundled-shell + native-push endgame). Give each a
clear-eyed cost and a recommendation, including "not yet".

---

## Output

1. **`docs/reviews/2026-08-15-comprehensive-app-review.md`** — the findings, organised by lens, each
   with its evidence and its Q number.
2. **One backlog entry per actionable finding** in `docs/implementation-backlog.md`, placed at the
   priority you judge right, each tagged with its pillar slug(s) and carrying enough detail that an
   implementer session can start without re-deriving anything.
3. **`projectOverview.md` Known-Issues rows** for anything found-but-not-fixed (per *No orphaned
   findings*).
4. **A journal entry** at `docs/overview/entries/2026-08-15-<branch-slug>.md`.
5. **One PR, CI green, merged.** Docs-only, so it merges with zero ceremony.

State plainly, in the review document, which surfaces you did **not** exercise — device, emulator,
browser, real wearable, other users' data. Per *Communication* in `CLAUDE.md`, that section is not
optional.
