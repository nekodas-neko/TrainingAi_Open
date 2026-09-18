# Review sweep 50 — twelve days, 50 commits, 671 files

**Date:** 2026-09-18 · **Base:** `3e47f03f18356574a254748f55905ad203b311a8` (sweep 49, 2026-09-06)
· **Scope:** everything merged since sweep 49, across safety / logic / performance / efficiency.
**Method:** three read-only lanes (new API-route safety, new shared-module math, cache and
staleness) reporting into this session, with **every finding re-verified at source by the
coordinator before it was filed** — no finding below is taken on a lane's word.

## The one-line state of it

The window's new code is, on the whole, careful: the twelve new `packages/shared/` modules were
hoisted *with* their reasoning in the header, eight of them survive adversarial probing of the
shipped module unchanged, and the new admin routes re-read `is_admin` from the row rather than
trusting the JWT claim (proved by revocation — flipping the column to false answered 403 on the
same cookie). **The defects that did land are all one shape: a rule was written down correctly and
then only half-applied.** A constant that is called a contract and is read by one of its two files.
An exclude-on-empty rule whose "this cannot occur" premise is false in production today. A
case-insensitive comparison that lowercases one side. A cache key whose direct sibling is in three
invalidation groups and which is in none. That is a better class of bug than sweep 49's, and it is
also the class that a reader of the code cannot catch, because the comment says the right thing.

## Established findings

### 1. Two real exercises are excluded from every generated program, today (RV-51)

`equipmentEligible` (BF-129) changed the rule to **exclude** an exercise declaring no equipment,
and its header justifies that with *"Migration 269 labelled the 22 rows that had drifted and `POST
/api/exercises` now refuses to create another, so an empty list should not occur"*. It does occur.
Production `claude_ro.exercise_library` holds **2 of 156** rows with `equipment = []`:
`Dumbbell Lunges` (`4d747449-…`) and `Cable Lat Pulldown` (`aed11054-…`). Because the
implementation is `exerciseEquipment.some(...)`, an empty array is false against *every* selection
including `full_gym` — so both exercises are invisible to `generate-program`, `builder-chat` and
the builder review filter for every user, at every equipment setting. For these two rows excluding
is not the safe direction: a full-gym lifter can perform both. **This is the sweep's only live,
user-affecting defect.**

### 2. Three cache keys are never evicted, two of them beside siblings that are (RV-52…RV-54)

Counted mechanically with `grep -c` against `lib/cache-groups.ts`:

| Key | In N groups | Its sibling | Sibling in N |
|---|---|---|---|
| `weekly-review-month-window:<weekStart>` | **0** | `day-review-week-window:` | 3 |
| `stress-day:<date>` | **0** | `body-battery` (same card) | 4 |
| `collection` | 0 in `invalidatePrescriptionChanged()` | — | present at 4 other sites |

The third is the sharpest: `/api/collection:59` computes `pausedDays` from
`[...restDays, ...earlyDeloadWeekDays(program)]` — i.e. from exactly the deload confirmation that
`invalidatePrescriptionChanged()` exists to fan out — and that group (which RV-49 correctly
extended this window) does not name `collection`. Per the Q-262 rule these are only *settled*
staleness where a read path is seed-only or passes `freshWithinTtl`, which was not established for
all three; they are filed as eviction gaps regardless, because a key that is inert today becomes
load-bearing the moment someone adds `freshWithinTtl` to it.

### 3. Two route inputs turn a client error into a server fault (RV-55, RV-56)

`POST /api/supplements/[id]/vials` takes an optional client-supplied `id` and inserts it unguarded
(`adapter.ts:6761` — the *parent* is ownership-checked at 6756, the id is not). Re-posting another
user's vial UUID raises an unhandled `23505`, answering **500 with an empty body** and writing a
server-fault row to `error_events`; the control (same request, fresh UUID) returns 201, so the 500
tracks the `id` field alone. No cross-user write occurs — the victim row was read back unchanged —
but the endpoint is a "does this UUID exist" oracle and it pollutes the fault table.

Separately, three files in this window validate a date with the shape-only
`/^\d{4}[-/]\d{2}[-/]\d{2}$/` and never reach `normalizeDateParam`/`isCalendarDate`
(`sleep/manual-bedtime/route.ts:15`, `supplements/[id]/vials/route.ts:18`,
`…/vials/[vialId]/route.ts:16` — all three confirmed to contain zero calendar-check calls). A
date-shaped non-day (`2026-02-31`, `2026-13-45`) reaches the driver as `[pg 22008]`: a 500 and a
fault row for a client typo. This is the Q-496 class `isCalendarDate` was added to stop.

### 4. Three shared modules do not hold the agreement their header claims (RV-57…RV-59)

- **`STREAK_LOOKBACK_DAYS`** calls itself *"a CONTRACT between two files that used to disagree
  silently"*. The supplier (`app/api/streak-data/route.ts:4`) imports it; the consumer
  (`app/session-select/session-select-content.tsx:1020`) still reads `for (let ago = 1; ago < 365;
  ago++)` with no import, and the same file's line 532 comment still says "90 days". No live bug —
  365 and `< 365` happen to agree — but changing the constant reintroduces BF-176 verbatim.
- **`buildEquipmentSet`** does not lowercase the selection, while `equipmentEligible` lowercases
  the exercise, so the pair is half case-insensitive: `equipmentEligible(['barbell'],
  buildEquipmentSet(['Barbell']))` is **false**, and `buildEquipmentSet(['FULL_GYM'])` does not
  expand the shorthand. Not reachable today (0 of 156 catalogue rows are non-lowercase and the one
  producer uses lowercase ids) but both API schemas accept bare `z.array(z.string())`.
- **`summariseSupplementDay`** sums `amount` across contributions without reconciling units and
  labels the sum with whichever row came first: `1 mg + 2 g` reports `3 mg` or `3 g` on row order
  alone (`supplement-day-totals.ts:66-67`). The module header names *"a mixed-unit day"* as a
  reason the function was hoisted. Latent — no owner day has more than one contribution at all.

### 5. A module ships with two user-facing strings, one unreachable and no consumer (RV-60)

`recommendWalkPattern` distinguishes *"Zone 2 is done for the week"* from *"No Zone 2 target set
this week"*, but the only producer of a `ZoneQuota` represents "no target" as a row with
`status: 'not-required'` rather than a missing row, so the `zone2 == null` branch cannot fire and a
user with no target is told the target is done. Impact is currently zero: `grep -rn
recommendWalkPattern` finds **no production call site** — tests only.

### 6. `PATCH /api/user/equipped-title` never checks the title is unlocked (RV-61)

The only gate is catalogue membership; the unlock filter is client-side
(`title-picker-sheet.tsx:17`). Any signed-in user can equip `iron_will` (`unlockedBy: 'streak_60'`)
at a best streak of 9, and it persists and renders on the public profile and friend leaderboard.
**Pre-existing, not introduced here** — this diff *hardened* the same line, replacing a truthy
lookup that let `constructor`/`__proto__` through. Cosmetic, and on a single-owner deployment there
may be no adversary.

### 7. A banned window pattern landed on the mood write path (RV-62)

`deriveSuggestedSoreMuscles` (`adapter.ts:3133`, added in this range — `git log -S"7 * 86_400_000"`
→ `fdcee2d4`) builds its recovery window as `new Date(Date.now() - 7 * 86_400_000)`. CLAUDE.md's
Date Arithmetic section bans exactly this: *"Range/window starts anchor at the user's local
midnight, never `now − N×86400000` — ms-offset windows straddle two AEST days and merge them
(session 62)."* The same function also calls `listExerciseLibrary()` unfiltered on **every check-in
save** — statement 3 of the 5 that `POST /api/mood` issues is a full-table select of the catalogue.
Whether the day-boundary skew actually flips a provenance verdict was not tested; the pattern is
banned on its own terms.

### 8. `/api/collection` is the only new route that is both unbounded and unlimited (RV-63)

It pins `HISTORY_START = '2000-01-01'` and issues five parallel all-history repo reads with **no
rate limit** (`grep -c 'rateLimit('` → 0; stress-day, month-window and rollup-state each have one).
Two of the ten statements are full-width reads projected immediately to one field each — 36 columns
of `body_metrics` and 25 of `sleep_sessions` to produce two lists of dates. The card driving it uses
`COLLECTION_TTL = TTL_SHORT`, and `cachedFetch` revalidates on every paint regardless of TTL, so the
all-history replay runs on each home render. Nothing is slow today at the owner's ~130 step-days;
this is an unbounded-growth and missing-guard finding, not a latency one.

## Two stale claims in `CLAUDE.md`'s own session-start block

- It says `error_events`'s 52 MB "is 30 days of retained payload rather than unbounded growth".
  Measured today: **12 MB heap + 39 MB TOAST + 752 kB index behind 115 live rows** — that is
  reclaimable bloat, not payload. The figure was written when the table held 7,331 rows.
- It says growth should be "~0.4 MB/day". Actual is **1.71 MB/day** (224 MB total). The growth is
  nonetheless *bounded and explained*: `oura_raw_samples` holds 8 days under a 31-day cap because
  the packer reclaims into `oura_raw_packed`, `oura_heartrate` spans 88 days against a ~90-day
  window (steady state), `rr_intervals` spans 60. The number is wrong; the conclusion it supports
  is not.

## BF-110's diagnostic has answered its own question and the entry is still parked

The entry's own decisive criterion — *"If it still reads 667, the viewport is genuinely stuck and
the fix is in the native layer"* — has its reading. `error_events` holds **3 rows** of
`recheck stuck h1=667 h2=667 w2=384 children2=1` (2026-09-15→09-16), **12 rows** at 826→826
(healthy), and **0 `resized`, 0 `dom-lost`**; 22 first-readings at `h=667 children≤2` put the blank
resume itself at roughly twice a day. That is a native-layer verdict, four days old. Two secondary
notes for whoever picks it up: the verdict word `stuck` fires on healthy resumes too (12 of 15),
and `w=384` appears on every row including healthy ones — so the entry's "384×667" signature is
half right, and only the height discriminates.

## Clean — what was probed and held

Admin authorisation on both new admin routes (proved by revocation, not by reading). Ownership
rules (a)/(b)/(c) on the vials routes — cross-user PATCH/DELETE both 404 with the victim row read
back unchanged, `.set()` whitelisted field-by-field, no `.set({...body})` anywhere in the changed
set. `Cache-Control: private, no-store` on every new route, no `max-age` in the diff. Both date
separators byte-identical on `muscle-sets`, `stress-day` and `month-window`, all three answering
400 rather than 500 on an invalid calendar day. 401 with no cookie on all five new reads. Zero
responses ≥500 from fuzzing every changed non-dynamic GET. On the math side, eight of the twelve
new modules survived probing of the shipped module: `units.ts` (one declaration of the conversion
constant repo-wide, exact round-trip), `goal-bounds.ts` (all eight bounds reproduce the routes'
own numbers, verified against `git show 3e47f03f:`), `vial-dose.ts` (bit-exact round-trips,
division-by-zero closed), `collection/ladder.ts` (value conserved across decay — 20 days then idle
yields 20 decay events and no negative stock), `untrusted-text.ts` (the fence cannot be forged),
`progression-style.ts`, `weekly-digest-metrics.ts`, `supplement-dose-freeze.ts`.
`pnpm check:rules` reports **Ran 75 of 75** (up from 68 at sweep 49).

On the performance side: **zero N+1 queries** in the added `lib/data/postgres/**` and
`app/api/**` lines (confirmed on the wire — `month-window` costs 6 statements while assembling five
weeks of sessions, because `buildWorkoutSessions` batches children with `inArray`); **every** new
query pattern from migrations 267–277 has a supporting index, including migration 271's partial
uniques over live rows; `check-memo-prop-stability.js`, `check-component-size.js`,
`check-fetch-once-effects.js` and `check-cache-ttl-divergence.js` all exit 0 with nothing new; and
the diff adds **no new dependency** — it is a version bump, three upgrades and six `pnpm.overrides`
security pins. All five new GETs return exactly the shape their caller consumes.


## Not established

- **Row scoping.** Every `claude_ro` read above is **the owner's rows only** except
  `exercise_library`, which appears to be a shared catalogue but whose view scoping was not
  verified — "2 unlabelled rows" is a floor.
- **Nothing device-verified.** All probes ran in node or against a local dev server.
  `getLocalStore()` is null off the APK, so the offline-first half of the vials domain (does a vial
  write reach the local store? does its UI read local-first?) was not exercised at all, nor was the
  local-store half of `summariseSupplementDay` — the BF-112 path the module was hoisted to unify.
- **`rederive-baselines`' write path was never run** — `oura_daily_summary` is empty locally, so
  every call returned 404. Only its auth gate, rate limit and fail-closed parse were checked.
- **Cross-user leakage was tested only on the vials routes.** The other new routes were probed
  single-user; their scoping was read, not exercised.
- **Rate limiting across the new reads is inconsistent and has no sibling norm to appeal to** —
  `collection` and `muscle-sets` have none, three others do, and their nearest siblings split the
  same way. `/api/collection` is the one to watch: five unbounded full-history queries per call, no
  cache, no limit. It ran in 0.32 s locally, which proves nothing about the owner's history.
- **The ~33 *changed* (non-new) formula files were not audited**, only greppped for duplicates.
- **Four rest-gap rules were not reconciled** (`MAX_REST_GAP` in session-select, `ai-dynamic.ts`,
  the deliberately-unbounded leaderboard, and the ladder's `maxRestGap`) — whether they agree is a
  real question this sweep did not answer.
- **`/api/muscle-sets` has zero callers** — its own header declares this (*"the engine half of
  OR-118's movement-balance card"*), so it is not filed as a defect, but its cost has never been
  exercised by a real client.
- **No `EXPLAIN ANALYZE` evidence and no bundle sizes.** At 9–145 local rows the planner seq-scans
  everything regardless of index, so index coverage above is a structural check against the query
  predicates, not a measured plan; `pg_stat_statements` could not be loaded without a restart, and
  `pnpm build` was not run, so no route chunk sizes exist for this range.
