# Prompt — App Checkpoint (specialist edition)

**Before you paste: create the session on Opus 5 with effort `xhigh`.** The model is fixed at
creation and nothing in this prompt can change it. A weaker model does not fail loudly on a
checkpoint — it reads source, reports what *should* happen, and produces a document that will be
believed. That is worse than no checkpoint.

**What this is.** A review sweep picks one lens and goes deep. A checkpoint walks the whole app,
from the cold-start byte to every leaf function, through **twenty-six specialist lanes** — each one a
narrow expert with its own surfaces, its own checklist, and its own trap — and collates the lot into
one report. It is a one-off session, not a standing agent: no baton, no successor. Run it roughly
quarterly, or after a stretch of change heavy enough that nobody is sure what the app now contains.

**Why specialists rather than generalists.** The first edition of this prompt ran ten broad lanes.
Breadth is where a lane goes shallow: a "data layer" lane looks at migrations and write paths and
never reaches the outbox's conflict semantics, because nobody told it the outbox was its job. Every
lane below is scoped so narrowly that walking past something is visible as a gap in its own
checklist. Surface area comes from the count, not from asking each lane to try harder.

**One session, not twenty-six.** Lanes fan out to read-only subagents; a single coordinator verifies
every candidate finding and writes one report. Parallel sessions would collide on the backlog file,
and the value of a checkpoint is almost entirely in the *seams* between lanes, which no lane can see.
Expect several context compactions. **The lane files on disk survive compaction; the conversation
does not** — write each lane's return to disk the moment it lands.

Paste everything below the line into a fresh session.

---

**Set this session's title to `🧭 App Checkpoint 🟢` — exactly, emoji included.**

**First, check what you are running on.** Call `get_session` with `session_id` **omitted** and read
`session_context.model` and `session_context.effort_level`. This wants **Opus 5** at **`xhigh`**. If
either differs, say so in your first message and ask whether to carry on or be restarted. Never
quietly proceed on the wrong model.

You are running a **whole-app checkpoint** on the TrainingAI repo. You are not one of the six
standing agents; you file under `PS-` and you have no baton. Your job is to find out what this app
actually contains right now — every route, formula, model call, cache key, write path, native
bridge, rule and document — verify it against a running instance, and turn what you find into one
collated report and a bounded set of backlog entries. **You do not fix anything.**

## Read first, in this order

1. `CLAUDE.md` — the recurring bug classes. Most findings will be an instance of one; name the class.
2. `projectOverview.md` — the live Known Issues, so you do not re-report what is already known.
3. `docs/agents/README.md` §1–3 — the roles, the lane split, entry-ID rules.
4. `docs/module-map.md` — what already exists and where. Every "missing" you report is checked here first.
5. `docs/domains/README.md` — the eleven pillars and the boundary rules.
6. The last four write-ups in `docs/reviews/` and the last ten in `docs/overview/entries/` — the
   ground already covered, and the claims already made that you will be testing.

## The method contract — binding on you and on every subagent

**Run the app; do not just read it.** `pnpm dev` against the seeded local Postgres is up from the
session-start hook. `e2e/` holds the Playwright harness. Production is reachable read-only through
`POST /api/admin/db-query` over the `claude_ro` views with `$CLAUDE_DB_QUERY_SECRET`. A lane that
returns only file:line citations and no executed command has read the app, not checked it.

**Every sentence the repo says about itself is a test case.** Code comments stating an invariant,
doc headers claiming a module is the single home, a prior review calling something correct, a
`CLAUDE.md` rule saying a check enforces X, a shipped backlog entry — each is a hypothesis. Recent
sweeps got three findings this way, including a scoring bug a prior review had specifically praised.

**Import the shipped module; never re-implement the formula you are auditing.** A throwaway vitest
file inside the package is the cheapest way to reach TypeScript with no build output. `npx tsx` is
not installed; vitest swallows `console.log`, so write results to a file and `cat` it. Delete the
file before committing.

**Choose fixtures hostile to the arithmetic.** A 1RM audit that started at exactly 100 kg — where
every common percentage lands on a plate boundary — reported zero drift on a mechanism that moves
13.6%. Sweep the input range; pick values that make rounding, boundaries and zero cases fire.

**Pair every refusal with a one-field control.** A route that rejects your payload may be enforcing
a rule or rejecting your shape. Send the same request with one field changed and confirm the
refusal tracks the field. A refusal with no control is written as *unverified*, never *clean*.

**`claude_ro` is row-scoped to the owner.** Write "no evidence in the owner's rows", never "it has
not happened". `pg_stat_user_tables` sizes are exact; its `n_live_tup` is a stale estimate — use
`count(*)`. The `error_events` table prunes at 30 days.

**The device is the ceiling.** In this sandbox `getLocalStore()` is null, safe-area insets are 0px,
no native plugin runs, and Samsung WebView is unobservable. Anything in those cells is filed as
*not exercised here*, with the on-device step from `docs/device-smoke-checklist.md` named.

**Clean is a result.** A lane that finds nothing states what it checked and how, so the next
checkpoint can skip it. An empty lane with no method is a lane that did not run.

## How to run the lanes

Give each subagent **only its own lane block below, plus the output schema** — not this whole prompt.
Run lanes in parallel where they share no surface; the family groupings below are safe parallel
sets. Each subagent returns findings in exactly this shape:

```
FINDING: <one sentence, the defect not the topic>
PILLAR:  <primary pillar slug>
EVIDENCE: <file:line, or the command run and its actual output>
CLAIM TESTED: <the comment/doc/rule that said otherwise, if any>
NOT ESTABLISHED: <what this evidence does not prove>
SEVERITY: <data-correctness | user-visible | consistency | hygiene>
```

Write each raw return to `<scratchpad>/checkpoint/lane-NN.md` **before reading it**. Subagent
output is a hypothesis, not a finding: re-run the cited command or reopen the cited line yourself
before anything reaches the report. A lane that returns twelve confident findings has usually
earned four.

---

## The lanes

Each lane has a **mandate** (what it owns), **surfaces** (where to look — real paths, not
categories), a **checklist** (questions that must each get an answer), **run** (commands that must
actually execute), and a **trap** (what a lazy pass of this lane reports, so you can recognise one).

### Family A — the shell: from the first byte to the first screen

#### Lane 01 — Boot specialist
**Mandate:** everything between a cold launch and an interactive home screen, in execution order.
**Surfaces:** `app/layout.tsx`, `app/(home)/`, `app/api/app-load/`, `components/shell/`, the
providers, `lib/sqlite/cache.ts` seeding, `lib/stores/*` rehydration, `lib/sw/`, `public/sw-template.js`.
**Checklist:** what runs before first paint, and is any of it avoidable · which fetches fire on boot
and are they deduplicated · which caches are seeded synchronously and which flash a skeleton · does
Zustand rehydration race a render · does a stale `todayLogged` survive a date rollover · what
happens on boot with no network, no session, and an expired session.
**Run:** `pnpm dev`, then time the cold and warm loads in Playwright with the network throttled;
list every request on a cold boot with its size.
**Trap:** describing the provider tree from `layout.tsx` without ever measuring a boot.

#### Lane 02 — Information architecture specialist
**Mandate:** the complete inventory of pages, sheets and dialogs, and a disposition for each.
**Surfaces:** every `app/**/page.tsx` (currently 46), every sheet/dialog under `components/**`,
`components/shell/` navigation, `app/more/`, `app/admin/`, `app/more/settings/developer/`.
**Checklist:** for each page — who reaches it and from where, what it shows that nothing else shows,
what it duplicates · which pages are two views of the same data (`health/*` vs `stats` vs
`year-review`; `workout-select` vs `session-select`; `more/data` vs `more/details`) · which are
reachable only by URL · which exist for one device pairing flow and could be a sheet · which admin
and developer surfaces are still used.
**Run:** crawl every route in Playwright as the seeded user and screenshot it; grep every `href` and
`router.push` to build the reachability graph.
**Trap:** listing pages. The deliverable is **a merge / keep / delete recommendation per page**, with
the reason, filed `Gate: owner`. Pages this lane cannot decide on are a finding about the page.

#### Lane 03 — Auth and session specialist
**Mandate:** how a user becomes a user and stays one.
**Surfaces:** `auth.ts`, `app/api/auth/`, `app/sign-in`, `app/register`, `app/mobile-signin`,
`app/auth-mobile-bridge`, `app/pending`, `lib/auth/`, `lib/security/`, `middleware` if present.
**Checklist:** JWT contents and what is trusted from it (the stale `isAdmin` claim rule) · session
expiry and refresh · the mobile bridge handoff and what a leaked bridge URL would grant · sign-out
wiping the device store · the pending/unapproved user path · rate limits on auth endpoints ·
`friends` and `profile/[userId]` cross-user reads.
**Run:** hit every auth route unauthenticated, with an expired token, and as a second seeded user
reading the first user's ids — with the one-field control on each refusal.
**Trap:** confirming the middleware exists. Reading is not a control.

#### Lane 04 — Offline shell specialist
**Mandate:** what the app does with no network, and what it promises about it.
**Surfaces:** `app/offline`, `public/sw-template.js`, `lib/sw/`, `lib/net/`, `lib/sqlite/`,
`lib/local-store/`, `packages/shared/src/http/`, `fetch-with-retry.ts`.
**Checklist:** which screens render from local data alone · which go blank and which show stale-as-
fresh · the service worker's `/api/` bypass and precache list · retry policy and backoff · what
"offline" looks like to a user on each tab · whether the offline page can ever be reached.
**Run:** Playwright with `context.setOffline(true)` across every tab; measure what paints.
**Trap:** citing the offline-first rule in `CLAUDE.md` as evidence the app is offline-first.

### Family B — the numbers

#### Lane 05 — Strength and 1RM specialist
**Mandate:** every number derived from a set log.
**Surfaces:** `packages/shared/src/1rm.ts`, `packages/shared/src/workout/`, `app/api/log-exercise/`,
`app/api/next-session/`, `app/api/exercise-estimates/`, `app/api/strength-trend/`,
`app/api/workout-load-history/`, `components/workout/utils.ts`, `personal_records`.
**Checklist:** one implementation of 1RM, and the high-rep guard on it · prescription rounding and
the ratchet already filed as RV-43 — has it moved · `upsertPersonalRecordIfBetter` monotonicity vs
deload/baseline gates · AMRAP handling · unit assumptions (kg only?) · what the strength card shows
vs what the PR table holds.
**Run:** import the module in a throwaway vitest; sweep 1RM from 40 to 220 kg in 0.1 steps across
every style in `progression_styles`; compare the distribution of stored PRs in production against
what exact adherence would produce.
**Trap:** re-deriving Epley by hand and confirming it matches itself.

#### Lane 06 — Training load specialist
**Mandate:** ACWR, tonnage, weekly cadence, deload, periodization.
**Surfaces:** `app/api/training-load/`, `app/api/training-stress/`, `app/api/muscle-tonnage-trend/`,
`app/api/weekly-muscle-sets/`, `app/api/muscle-recovery/`, `app/api/confirm-early-deload/`,
`packages/shared/src/phase-engine.ts`, `packages/shared/src/schedule-utils.ts`,
`packages/shared/src/ai-periodization/`, migration `265_training_load_gate.sql`.
**Checklist:** one `computeVolumeAcwr` and who consumes its `interpretation` vs re-banding · week
boundaries in the user's timezone · the training-load gate added in 265 — what it gates and whether
the UI reflects it · deload detection with one, two, and zero prior weeks · muscle-recovery decay
constants and their source.
**Run:** import and sweep; pull the owner's actual ACWR series from production and check it occupies
more than a quarter of its range.
**Trap:** "one implementation exists" without checking every consumer renders the same band.

#### Lane 07 — Sleep and readiness specialist
**Mandate:** every score built from sleep, HRV and resting HR.
**Surfaces:** `packages/shared/src/health/`, `lib/sleep/`, `app/api/sleep/`, `app/api/sleep-sessions/`,
`app/api/sleep-performance-correlation/`, `app/api/readiness-score/`, `app/api/body-battery/`,
`app/api/hr-profile/`, `app/health/sleep`, `app/health/readiness`, `sleep_sessions`, `oura_daily`.
**Checklist:** score bands from `scoreBand()` only · baselines: window length, minimum sample, what
a missing night does · the partial-day rule on cumulative fields · HRV method (RMSSD, not SDNN) all
the way from decoder to display · timezone on sleep-day keying (a sleep that crosses midnight
belongs to which day) · the correlation route's sample-size floor.
**Run:** distribution of readiness and sleep scores from production over 90 days; count nights with
null HRV against nights with rows.
**Trap:** confirming the formula matches a comment instead of confirming the output distribution is
plausible.

#### Lane 08 — Activity, cardio and running specialist
**Mandate:** steps, zones, walks, runs, and the fitness tests.
**Surfaces:** `packages/shared/src/running/`, `packages/shared/src/fitness-tests/`, `lib/activity/`,
`lib/walk/`, `app/api/activity-logs/`, `app/api/zone-minutes/`, `app/api/cardio-*`,
`app/api/running-*`, `app/api/guided-walk/`, `app/api/fitness-tests/`, `map-tiles.ts`,
`lib/weather/`.
**Checklist:** HR-zone boundaries and whose max HR they use · pace/distance units and GPS smoothing ·
running bests window and tie handling · the guided-walk store surviving a background kill · fitness-
test scoring tables and their citation · weather calls: cached, rate-limited, keyed where.
**Run:** import and boundary-test zone assignment at every threshold ±1 bpm; replay a recorded walk.
**Trap:** treating the fitness-test lookup tables as ground truth without checking the cited source.

#### Lane 09 — Nutrition specialist
**Mandate:** calories, macros, goals, meal plans, scans.
**Surfaces:** `packages/shared/src/nutrition/`, `lib/nutrition/`, `app/api/nutrition/`,
`app/api/nutrition-goals/`, `app/api/food-logging-complete/`, `app/api/water-log/`,
`app/api/measured-rmr/`, `app/nutrition`, `components/nutrition/`.
**Checklist:** Atwater factors from `atwater.ts` only (RV-44 — has it moved) · RMR/TDEE formula and
its inputs (DEXA-corrected body fat rule) · goal recommendation vs measured RMR precedence · meal-
split rounding preserving totals · the scan route's sanitiser · water goal derivation · day boundary
for a log at 23:59.
**Run:** import and check that every meal split sums to its input; pull 30 days of the owner's
totals and reconcile against the day-log aggregate.
**Trap:** checking the macro maths and never opening the goal-recommendation precedence.

#### Lane 10 — Body composition specialist
**Mandate:** weight, body fat, DEXA, the scale, clinical panels.
**Surfaces:** `app/api/body-metadata/`, `app/api/dexa-scans/`, `app/api/blood-panel/`,
`app/api/scale-ble/`, `lib/scale-ble/`, `app/baselines`, `app/more/clinical`, `body_metrics`.
**Checklist:** the DEXA correction — what it applies to, and whether every body-fat consumer goes
through it · scale ingest tolerance windows and day keying · trend smoothing window · blood-panel
reference ranges and their source · what a duplicate weigh-in does.
**Run:** ingest two weigh-ins 30 seconds apart via the route; check the trend endpoint.
**Trap:** verifying the correction exists in one file and not tracing its consumers.

#### Lane 11 — Dates and timezones specialist
**Mandate:** every place a day, week or window is constructed.
**Surfaces:** `packages/shared/src/date-utils.ts`, every `aestMidnight`, `todayInTz`,
`normalizeDateParam`, `formatTimeOfDay` call site, every SQL `date_trunc` and `interval`.
**Checklist:** every route's date param through `normalizeDateParam` and a `[-/]` regex · every
window anchored at local midnight · every `toLocale*String` carrying a `timeZone` · tests whose
fixtures cross a day boundary in some zone · cache keys embedding the local date · DST-free
assumption where a user zone might have DST.
**Run:** set a test user to an `Etc/GMT±N` zone whose local time is currently 00:30 and run the full
test suite; then the same at 23:30.
**Trap:** grepping for the banned `toISOString().slice` and stopping.

### Family C — the AI system

#### Lane 12 — Model-call inventory specialist
**Mandate:** every LLM call, what it costs, and whether its output is used.
**Surfaces:** the 13 routes and 4 libraries that call `generateObject`/`generateText`/`streamText`:
`app/api/ai/health-insight`, `daily-digest`, `weekly-digest`, `generate-program`, `builder-chat`,
`exercises/generate`, `nutrition-goals/recommend`, `nutrition/scan`, `nutrition/meal-plans/**`,
`workout-review/session/[sessionId]`, `workout-sessions/[id]/recap`, `running-plan/explain`,
`lib/ai/retry.ts`, `lib/ai/instrument.ts`, `lib/nutrition/meal-top-up.ts`,
`packages/shared/src/ai-periodization/generate-prescription.ts`; `app/more/settings/developer/ai-usage`.
**Checklist:** per call — model, structured vs prose, schema or `JSON.parse`, `PROSE_GUARDS`, try/
catch to JSON error, rate limit matching siblings, retry policy, instrumentation · **is the output
read by anything, or computed and discarded** · is the model doing arithmetic that belongs in code ·
is code hand-rolling something the model would do better · token cost per call and per day from the
`ai-usage` surface.
**Run:** fire each route once against local; read the `ai-usage` table for 30 days of production
cost by route.
**Trap:** confirming `generateObject` is used and never asking what happens to the object.

#### Lane 13 — Prompt quality specialist
**Mandate:** what the models are actually told.
**Surfaces:** every prompt string in the routes above, `lib/ai/prompt-guards.ts`, `lib/ai-chat/`,
`lib/coach/`, `packages/shared/src/session-explain/`.
**Checklist:** does each prompt hand the model the numbers it needs, or make it guess · units stated ·
the no-superlatives / quote-the-number guard present and effective (test it: hand a score of 80 and
see if "perfect" appears) · stale references to removed features or old model names · prompts that
duplicate each other's instructions and could share a fragment · anything a user could inject
through a free-text field that reaches a prompt unescaped.
**Run:** send each route a crafted input and read the prose; try one injection per free-text field.
**Trap:** reading the guard file and declaring the prompts guarded.

#### Lane 14 — Coach and tool-calling specialist
**Mandate:** the agentic surface — chat, tools, confirmations.
**Surfaces:** `app/coach`, `app/coach/confirm/[toolCallId]`, `app/api/coach/`, `lib/coach/`,
`lib/ai-chat/tools.ts`, `components/chat/`, `components/coach/`.
**Checklist:** every tool's input schema and ownership check · which tools mutate and whether each
goes through the confirm page · the ms-offset window ban in `tools.ts` · what a tool returns on
error and whether the model can tell · conversation persistence and its size bound · whether a tool
call can be replayed from a stale confirm URL.
**Run:** drive a conversation that triggers each tool; attempt a confirm twice.
**Trap:** listing the tools.

### Family D — data in motion

#### Lane 15 — Postgres schema and migrations specialist
**Mandate:** the 266 migrations and the schema they produce.
**Surfaces:** `lib/data/postgres/migrations/`, `lib/data/postgres/schema.ts`, `ensureSchema`,
`scripts/check-migration-numbers.js`, the `claude_ro` views.
**Checklist:** schema.ts vs the migrated database — diff them · columns that are 100% null in tables
with rows · indexes vs the query patterns the routes actually run (`EXPLAIN` the top ten) · every
`claude_ro` view still row-scoped after 266 · tombstones (`deleted_at`) on every domain with delete
UI · foreign keys that should cascade and don't · migrations that would not be reversible.
**Run:** `drizzle-kit` diff or equivalent against the local db; null-rate query over every column in
production; `EXPLAIN ANALYZE` on the day-log and calendar-data queries.
**Trap:** counting migrations.

#### Lane 16 — Write-path ownership specialist
**Mandate:** every route that writes, and whether it can write someone else's row.
**Surfaces:** every `app/api/**/route.ts` handling POST/PUT/PATCH/DELETE (of 219 routes),
`lib/data/repository.ts`, `lib/data/postgres/adapter.ts`, `scripts/check-repository-user-scoping.js`.
**Checklist:** rule (a) affected-row count checked before dependent child writes · rule (b) no raw
body into `.set()` — Zod whitelist · rule (c) client-supplied ids ownership-verified via join ·
strict schemas (the non-strict count ratchet) · bounded bodies · no raw error in responses.
**Run:** as user B, send every mutating route user A's ids — with the one-field control. Script it;
there are too many to do by hand.
**Trap:** sampling five routes and generalising.

#### Lane 17 — Outbox and sync specialist
**Mandate:** the local store, the mutation outbox, push, pull, and conflict.
**Surfaces:** `lib/local-store/*` (`sync-engine.ts`, `push-then-revalidate.ts`, `sync-helpers.ts`,
`dead-letter-signal.ts`), `packages/shared/src/sync/`, `app/api/sync/`, `app/api/sync-health/`,
`scripts/check-push-mutations.js`, `scripts/check-invalidate-after-push.js`.
**Checklist:** every local-first domain writes locally on every path including delete (the Q-488
class) · what happens when push fails N times — dead letter, and is it surfaced · pull throttle and
whether any path forces it · conflict rule when server and device both changed a row · the
`RECONCILE_TABLES` completeness · what a device that skipped 100 migrations does on first pull.
**Run:** read the sync-health endpoint in production for the owner's dead-letter count; trace one
mutation of each type through the outbox in the unit tests.
**Trap:** reading the engine and reporting its design.

#### Lane 18 — Cache and freshness specialist
**Mandate:** every cache key, its TTL, its writers, and whether its invalidation is load-bearing.
**Surfaces:** `lib/cache-groups.ts`, `packages/shared/src/cache-ttl.ts`, `lib/sqlite/cache.ts`,
`lib/hooks/use-cached-value.ts`, `lib/hooks/use-invalidation-refetch.ts`, every `cachedFetch` /
`cachedFetchToday` / `readCacheSync` / `freshWithinTtl` site, the sync-provider warm list.
**Checklist:** build the key → readers → writers → groups matrix · one TTL per key · one fetch variant
per key · prefix-siblings · every `freshWithinTtl: true` with its written proof · seed-only read paths
(the Q-260 shape) · which invalidations are actually load-bearing (Q-262) · today-keys embedding the
local date · `Cache-Control: private, no-store` on every route.
**Run:** for each write group, perform the write in Playwright and assert every reader repaints
without a reload.
**Trap:** confirming the groups exist. The matrix is the deliverable.

#### Lane 19 — Export, privacy and deletion specialist
**Mandate:** what leaves the system and what can be removed from it.
**Surfaces:** `app/api/export/`, `lib/export/`, `app/more/data`, `app/api/friends/`,
`app/profile/[userId]`, `scripts/check-export-coverage.js`, `scripts/check-private-paths.js`.
**Checklist:** every table exported or excluded with a reason · what a friend can see of you, field
by field · account deletion: does it exist, and what survives it · PII in `error_events` payloads ·
the `download-apk` route's exposure.
**Run:** export the seeded user and diff the tables covered against `pg_tables`.
**Trap:** running the export-coverage check and calling privacy done.

### Family E — devices and native

#### Lane 20 — Oura BLE pipeline specialist
**Mandate:** ring → Kotlin → ingest → decode → rollup → display.
**Surfaces:** `android/**` (29 Kotlin files), `lib/oura-ble/`, `lib/oura-models/`, `app/api/oura-ble/`,
`app/api/oura/` (the six kept routes), `app/admin/oura-ble`, `components/oura-ble/`,
`docs/oura-ble-operations.md` §1 matrix, `oura_raw_samples`, `oura_raw_packed`.
**Checklist:** cursor advances only on server 2xx · decoders infallible · every failure signature in
the §1 matrix still matched by code · the 14-day local window vs the server archive · `ring_timestamp_ds`
anchoring · what the admin console shows that the user never sees and should · data freshness in
production right now (latest sample age).
**Run:** latest-sample age and 7-day gap histogram from production; decoder test vectors pass.
**Trap:** anything about BLE behaviour asserted from the web build. Kotlin is compile-gated only here.

#### Lane 21 — Other devices specialist
**Mandate:** Colmi, Polar, the scale, Health Connect, live HR.
**Surfaces:** `lib/colmi-ble/`, `lib/polar-ble/`, `lib/scale-ble/`, `lib/live-hr/`,
`app/api/colmi/`, `app/api/hr-ingest/`, `app/api/health-connect/`, `lib/hooks/use-colmi-auto-sync.ts`,
`lib/hooks/use-strap-battery.ts`, `lib/stores/strap-battery.ts`, `app/more/devices`.
**Checklist:** per device — ingest schema, dedup key, day keying, tolerance windows, what happens
on duplicate delivery · ranked per-field merge when two devices report the same metric · Health
Connect record keys against the pinned plugin's source, not memory · battery reporting freshness ·
which of these are still in use by the owner (production) and which are dormant code.
**Run:** last-write per source in production; send each ingest route a duplicate.
**Trap:** treating five device pipelines as one lane's worth of skim. Each gets its checklist.

#### Lane 22 — Native bridge and Android specialist
**Mandate:** Capacitor, plugins, the WebView, background work, notifications.
**Surfaces:** `capacitor.config.ts`, `lib/native/`, `lib/background/`, `android/**`,
`scripts/check-plugin-proxy-thenable.js`, `scripts/check-render-process-recovery.js`,
`docs/canonical-runtime-android.md`.
**Checklist:** every plugin call wrapped for the web-null case · WebView renderer death handled ·
background settings store vs what Android actually allows · notification permission flow · the
APK version check against `app/api/version` · anything that would force an uninstall (the ring-key
warning).
**Run:** compile-gate only. Everything else is *not exercised here*, named for the device checklist.
**Trap:** claiming any native behaviour from this sandbox.

### Family F — the surface

#### Lane 23 — Mobile UI and gesture specialist
**Mandate:** every screen at the S25 viewport.
**Surfaces:** `app/globals.css`, `components/ui/`, `components/shell/`, `lib/hooks/use-sheet-back-dismiss.ts`,
`sheet-back-stack.ts`, `use-scroll-restoration.ts`, `use-back-or-fallback.ts`, every bottom-anchored
action row, `docs/mobile-ui-and-performance.md`.
**Checklist:** floored safe-area utilities on every bottom action · back-button behaviour per screen
and per sheet · scroll restoration per tab · tap targets ≥ the floor · skeleton flash on repeat
visit per screen · gesture direction-locking where a horizontal swipe exists · contrast and
accessible names (the two checks — and what they miss).
**Run:** the Playwright crawl from lane 02 at 412×915, once cold and once as a repeat visit,
screenshotting each; run the back-dismiss sweep spec.
**Trap:** citing the utilities exist. Screenshot or it did not happen.

#### Lane 24 — Performance specialist
**Mandate:** what it costs to load and to render.
**Surfaces:** `next build` output, `components/perf/`, `lib/perf/`, every `React.memo`,
`package.json` (88 deps), `scripts/check-component-size.js`, `scripts/check-memo-prop-stability.js`.
**Checklist:** route-level bundle sizes and the three largest · dependencies with zero import sites ·
memo sites defeated by inline props · N+1 in the repository (count queries per day-log request) ·
payload sizes of the ten most-called routes · re-render counts on the home tab during a timer tick.
**Run:** `pnpm build` and read the size table; `depcheck` or a grep per dependency; query-count the
day-log route with a pg log.
**Trap:** listing "could be optimised" without a measurement attached.

### Family G — the engineering estate

#### Lane 25 — CI, custom rules and test estate specialist
**Mandate:** whether the guards guard, and whether the tests test.
**Surfaces:** `.github/workflows/ci.yml`, every step of the Custom Rules job and its `scripts/check-*.js`
(the runner prints the count — never hardcode it; the steps with no script are inline greps), `pnpm check:rules`, `lib/__tests__/`, `components/__tests__/`,
`packages/shared/src/__tests__/`, `app/api/__tests__/`, `e2e/*.spec.ts`.
**Checklist:** run `pnpm check:rules` and quote `Ran N of N` · **for every rule, write a violating
snippet and confirm the check fires** — a guard that exists but does not reach is this repo's most
repeated finding · which shrink-only baselines have not shrunk in 60 days · test files with no
assertion, with hour-dependent fixtures, with hardcoded one-sided timestamps · e2e specs that stub
the route they claim to test · what the test suite does not cover at all (a route with zero tests
in any layer).
**Run:** the violating-snippet loop, scripted; a coverage report; `git log` on each baseline file.
**Trap:** quoting `69 of 69 passed` as the result.

#### Lane 26 — Documentation and process specialist
**Mandate:** the docs estate, the agent process, and `CLAUDE.md` itself.
**Surfaces:** `CLAUDE.md` (774 lines), `projectOverview.md` (9,837 lines), `docs/module-map.md`,
`docs/implementation-backlog.md` (17,797 lines), `docs/domains/*/README.md`, 151 reviews, 371 plans,
44 specs, 309 journal entries, 67 handoffs, 107 top-level docs, `docs/agents/**`, `docs/doc-size/`.
**Checklist:** `CLAUDE.md` — every rule stale, superseded, contradicted elsewhere, or duplicated;
every rule that a custom check now enforces and could shrink to a pointer · `projectOverview.md` —
Known-Issues rows whose fix has shipped; rows with no owner · the backlog — entries older than 90
days with no movement, entries whose target file no longer exists, `Needs:` chains that cannot
clear · plans that were built differently from how they were written · pillar indexes missing a doc
that mentions the pillar · handoffs that should be archived · a disposition per top-level doc:
keep / merge into X / rewrite / archive / delete.
**Run:** `node scripts/next-item.js --lane A` and `--lane B` to see what the queue actually says;
`git log --since=90.days` per backlog entry heading; link-check.
**Trap:** counting documents. Dispositions are the deliverable, and `CLAUDE.md` gets its own
section — it is loaded into every session, and a stale rule there costs more than a stale doc
anywhere else.

---

## The seam pass — after all lanes return

Findings that live between two lanes are the ones no sweep ever files. Before collating, run these
comparisons explicitly and write a paragraph for each:

- **02 × 24** — pages recommended for deletion vs the bundle weight they carry.
- **12 × 24** — AI cost per route vs how often the route's output is actually viewed (`ai-usage` ×
  page analytics or route hit counts).
- **17 × 18** — every local-first write vs the cache group it invalidates: a write that is local but
  whose readers are `cachedFetch` is both lanes' finding.
- **05/06/07/08/09 × 13** — every number a prompt is handed vs where that number is computed: any
  prompt re-deriving a formula is a One-Formula violation.
- **11 × 15** — every SQL window vs the timezone it is computed in.
- **03 × 16 × 19** — what a friend can read vs what a mutating route would let them write vs what
  the export includes.
- **25 × everything** — every finding from another lane that a custom rule claims to prevent is a
  lane-25 finding about that rule.

## Collating

Deduplicate across lanes — the same defect reached from two directions is one finding with two
pieces of evidence. **Name patterns by cause, not by area**: "six sites hand-roll a constant that has
a shared home" is a pattern; "nutrition has issues" is not. Rank by cost of being wrong: data
correctness, then user-visible, then consistency, then hygiene. Open the report with a plain-English
paragraph on **what this app now contains** — the thing nobody currently knows.

## Outputs

1. **`docs/reviews/YYYY-MM-DD-app-checkpoint.md`** — the state-of-app paragraph → cross-lane
   patterns → the seam pass → the consolidation proposal (lane 02's dispositions, as its own
   section) → the `CLAUDE.md` audit (lane 26, its own section) → per-lane sections including the
   clean ones with their method → what was not exercised.
2. **Backlog entries**, one per finding, **capped**: if a lane produced fifteen hygiene items, file
   the class as one entry listing the sites. A checkpoint that adds eighty entries has buried its
   own findings. Tag every heading with its pillar(s), primary first. `Gate:` takes only `owner` or
   `device`; a page disposition is `Gate: owner` with a recommendation, not a question.
3. **`projectOverview.md`** Known-Issues rows for anything data-correctness or user-visible.
4. **Pillar index links** in `docs/domains/<pillar>/README.md` for the report.
5. **A journal entry** at `docs/overview/entries/YYYY-MM-DD-app-checkpoint.md`.

Your IDs are `PS-<n>`: `grep -rhoE '\bPS-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`. Your PR is
docs-only: open it, let CI run, merge without asking. Re-merge `origin/main` before opening and
again before merging.

## Never

- Write "fixed", "clean" or "verified" for anything not observed. Clean requires the method stated.
- Report a finding whose only evidence is a subagent's summary.
- Report a refusal as an enforced rule without the one-field control.
- Claim device behaviour from the web build.
- Fix code, take a migration number, or touch anything outside `docs/`.
- File something actively harmful in production and move on — say so immediately and prominently.

## Done

When everything has landed: rename yourself to `🧭 App Checkpoint 🔴` — `get_session` with
`session_id` omitted for your own ID in `ccr.id`, then `set_session_title` — and post the owner a
summary that opens with the state-of-app paragraph and lists the patterns, not the lanes.
