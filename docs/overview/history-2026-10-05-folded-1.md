# Session journal — batch folded 2026-10-05

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-28-lane-a-la159-drop-program-phases-program-id"></a>

# 2026-09-28 — LA-159: `program_phases.program_id` dropped, behind a guard that cannot lose data

The column phases stopped using when they moved under `phase_set_id` (021/024). A join on it answers
"none" with no error, which is how LA-138 first reported 46 phases as 0.

**Evidence it is dead:** 0 of the owner's 46 rows hold a value in production. No reader or writer
exists in `app/`, `lib/`, `packages/` or `scripts/`: every insert path sets only `phase_set_id`, and
only the claude_ro predicate and the export map read it, both removed here. **That production
measurement is owner-scoped**, so migration 293 checks again at run time and drops the column only
if no row in any account holds a value. Otherwise it leaves the column and raises a notice.

- **Migration 293:** a guarded, replay-safe `DO` block that drops the claude_ro view first (the
  shape LA-142 found was necessary), then the column. `claude-ro-views.sql` is regenerated without
  the column or the predicate arm, and `export-map.ts` loses the arm too.
- **Replay:** CI's Migration Check re-runs every migration against a full schema. 021's backfill
  reads the column, so it joins 001 in `REPLAY_EXEMPT`, which makes one exemption. LA-114's lesson
  was that a column named in a dozen migrations cannot be removed this way; this one is named in
  one. Reproduced CI's procedure locally (fresh database, migrations only, truncate, `--replay`):
  clean.
- **Tests:** the guard is tested inside rolled-back transactions (a value keeps the column, all-null
  drops it, and it is a no-op once gone). Mutations: removing the value guard and removing the
  existence check were both killed. `claude-ro-program-phases-scope` loses its two cases that pinned
  the column as always-NULL.

**Held for the owner's yes before merge**, as the entry required for a data-dropping migration,
even though the guard means nothing with a value can be dropped.

**Found by this PR's suite:** the first guard test ran its DDL on the shared test database and failed under load with "tuple concurrently updated". It now runs in a throwaway database holding only the two objects the migration touches, and a new mutation (skipping the view drop) is killed by it. `storage-footprint-real-counts` raced again, the other way this time: a neighbour's cleanup made a table-wide `>=` miss. It now checks its own rows (exactly 9).

<a id="2026-09-28-lane-a-tn56-replay-endpoint"></a>

# 2026-09-28 — TN-56: an admin replay for thresholds whose inputs are never stored

The 2026-08-25 threshold sweep listed 25 constants it could not judge, because their inputs are
per-sample intermediates that nothing persists. `POST /api/admin/replay` re-runs a named function
over up to 60 days with one of its own parameters bracketed, across up to 12 values. It loads the
inputs once and evaluates purely per value. It writes nothing, and every response includes a run
at the defaults, whose `matchesStored` count shows how well the replay reproduced production. The
registry (`lib/tuning/replay/registry.ts`) is the only reachable surface: a function name and a
parameter it declares, within declared bounds.

The first function is `nightly-temperature`. `temperature-baseline.ts` takes `RANGE_THRESHOLD` and
`MIN_WINDOWS` as options, with defaults unchanged.

**Measured on the owner's real data (snapshot, 2026-09-01 → 27).** A replay inside the stored
`sleep_sessions` window reproduced production exactly on every night it scored, 11 of 11. But it
scored nothing on 7 more, because for those dates `sleep_sessions` holds only a daytime nap. The
night the rollup scored is not kept there, the same shape as LA-144. Clustering the night's own
sleep_temp frames finds every night but lacks the rollup's trimming. The shipped version uses
both: the stored window when it holds a scoreable night, the cluster otherwise. Result: **15 of 17
comparable nights exact**, the rest 0.05–0.31 °C off.

**Found on the way, shipped separately (#1900):** the local snapshot loader stored `bytea` values as
their JSON text, so every packed raw frame in a local snapshot was unreadable.

**Held for the owner** (LA-173 ⑤): `db-query`'s authorisation moved into one shared helper
(`lib/admin/claude-token-auth.ts`) with identical logic, which the new route uses. That touches auth,
so it is his yes. All 87 existing admin-guard and db-query tests pass unchanged.

<a id="2026-09-29-bugfix-inbound-merged-auth-review"></a>

# 2026-09-29 — the inbound PRs merged themselves, and one of them was auth

**Agent:** BugFix intake, third firing of the daily inbound GitHub watch (OR-185). **Docs only.**

## The sweep

- **Open issues: 0.**
- **Open PRs: 7, all ours.** `#1607` and `#1608` are gone — `jsboiss` **merged both himself at
  10:25 on 2026-09-29**.

That is his to do and this entry does not dispute it. What it records is that **the review `BF-212`
said was owed never happened**, and `#1607` is the auth carve-out, with the owner listed as a
requested reviewer who did not review. It is deployed.

## It merged on a stale green

`#1607`'s only CI run is **2026-09-25, six jobs with a single `Tests`** — from before the suite was
sharded into four. Four days and a CI topology change separate that run from the merge. All six
passed; none ran against the tree it landed on. (`#1608`'s green was current, checked 09-28.)

## What the diff actually does

23 lines in `app/api/auth/exchange-mobile-token/route.ts`, and most of it is careful:
`responseType` allowlisted to `cookie`/`token` with a 400 otherwise; the session verified through
`getToken` — decrypt plus an explicit `exp` check — before anything is returned;
`Cache-Control: private, no-store`; the cookie path untouched.

**The one thing needing a decision:** the bearer token *is* the session cookie's value, with the
cookie's lifetime — `accessToken: sessionCookieValue`, `expiresAt: session.exp`, against
`maxAge: 7 * 24 * 60 * 60`. One credential now lives in two containers with very different
properties: a cookie is `httpOnly`, `SameSite`, browser-confined; a bearer token is deliberately
handed to a native app to store and replay, for up to seven days, and being a stateless JWT nothing
revokes it before `exp`.

## The alarming version of that finding is wrong, and I checked before writing it

The session JWT **does** carry the Google refresh token (`auth.config.ts:45`) — the thing `RV-193`
exists to keep out of the session JSON. So this looked like RV-193 reaching a new surface.

**It is not. The JWT is encrypted, not merely signed** — verified against the pinned source,
`@auth/core@0.41.3` `jwt.ts:52-53`: `alg: "dir"`, `enc: "A256CBC-HS512"`, JWE. A client holding the
token cannot read what is inside it. The finding is an opaque session credential in a weaker
container, which is a real but much smaller thing, and the citation is what keeps it that size.

## Queue hygiene

`BF-212` and `BF-213` removed — they routed PRs that have merged, so they were finished entries
sitting in the queue. What is genuinely still owed moved to **`BF-224`**: the post-merge read, plus
the one owner decision (bearer lifetime).

**`TN-80`'s PR register** listed both as awaiting the owner. Those two rows are struck, with what
actually happened. That register has now needed correcting twice; it tracks a moving object and is
only true on the day it is written.

## Not exercised

Docs only. **Nothing merged, closed, pushed or commented on either inbound PR** — and both were
already merged by their author before this sweep ran. No device run, no code change. **Whether any
client is already exchanging with `responseType: 'token'` was not checked** — that decides whether
shortening the expiry is free or breaking, and BF-224 names it.

<a id="2026-09-29-chore-bf220-rpe-reaches-nothing"></a>

# 2026-09-29 — BF-220: the set he just logged can move the next one

**Branch:** `chore/bf220-rpe-reaches-nothing` · v1.486.0.

Owner, mid-rest on Pull: *"This was too heavy for me … would be nice to be able to tell coach then
and there if thats on the list of possibilities."* He had already told it — `13.75 kg × 6` at **RPE
10** against a prescribed 7 — and the next card still read `13.75 kg × 7`.

## The diagnosis, verified rather than inherited

`computeRpeAdjustment` has exactly **two** non-test call sites, checked by export name: its own
definition and `autoregulation.ts:141`, which runs at prescription-generation time. Nothing in a live
session reads RPE at all. The rule that would fire already agrees with him — his set trips the
back-off branch (`rpeDelta ≥ RPE_DEAD_BAND` **and** the reps fell short) the moment it is logged.

## It calls the engine instead of restating it

`RPE_DEAD_BAND` is **not exported**, so a threshold copied client-side is exactly the divergence the
one-formula rule prevents — and the in-session answer could then contradict next week's on the same
set. `rpe-load-suggestion.ts` builds an `AutoregSignal` and reads `pctMultiplier`.

**The number matches what the entry predicted independently:** 6 of 7 reps ⇒ completion 0.857 ⇒ a
6.86% cut ⇒ 12.81 kg ⇒ **12.5 kg** at the 1.25 step. The entry's worked example says *"Drop set 2 to
12.5 kg?"*. Pinned, because an arithmetic slip would still have produced *a* lower number and looked
right.

## Two narrowings

**`rm1Trend` is passed as `'flat'`** — the real trend needs history this screen has not got. It can
only ever *withhold* a suggestion, never invent one, and the reported case turns on the reps.

**An untouched RPE picker cannot fire it.** `rpeValues` is seeded with `defaultRpeFromPct(pct)`, so a
set he never rated reads back as exactly the expected RPE and fails the dead band. The morning
check-in's neutral `3` class — here the arithmetic makes it inert, pinned across four percentages.

## ⚠ The browser render earned its place: the offer was mounted where it could never be seen

The first wiring put the pill inside `ActiveSetCard`. That component is mounted
`{workoutPhase === "set" && …}` — and **logging a set moves the phase to `"rest"`**, where the same
zone renders the `RestTimer` instead. So the offer never mounted in the one window it exists for: the
rest between a hard set and the next, which is exactly when he is looking at this screen, as the
entry itself says (*"a rest timer running"*).

Neither the eleven unit tests nor reading the props could show that. The render did. The pill now
sits **above the phase switch**, so it appears during rest and persists into the set, and
`active-set-card.tsx` reverts to what `main` had — a smaller diff than the first attempt.

## Two false leads, unwound

**It looked like this change broke the workout loop.** The first e2e runs failed with no `Start Set 2`
at all. The control — `workout-set-loop.spec.ts`, untouched — **failed the same way**, and failed
against `origin/main` too. Local database state, not any change: `LB-178`'s standing lesson that CI
seeds a fresh database and a persistent local one has been mutated by every previous run.
`pnpm db:rebuild` restored it and the control passed 3/3.

**And this spec was what polluted it.** Unlike its sibling it had no cleanup, so each run left
sessions behind for the next to resume into. Added, with the measurement in its docstring.

One of my own probes was invalid and its result discarded: `test.afterAll.skip` is not real API, so
the run collected nothing and returned only seeded rows.

## Verified

- `bf220-rpe-load-suggestion.test.ts` — **11 tests**, including the reported set and the pinned
  12.5 kg.
- `e2e/bf220-rpe-load-suggestion.spec.ts` — **2 passing**: one test drives a hard short set and
  checks the pill appears on the next set card, carries the engine's own sentence and moves the dial
  when taken; the other checks that dismissing it leaves the session untouched.
  **⚠ Corrected 2026-09-30 (LB-189): this said 4.** The file holds **two** `test()` blocks — 4 was
  Playwright's run total, which counts the `auth.setup.ts` and `zero-data.setup.ts` projects
  alongside the specs, so every spec run here reports two more than it has. Quote
  `grep -c '^test('`, not the runner's last line.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 84 of 84** · `pnpm lint` 0 errors · `pnpm test`
  **11,059 passed** · `pnpm build` · memo-stability and size gates clean.

Two gates caught real mistakes: `check-memo-prop-stability` found inline arrows on the memoised pill
— the rule its own docstring cites — and RV-209's type floor found a `text-[10px]` below the floor
plus two 11px literals where the scale has a token.

## Not exercised

- **The device**, which is filed rather than claimed:
  [`known-issues.md`](known-issues.md) carries the entry's own pass/fail (the suggestion must not
  shift the layout or compete with `Start Set 2`) **plus a second reading the entry does not name** —
  the pill sits above the card, so on a short viewport it may arrive off-screen and be missed
  entirely, the opposite failure from crowding and equally invisible from a container.
- **A deload session.** The suppression is asserted at the unit level; no sandbox session is in a
  deload week, so the `isDeload` prop's real value has never been anything but `false` in a browser.
- **The next exercise.** Deliberately out of scope per the entry — one exercise feeling heavy is weak
  evidence about the next.

<a id="2026-09-29-chore-lane-b-triage"></a>

# 2026-09-29 — a `Needs:` field that says "nothing" parked six entries

**Branch:** `chore/lane-b-triage` · tooling and queue hygiene. No product change, no version bump.

Lane B's READY list read **0** — *"nothing startable — everything is parked or unclassified"* — with
46 entries in KEEP owing mostly device passes this lane cannot perform. Triaging that rather than
inventing work is what found the cause, and it was not the queue.

## The bug

`parseEntries` reads a `Needs:` field with
`/^\s*[-*]\s*\*{0,2}Needs:\*{0,2}\s*(.+)$/i` and then extracts **every entry id from the rest of the
line**. So the sentence explaining that a dependency was *removed* put it back:

```
- **Needs:** — nothing. **⚠ This said `LB-149` until 2026-09-28, and the dependency was INVERTED.**
```

The field declares **nothing**. The parser returned `needs: ["LB-149"]`, `next-item.js` parked the
entry, and `LB-166` — shipped and CI-verified — sat in PARKED where it reads as neither work nor done.

**Measured: six entries across four lanes**, each parked by its own clearing note.

| Entry | Lane | Its own words in the line that parked it |
|---|---|---|
| `LB-166` | B | *"This said `LB-149` until 2026-09-28, and the dependency was **INVERTED**"* |
| `BF-220` | B | *"Shares a cause with BF-219 but is **separately buildable** and separately useful"* |
| `BF-138` | B | *"**Read** BF-134, BF-137 and TN-29 **first**"* — a reading order, not a dependency |
| `BF-221` | A | *"this is the code half and is **buildable now**"* |
| `BF-192` | A | *"answered by the owner on 2026-09-24 and are **carried here so this entry is buildable**"* |
| `BF-137` | T | *"**Cross-reference** TN-29, which catches this instance through a different mechanism"* |

Every one says, in that very line, that it is not blocked.

## The fix

`declaresNothing(value)` in `scripts/lib/backlog-entries.js`: when a `Needs:` value opens with
*nothing* or *none*, the id extraction is skipped and the prose after it is treated as a note to a
human, which is what it is.

Same class as `decorated-field.js` (a field invisible behind a warning sign) and the
comment-blindness guard: **a matcher reading a mention as a declaration.** That is three instances of
this class in one session — a path-shaped grep calling a live component dead (OR-115), an e2e
assertion tripping on its own docstring (Q-231), and this.

**The fix is narrow, and `BF-139` is the control.** It carries a real `- **Needs: LB-157**` *and* a
later *"Needs: nothing more"*; it stays parked on LB-157 exactly as it should.
`scripts/__tests__/backlog-needs-nothing.test.ts` (6 tests) pins both directions — a clearing note
reads as no dependency, a real field still reads as one, and an entry with both lines still parks.

⚠ Its first draft used `ZZ-` fixture ids and **parsed to nothing at all**, because a prefix
`scripts/lib/entry-id.js` does not know is dropped **silently** rather than rejected. That is the
failure mode CLAUDE.md warns about for a new role's letter, met first-hand; the fixtures use `PS-`.

## Queue hygiene that the false park was hiding

`LB-166` is **removed**. It shipped on 2026-09-28 (the four-way E2E shard split) and its own entry
already recorded ✅ SHARDED and ✅ VERIFIED ON CI; the protocol step of clearing it was skipped because
PARKED is not where anyone looks for a finished entry. Today's run `36612516981` concluded `success`
with 15 jobs and 0 failures — four shards at roughly 9–11 minutes each against a 25-minute per-shard
timeout, and the whole gate → shards → rollup sequence inside ~14 minutes, against the 45-minute cap
the unsharded suite had been hitting. Its concern is answered.

Lane B's READY list is now **2**: `BF-220` and `BF-138`.

## Not exercised

- **The other lanes' queues.** The fix unparks `BF-221` and `BF-192` (A) and `BF-137` (T) as a side
  effect. That is correct by each entry's own text, but no judgement is offered here on whether those
  are the right next items for those lanes — that is theirs and the Orchestrator's.
- **Whether other fields have the same blindness.** `Gate:` takes a single word (`/([a-z]+)/`) so it
  cannot absorb prose; `Verify:` was not audited. Worth a look, not looked at.
- **No product code changed.** `scripts/` and one test file only.

<a id="2026-09-29-chore-lb187-builder-review-e2e"></a>

# 2026-09-29 — LB-187: the AI builder's review screen is no longer unseen

**Branch:** `chore/lb187-builder-review-e2e` · one new spec, no product change, no version bump.

Nothing in `e2e/` reached `builder-review.tsx` — the single point at which an AI-generated program is
committed to the database — so `LA-183`'s style-fill shipped unit-tested and source-guarded but never
once observed in a browser. `grep -l 'generate-program' e2e/` was empty.

## The cost check the entry demanded, answered with a measurement

The entry required sizing against the shards' current wall-clock rather than adding a spec blind,
citing `LB-166`'s 45-minute ceiling. That ceiling was the **unsharded** suite. Measured from shard 4's
own uploaded `report.json`: **9.4 minutes for 75 tests, 7.5 s per test, against a 25-minute
`timeout-minutes`.** Roughly 38% of budget, ~15 minutes of headroom per shard. A spec of this size is
affordable, and this one runs in **1.6 min** locally.

## The cheap path is a trap, and taking it would have produced a spec that cannot fail

The obvious route is the default `ai` progression mode: `lastQuestionStep` is 7 there, so generation
fires after three inputs and four `Next` taps and jumps straight to the review. It is **useless for
this assertion.** In `ai` mode the row's second line is
`formatGoalRange(goalRange(inputs.goal, ex.exerciseRole)) · AI sets each phase`
(`builder-review.tsx:569-572`) — it never consults the style at all, so a style-less exercise and a
styled one render **identically**. Only the `progressionStyleName` branch at `:573` renders the style,
and only outside `ai` mode, where a slot with no style renders `null`. That `null` is the blank line
LB-187 exists for.

So the spec selects **Linear**. `handleNext` skips step 8 for linear (`next === 8 && linear → 9`), so
the path is 1→2→3→4→5→6→7→9→10 — **nine steps, the entry's own figure, for a reason the entry never
stated.** Only three steps need real input (`canAdvance`): a name, one equipment choice, one focus
muscle. The rest advance on `INITIAL_INPUTS`.

## Two things that would each have made the spec vacuous

**The stub must give a sibling a style.** `fillGeneratedStyles` infers from the program it is handed,
and `fill-generated-styles.test.ts:63-64` pins the case where nothing carries one: every slot stays
`undefined`, because there is nothing to read. A stub with no styles anywhere would render blank lines
and **pass against the very bug it guards.** So the fixture gives two primaries `Strength 4-set` and
leaves the accessory with neither id nor name; the fill resolves it from the siblings, and
`STYLE_DISPLAY['Strength 4-set']` renders `4 × 5 @ 80% · 120s rest`. The assertion is that line's
count is **3**, not 2.

**The `Next` count was one too many at first,** and the failure pointed somewhere else entirely — see
below.

## What it does NOT drive, and why that is not a gap

The entry also asks that the saved program carry a non-null `style_id`. `handleSave` maps
**`shown.sessions`** (`builder-review.tsx:297`) — the *filled* program, the same object the rows render
from. So asserting the rendered line establishes what the save would map; whether the route persists it
is the route's own concern with its own tests. The sibling spec on this screen
(`lb186-new-exercise-has-a-style.spec.ts`) also records why saving from a spec is a hazard: it makes
the assertion depend on state any earlier spec in the same run can change.

Style ids are arbitrary on purpose — `fillGeneratedStyles` calls `mostUsedStyleId` with the default
`isKnown`, which accepts every id, because a generated program's ids were already resolved
server-side. So this needs no `progression_styles` fixture at all.

## Verified by a control pair

| tree | result |
|---|---|
| as shipped | **3 passed** (1.6m) · exit 0 |
| fill bypassed (`const shown = program`) | **1 failed** at the assertion, `:121` · exit 1 |

The control is the half that matters: this lane has shipped a regression test that ran 8-of-8 green
under the very regression it claimed to guard, so a spec is not finished until it has been seen to
fail. `builder-review.tsx` was restored from a backup immediately after and the tree confirmed clean —
that sabotage must never reach a commit.

## ⚠ A failing spec's `error-context.md` snapshot is captured AFTER teardown, not at the failure

The first run timed out on the extra `Next`, and `error-context.md`'s page snapshot showed the bare
`/program` screen **with the wizard gone** — which reads exactly like a Radix sheet being dismissed
mid-run, a completely different bug. It is wrong. The **trace** shows every action up to the final
click succeeding, and its frame snapshots contain both the `Generate Program` button and step 10's
rotation UI, so the wizard was open and on the right step the whole time. Reading that snapshot as the
failure state would have meant hunting a dismiss that never happened.

**The trace is the authority; the context summary beside it is not.** Same lesson as the same day's
shard-4 hunt, one level down: there, `get_job_logs`'s tail was Postgres teardown and the answer was in
the report artifact's `errors[]`.

## Not exercised

- **The save path end to end.** Deliberate, per the reasoning above.
- **`ai` mode's own row.** The goal-range line has no coverage here; it is a different assertion and
  this spec would have to stop asserting the style to make it.
- **The device.** Nothing here ships to the APK.

<a id="2026-09-29-chore-or115-admin-control-inventory"></a>

# 2026-09-29 — OR-115: the admin inventory exists, and it moved the entry to the owner

**Branch:** `chore/or115-admin-control-inventory` · docs-only. No product change, no version bump.

OR-115 asked for the admin surface to be reorganised "to only use what we actually need", and its own
rule is **do not start by deleting**: the useful axis is how often the owner reaches for each control,
which is not visible from the code, so the inventory comes first and the keep/hide/delete call is his.
`OR-182` had already removed its `Gate: owner` on the grounds that it was gated on *our* work — the
inventory did not exist. It does now: [`docs/admin-control-inventory.md`](../admin-control-inventory.md).

## Three findings, each of which changes how the entry reads

**① "The admin section" is two screens, and the one the entry is about is the other one.**
`/admin` is admin-gated with six tabs (users · invites · exercises · activities · feedback · devices).
`/more/settings/developer` holds three diagnostic rows **and six bare maintenance cards** — the
backfills, the unit correction, the export. Those six are the accretion OR-115 describes, and a search
of `/admin` finds none of them. The split is deliberate and documented in `developer-content.tsx`
(`Q-531`/`Q-234`: a drain or re-sync is destructive in the wrong hands and access control outranks the
taxonomy, with an explicit *"Do not re-add a device row to this screen"*). Nothing here undoes it.

**② Nothing is unreachable, so *delete* is never justified on dead-code grounds.** All 19 components
in `components/admin/` resolve from a live import, checked by **export name** across `app/`,
`components/` and `lib/`. That makes this a *too many live controls* problem, which supports the
entry's do-not-delete rule rather than giving a reason to override it.

⚠ **And the first check was wrong in the direction that would have deleted something.** A path-shaped
grep for `admin/<file>` reported `hr-backfill-card.tsx` as **NOT IMPORTED ANYWHERE** — 68 lines that
looked like dead admin code. It is the shared base that both `set-hr-backfill-card` and
`workout-hr-backfill-card` import as `./hr-backfill-card`, and a relative import has no `admin/` in it.
**OR-187 for the third time this session: a grep is a candidate, never a conclusion.** The inventory's
reachability column is by export name and says so, so nobody re-derives it from a path grep.

**③ Two cards say "One-off admin utility" in their own header and are not.**
`set-hr-backfill-card`'s body: re-running it *"is the remedy whenever a workout ends without its recap
being viewed"*, because HR attribution only runs from the recap fetch. That is a standing remedy for a
live gap, not a migration — and it is exactly the sort of control the entry warns about, where rarity
is not disuse. Read the body, not the label; the label is worth fixing.

## What the code can and cannot answer

Usage frequency is not measured and is not guessed. What the code does answer is each control's
**nature**, which is what makes a recommendation arguable: **diagnostic** (reads only), **remedy**
(writes, re-runnable, needed whenever a condition recurs), **one-off correction** (writes once against
historical rows). Only the third is a hide candidate, and `exercise-unit-fix` is the one clear member.

The strongest single row is **model assets**: it answers whether the eight ONNX models are really in
object storage or whether the repo-tree fallback is quietly carrying production — and `getSession`
falls back **silently**. Keep, and never hide deeply; it is the only signal there is.

## What shipped, and where it went

The entry is **re-laned `Lane: O`, ungated**, with an `Ask: owner:` naming the six rows and linking
§A of the inventory. Ungated on purpose — `Gate:` would park it, and per CLAUDE.md getting the answer
is the Orchestrator's work, not owner debt. `next-item.js --lane O` now lists it under *waiting on the
owner*; Lane B's READY dropped to one (`Q-231`).

⚠ **`Ask:` takes only `owner` as its value** — `check-backlog-pointers.js` rejected `Ask: one pass
over…` and the correct form is `Ask: owner: <text>`, as `LA-173` already had it. Caught by running the
checker and **reading its exit code directly rather than through a pipe**, which is this lane's own
standing lesson.

The implementation half comes back to Lane B once he answers: group those six cards under headings,
following `/admin/oura-ble`'s six numbered `ConsoleSection`s with their `when=` lines — the pattern the
owner already called *"works but could be labeled better"*.

## Deliberately not settled

- **Usage frequency** — not visible in code, not measured, not guessed.
- **Whether `exercise-manager` (764 lines, the densest control cluster on either screen) should be
  split.** A structural call and mine to make, but out of OR-115's scope, so not made here.
- **The `/admin/oura-ble` labels** — the owner's "could be labeled better" is a separate open thread.
- **`/admin/cadence` and `/admin/data-capture`** — single-purpose pages reached from one row each,
  neither showing accretion, so neither itemised.
- **Nothing was hidden or deleted.** That is the point: this PR is the list.

One ordering constraint recorded so a later tidy-up cannot break it: `/admin/oura-ble` step 1's two
cards read the server only, deliberately, because *"a full disk is most likely exactly when the APK
cannot be opened."* Do not fold them into a later section for tidiness.

<a id="2026-09-29-chore-q231-exercise-detected-card"></a>

# 2026-09-29 — Q-231: the card stays, the Oura plumbing goes

**Branch:** `chore/q231-exercise-detected-card` · v1.485.2.

Q-231 was owner-approved, re-sequenced by Lane A the day before, and told this lane to **remove the
"Exercise detected" card**. It should not be removed, and the entry's own reasoning is what showed it.

## The owner's yes was conditional, and the condition does not hold

His words: *"If its not being used because we don't use the oura sync then get rid of it."* The entry
then argued the condition was satisfied — *"retiring this card removes nothing he currently sees
working"* — on the basis that the card reads `oura_workouts`, written only by the retired Oura Cloud
sync, while the live auto-detection he sees writes `activity_logs` from the BLE classifier.

Two pipelines, correctly separated. **There is a third.** `pendingSessions` — the list this card
renders — has a second writer that has nothing to do with the Cloud sync:

- `AutoDetectionProvider` is mounted in **`app/layout.tsx:188`**, the root layout, on every route.
- It calls `startAutoDetection()` **unconditionally on native**. Nothing gates it; there is no setting.
- `endSession()` turns a session passing the distance / pace / motorised-P80 gates into a
  `pendingSessions` entry. `inflight-teardown.test.ts` calls that entry *"the popup"* outright.
- **`ExerciseDetectedCard` is the only surface that renders one.** `exercise-review-sheet.tsx` resolves
  a session by id, and that id comes only from this card's `onReview(session.id)`.

So removing the card would have orphaned the live phone detector **silently** — no compile error, no
failing test anywhere in the suite. The walk would be detected, finalised, stored, and never shown.

## What shipped instead

His instruction, executed faithfully once the premise is corrected: **the Cloud plumbing goes, the card
stays.** This is not a new product decision — the Oura half is genuinely unusable (`upsertOuraWorkouts`
is not merely callerless, it no longer exists in the repo, so `oura_workouts` cannot gain a row), and
the half he can still see working is untouched.

- **Card** (128 → 85 lines): the `oura-unreviewed-workouts` fetch, the ingest effect,
  `markReviewedOnServer`, and its `invalidateOuraWorkoutReview` calls. Dismissal is now purely local,
  which is all a phone session ever needed.
- **Review sheet** (352 → 317): both `source === 'oura'` PATCH branches, the
  phone-saves-overlapping-Oura sweep, the *"Route not available — phone wasn't tracking"* branch, and
  its two `invalidateOuraWorkoutReview` pairings.
- **Store**: `addOuraSession` removed, `source` narrowed to `'phone'`. The union is kept at one member
  rather than deleted because **the store is persisted** — and a session stamped `'oura'` before the
  change is now dropped in `onRehydrateStorage` rather than left to render as a route-less phone
  session that nothing can mark reviewed.

Lane A's half is unchanged and now safe to take: the route, the `day-timeline` filters, `OuraWorkout`,
and `invalidateOuraWorkoutReview` (callerless as of this PR). **`repo.getOuraWorkouts` still must
survive** — `compute-hr-recovery-profile.ts` reads the frozen rows as HR-recovery anchors.

## Guarded, and control-run

`q231-detected-card-is-the-phone-surface.test.ts`, 6 tests: the provider is mounted in the root layout,
the store still finalises a phone session, the card renders `pendingSessions`, the banner stack mounts
it, the sheet reaches a session only by the card's id, and the Cloud plumbing is absent.

**Control:** removing the mount fails the test named *"removing it orphans the phone detector"*. Mount
restored, tree verified clean.

⚠ Its Cloud-absence assertions match **code, not mentions**. The first version failed on the card's own
new docstring explaining what had been removed — the exact false positive `scripts/lib/strip-comments.js`
exists for, hit inside a test written the same hour.

`LB-132`'s source guard needed its two patterns narrowing: it pins the literal invalidation pairing in
the review sheet, and `invalidateOuraWorkoutReview` left both sides. The rule it protects is unchanged —
revalidate on the far side of the push, still invalidate immediately for the writing device offline.

## Verified

`npx tsc --noEmit` · `pnpm check:rules` **Ran 84 of 84** · `pnpm lint` 0 errors · `pnpm test`
**11,038 passed** · `check-test-typecheck` at baseline.

## Not exercised

- **The device.** The phone detector needs GPS, a real walk and the APK; `getLocalStore` is null in a
  browser. What is proven here is that the render path and its only surface survive, by source guard and
  by the full suite — not that a walk end-to-end still raises the card on the S25.
- **The rehydrate filter against a real persisted `'oura'` session.** Asserted at source; no device has
  been checked for one.
- **Whether any of the 13 frozen rows were still unreviewed.** If so, the card stops offering them —
  which is the point of the change, but it means a card he may occasionally have seen will not return.

<a id="2026-09-29-data-la177-backfill-styleless-slots"></a>

# 2026-09-29 — LA-177: the nine styleless slots in the active program get their role's style

**Lane A · migration `202609290751_backfill_styleless_active_slots.sql` · production backfill
(authorised policy: ADD/backfill, with a verified snapshot and a count guard).**

- **Rule:** each `style_id IS NULL` slot in an ACTIVE program takes the style its ROLE uses most in
  that same program. A tie is broken by style name; a role with no styled slot is left alone, not
  guessed; inactive programs are out of scope. It is safe to re-run (the second run touches 0) and
  raises if the rows touched differ from the rows predicted.
- **On the owner's data** (fresh production snapshot of users, programs, program_sessions,
  session_exercises and progression_styles, restored locally with every count matching the
  manifest), applied through `scripts/local-db/migrate.js`: **9 rows, as predicted.**
  - The primary, Barbell Hip Thrust, gets Powerbuilding.
  - The secondary, Dumbbell Bulgarian Split Squat, gets Hypertrophy Plus.
  - The seven accessories get Hypertrophy 3-set: Cable Lying Leg Curl, Dumbbell Calf Raise, Cable
    Seated Leg Curl, Hanging Leg Raise, Face Pull, Cable Chest Dips and Barbell Skull Crusher.
  - Active styleless slots go 9 → 0; the inactive `Main`'s 5 are untouched.
- **Why now:** LB-186 made the editor and builder default a style, so the gap cannot re-open. This
  un-deads Lower's Full toggle (BF-198's rules revert skips a styleless slot) and gives Skull Crusher
  a per-set plan (TN-75 ①).
- **Supersedes LA-182**, which had asked the owner to assign the nine by hand.
- **Tests:** `la177-backfill-styleless-slots.test.ts`, covering majority by role, tie by name, the
  unlearnable role left null, inactive untouched, an already-styled slot untouched, and a second run
  as a no-op.
- **✅ Verified in production 2026-09-29:** migration applied at 11:43:24 UTC; the active program holds **0** styleless slots, and Lower reads primary → Powerbuilding, secondary → Hypertrophy Plus, accessories → Hypertrophy 3-set, as predicted.

<a id="2026-09-29-docs-bf199-rules-prescription-plan"></a>

# 2026-09-29 — BF-199 planned: the prescription's numbers from rules, the model kept for the prose

**Lane A · docs-only planning PR.**

- **Plan:** `docs/superpowers/plans/2026-09-29-rules-prescription-engine.md`. Three phases, each
  shippable alone:
  - `BF-199`: shadow the existing `buildRulesPrescription` beside every model call and measure,
    including how often the model's phase survives reconciliation, which nobody has measured.
  - `BF-199b` (`Needs: BF-199, BF-201`): rules own sets, reps, pct and rest; the prose call becomes
    non-blocking.
  - `BF-199c`: represcribe on the device with no round trip.
- **Why this shape:** the rules prescriber already exists (it is the model-failure fallback and
  BF-198's Full revert). Sets are already the budget fitter's (2 in all 33 stored tuples),
  reps/pct already follow a curve, and rest is the only free model output and the noisy one (23
  values from 68 to 300 s).
- **Deliberately not decided:** the rep→%1RM table's values. That is calibration, with Tuning under
  BF-201 decision 2; the plan recommends the observed curve so day one changes nothing.

<a id="2026-09-29-docs-la169-already-built"></a>

# 2026-09-29 — LA-169 closed: bodyweight exercises already get a reps-only plan

**Lane A · investigation, docs-only.**

- **The owner's answer (2026-09-28):** prescribe REPS on bodyweight movements, record them as the
  plan, and leave `planned_pct` empty.
- **That is already what the app does.** `resolveBodyweightStyle` (`packages/shared/src/1rm.ts`)
  rescales a bodyweight style's reps from the stored rep max, and `log-exercise.ts:263-264` records
  `planned_reps` from the style while leaving `planned_pct` undefined for `exercise_type =
  'bodyweight'`.
- **Measured in production, September:** 27 bodyweight sets, **23 with `planned_reps`**:

  | Exercise | Sets | Planned |
  |---|---:|---:|
  | Hanging Leg Raise | 14 | 12 |
  | Pull-Up | 7 | 6 |
  | Chin-Up | 6 | 5 |

  **All 4 without a plan are the 09-07→09-12 calibration round**, single AMRAP sets with no plan
  by design. TN-75 now marks new calibration sessions `phase_type = 'baseline'`.
- **So the "23 of 49 unplanned sets are bodyweight" figure was a measurement artefact:** it counted
  a NULL `planned_pct` as "no plan", and for bodyweight that column is empty by design. **Tuning:
  measure bodyweight adherence on `planned_reps`, not `planned_pct`.**
- **No code change and no migration.** LA-169 leaves the queue.

<a id="2026-09-29-docs-lb152-reopen-accent-token-retune"></a>

# LB-152 — the answered question rests on a false premise, so it goes back

**Branch:** `docs/lb152-reopen-accent-token-retune` · docs-only, no version bump

LB-152 was Lane B's queue head with its gate cleared: the owner answered on 2026-09-26 with option
**(b)** — retune `--accent-green` / `--destructive` to today's `#22c55e` / `#ef4444`, then migrate the
literal sites onto them — and set the test as *"the app's appearance must not change at any point."*

**Measuring before building is what stopped it.**

## The entry counted one side of the change

It counted the **literal** sites and never counted the sites already on the token. The app is
dark-only (`forcedTheme="dark"` in `app/layout.tsx`), so the live values are the `.dark` block's:

| token | live value | proposed |
|---|---|---|
| `--accent-green` | `oklch(0.84 0.22 145)` = `rgb(86,238,102)` | `#22c55e` = `rgb(34,197,94)` |
| `--destructive` | `oklch(0.704 0.191 22.216)` = `rgb(255,100,103)` | `#ef4444` = `rgb(239,68,68)` |

The oklch→sRGB conversions were computed rather than taken from the entry, and they match it, so the
entry's colour facts are right. What is wrong is the blast radius:

- **62** uses of `var(--accent-green)` across **30** files — Home, Health, Nutrition, Workout, Cardio,
  Coach, More.
- **10** uses of `var(--destructive)` plus **140** `bg-/text-/border-destructive` classes across **58**
  files — every destructive button, error line and delete affordance in the app.

So **(b) repaints about 212 readings and (a) repaints 14.** Option (b) is the larger visual change by
an order of magnitude, and it was put to the owner as the no-op.

## What shipped

No code. The entry is amended with the measurement, **re-laned `Lane: O`, ungated**, and moved to
rank 3 of the Orchestrator queue — per CLAUDE.md, an owner question is a task, `Gate:` would park it,
and getting the answer is the Orchestrator's work. The decision brief is written into the entry
rather than into a chat reply, so it outlives this session.

A decision page is committed at
[`docs/design/2026-09-29-accent-token-retune.html`](../design/2026-09-29-accent-token-retune.html)
([hosted](https://claude.ai/artifact/YHV4gt6F5Lxut3q8cp4zKp)) — both candidates on the app's real dark
surfaces at 384 px, using the actual `--background` / `--card` / `--muted` tokens, with the counts
beside them. Reversal here can only be judged by looking at a screen, which is the argument for a
picture rather than a paragraph.

**Recommendation recorded: (a), migrate to the token** — same one-source benefit for a fifteenth of
the change, it keeps the design system's own values instead of the drifted copies, and every
component written in recent months already renders the bright token. **(b) remains right if he
actively prefers the mid green and red**; that is a real preference and only he can hold it.

## Verified

- `check-backlog-pointers` **530 entries**, no duplicates, all tagged — and the count was compared
  against the pre-change tree, because a move that silently drops an entry looks identical to a
  clean one. `next-item.js` puts LB-152 at **O rank 3** and off Lane B's list.
- `check-doc-links` OK.

## Not exercised

- **Nothing was built,** so there is no runtime claim to make. The counts come from `grep` over
  `app/**` and `components/**` excluding the `globals.css` definitions; a site that composes the
  token name dynamically would not be caught, and none was found.
- **The device.** The decision page is a sandbox render at 384 px, not the S25. The colours are the
  app's own token values, but a judgement about how they read on his screen is his to make there.

<a id="2026-09-29-docs-lb157-header-date-mockup"></a>

# LB-157 — the answer was given; the mockup it owed was not

**Branch:** `docs/lb157-header-date-mockup` · docs-only, no version bump

LB-157 came up as Lane B's queue head with its question answered: the owner chose on 2026-09-26 that
**the date goes on its own line**, and kept the battery chips on Home deliberately. Its last bullet
also said a mockup of the chosen option was owed before it was built — the large-UI rule, because a
two-line header visibly rearranges a screen he reads daily.

**That mockup had not been drawn, so it is what this PR delivers.** No code.

## And the answer leaves two placements

His words: *"The weather and battery chips keep the header row; the date moves below it."* The
entry's own recommendation, three bullets down: *"put the date on its own line **above** the chips."*
Those are different layouts, and the difference is visible. Drawn side by side at 412 dp rather than
guessed:

- **A** — chips keep the header row, date below them. His literal wording, and the default if he
  would rather not think about it.
- **B** — date first, chips under it. Reads top-down as date → conditions → greeting.

Both cost the same ~18 px of vertical space and both stop the row depending on the weather chip's
width, which is the property that matters: the entry is explicit that *"a fix that leaves the row
width-critical is not this decision"*. So the choice is preference, not engineering.

[`docs/design/2026-09-29-home-header-date-line.html`](../design/2026-09-29-home-header-date-line.html)
([hosted](https://claude.ai/artifact/5rLHxLdX9RJM16GuveofDb)) draws today's clipped row alongside both,
with the measured widths under them.

## `Gate: owner` is now correct, and was correctly absent before

The entry said `Gate:` was *"deliberately absent so it prints as READY and someone puts it to him"* —
right for a question nobody had asked yet, since a gate parks an entry where no one is assigned to
it. Now that the mockup exists, the entry is blocked pending an answer already sought, which is
exactly what a gate is for. It carries `Gate: owner` and has left the READY list.

## Verified

- `check-backlog-pointers` **529 entries**, no duplicates, all tagged; `next-item.js --lane B` no
  longer lists LB-157, which is the point of the gate.
- `check-doc-links` OK. Nothing else to run — no code changed.

## Not exercised

- **Nothing was built.** The panes are drawn from the app's own dark tokens at 412 dp, not
  screenshotted: the seeded database has no weather snapshot, so `WeatherChip` renders a 56 px
  skeleton and the real three-chip row cannot be reproduced in the sandbox. The chip widths come from
  the 2026-09-12 device measurements; the row width, the gap and the date formats were re-measured on
  2026-09-25 and agree to 0.1 px.
- **The device.** How the two-line header actually reads on the S25 is his to judge there.

<a id="2026-09-29-feat-bf15-recommend-added-exercise-role"></a>

# BF-15 — a named exercise now starts on a role, and never on Primary

**Branch:** `feat/bf15-recommend-added-exercise-role` · **Version:** 1.485.1

The owner's report: *"some 'isolation' type work will increase to a main level when it should be
accessory sort of — like bicep curls."* Lane A fixed the fallback on 2026-09-28 (a missing role
defaults to `accessory`, and a test fails on any `?? 'primary'`). What was left was to
**recommend** one rather than leave every new exercise on the fallback.

## The entry says "when an exercise is added". It cannot be then.

`addExercise` appends an **empty** slot — `{ key, name: "", styleId }`. Nothing is known about it,
and `recommendAddedExerciseRole` reads the catalogue's muscle count. So the role is recommended in
`selectExerciseName`, the single funnel both the picker and free-text entry already pass through,
where the catalogue `match` is in hand.

This is the same shape as `LB-186` on this very file: an entry naming the add path for a decision
the add path cannot make.

## Two rules, both asserted

- **Never over a role the lifter chose.** Renaming an exercise that already carries a role leaves it
  alone — the recommendation is a starting pill, not a correction.
- **Nothing for a name the catalogue does not hold.** There is no muscle count to reason from, the
  engine's `accessory` default already covers it, and guessing would be a number invented rather
  than read.

## The size gate forced a better shape

`program-editor-sheet.tsx` is a shrink-only hotspot at a 963-line allowance, and the first draft
took it to 973. Rather than golf the comments down, I took the extraction the checker actually asks
for: `musclesForSelectedExercise` moves the main/secondary/muscleGroups mapping into the same helper
module as the role, since both are computed from the same `match` for the same reason. **The file
landed at 961 — one line below `main`**, and the two pure functions are now testable together.

## Verified

- `bf15-recommended-exercise-role.test.ts` — **10 tests**, including the defect asserted directly
  (no muscle count produces `primary`), the single-muscle bicep-curl case, secondary slots filling
  up, a chosen role surviving a rename, and the slot being named excluded from its own count.
- `e2e/lb186-new-exercise-has-a-style.spec.ts` — **3 passing**; it drives this editor's add path,
  which is the surface the change sits on.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **9,551 passed** · `pnpm build`.

## Not exercised

- **The pill rendering pre-selected.** The e2e covers the add path but not the role pill's state
  after naming; the ten unit tests own the decision and the component wiring is a single call.
- **The whole-session rule** remains deliberately unbuilt — see the 2026-09-28 entry. It scored 87%
  against the owner's sessions, below its own 90% bar, by anchoring Legs on the hip thrust over the
  squat, and nothing in the catalogue separates those two.
- **The device.** No native, safe-area or gesture change.

<a id="2026-09-29-feat-bf199-prescription-shadow"></a>

# 2026-09-29 — BF-199 Phase 1: every model prescription is recorded beside the rules prescriber's

**Lane A · migration `202609291131_prescription_shadow.sql` (new table) · `claude_ro` view regenerated.**

- **What:** `packages/shared/src/ai-periodization/prescription-shadow.ts` →
  `buildPrescriptionShadow`. `generatePrescriptionForSession` captures the model's raw phase and
  action before reconciliation, and after `storePrescription` writes one `prescription_shadow` row
  pairing each given exercise with `buildRulesPrescription`'s, by id. It is best-effort (an async
  wrapper with a catch), so it can never cost a plan. It is excluded from the user data export as
  ops evidence, like `ai_call_log`.
- **First real sample** (`pnpm dev`, owner snapshot, Push, one real model call): rest 209 / 141 /
  97 / 113 s given against the style's 120 / 75 / 60; the rules path had nothing for the styleless
  Cable Chest Dips; and **the model's prose said it had excluded Dumbbell Fly while its numbers
  included it**.
- **Tests:** a builder unit test, a real-Postgres write test, the prescription suites (173), the
  claude_ro role and snapshot suites (34 run, none skipped), the views-file test, the
  test-typecheck, and Custom Rules.
- **Owed:** the two-week read (BF-199 `Keep:`), from 2026-10-13, which unblocks BF-199b.

<a id="2026-09-29-feat-cardio-walk-satisfies-prescription"></a>

# RV-166 — a walk can finish the day's prescribed run, and the card says what counts

**Branch:** `feat/cardio-walk-satisfies-prescription` · **Version:** 1.482.0

In production, `prescribed_runs` held **26 rows: 0 completed, 0 with an `activity_log_id`** — no
prescribed run had ever been marked done, although 17 of the 22 pending days and 3 of the 4 skipped
ones had a walk, treadmill session or run logged on the day. The owner walks.

## The entry said the root cause was two lines. It was two lines and a dead end.

Both call sites in `done-activity-screen.tsx` did gate on `activityType === 'run' && prescribedRunId`,
and dropping the type half is correct. But **removing it alone changes nothing**, because the only
writer of `prescribedRunId` is `running-plan-content.tsx`'s `onStart`, which calls
`startActivity('run', …)` first. The id is never set on a walk, so the second half of the guard was
already false. The missing piece was never the guard — it was that **there was no way to start a walk
from the prescription at all.**

## What shipped

- **`components/cardio/todays-cardio-card.tsx`** — the card the mockup approved on 2026-09-27
  ([`docs/design/2026-09-27-four-screen-mockups.html`](../design/2026-09-27-four-screen-mockups.html),
  sections RV-166 and RV-166b), above the modality picker and never instead of it. It states the
  criterion in zone terms with live progress, and `Walk it` opens the two routes.
- **`components/cardio/todays-cardio-copy.ts`** — the wording and the arithmetic, pure and tested:
  the zone label, the criterion, the status, and `countedProgress`.
- **`lib/activity/link-prescribed-run.ts`** — extracted from the done screen, because two save paths
  now complete a prescription and a second copy is a walk that counts on one screen and not the
  other. `completedAs` is a **required** parameter: the server writes null on any status change that
  does not say otherwise, and `completedAsRun()` reads null as a run, so a silent walk would switch
  off the next quality session and put walking pace into easy-run stats (LB-179).
- **`lib/stores/activity-store.ts`** — `logCompletedActivity`, which arms a session as already
  finished so the treadmill route lands on the existing done screen with the minutes filled in.

## The decision worth recording: no third writer

The mockup's *"treadmill walk — just log it"* has no existing home. There is no manual duration-log
path in the app: `LogActivitySheet` is a type picker that starts the live timer, and the guided walk
builds an **interval** plan, so routing plain minutes through it would fabricate an interval walk and
title it one. A new writer was the obvious third option and is the one the rules forbid — the
offline-first local-store + outbox contract is already written twice, and a third copy is the
"my data disappeared" bug class.

So the treadmill route **arms the session as finished and reuses the one writer**: `Walk it` → a
duration chip → the done screen, prefilled, with Save. Three taps rather than two, and the owner sees
what is about to be logged. `done-activity-screen` remains the only place a walk's activity log is
written.

## Stored numbers do not move

The entry warned that this changes what counts as a completed session, so adherence, streaks and
compliance shift. **That applies to a backfill, and there is no backfill here.** The 20 past days
with a walk logged stay `pending`; only walks completed from the card going forward link. Backfilling
them is a separate decision under the history policy and is deliberately not taken.

## Verified

- `e2e/rv166-todays-cardio-card.spec.ts` — **3 tests, all passing** at the 412 px dark viewport
  against the real component, with the prescription injected (the seed user has no running plan, so
  every assertion would otherwise pass vacuously against the very empty hub this change fixes).
  All three failed on the first run, on locator ambiguity with the hub's own "Guided walk" button and
  its "What do you want to do?" heading — which is what made the card a labelled landmark.
- The source guard in `rv166-todays-cardio.test.ts` was **proved able to fail**: run against
  `origin/main`'s copy of the done screen it matches the forbidden guard and finds 3 link calls with
  no `completedAs`.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **952 files, 9,496 passed** · `pnpm build`.
- `check-zero-arg-mock-indexed` caught a genuine TS2493 in the new test — the Build job would have
  found it after the merge.

## Not exercised

- **The completion itself, end to end.** `getLocalStore` returns null in the browser, so the local
  write, the outbox mutation and the pull-back never run here. The payload contract is unit-tested
  (`rv166-link-prescribed-run.test.ts`, 5 tests) and the **device pass is owed** — the entry keeps a
  `Keep:` line for it.
- **The estimated path on real data.** A treadmill walk with no heart rate counts from its logged
  minutes; the sandbox has no such row.
- **The device.** No native, safe-area or gesture change, but the card is new furniture on a screen
  the owner opens daily, and the Coach button overlaps content at the bottom of the hub the way
  BF-206 describes for Home.

<a id="2026-09-29-feat-la172-plan-meal-type-from-time"></a>

# 2026-09-29 — LA-172: a plan meal gets a meal type by its time, unless it is tagged

**Lane A · `packages/shared/src/nutrition/meal-type-for-time.ts`, `lib/data/postgres/slices/meal-plans.ts`,
migration `202609290804_plan_meal_type_from_suggested_time.sql` (backfill, standing policy).**

- **The owner's answer:** *"Give it a type by its time; as well as what its tagged with."* A plan
  meal's type is now **tag → the window containing its suggested time → the NEAREST window**.
  - It is applied on plan create and structure replace, and when an untyped meal's time is edited.
  - A stored type is never overridden, because it may be his tag.
- **Why "nearest" and not "none":** his real meal-type hours have gaps (6-10, 10-12, 12-15, 18-21), so
  a strict window match left 4 of his 8 meals untyped (16:20, 21:00), which is not "a type by its
  time". The logging path's first-bucket fallback would have filed a 21:00 snack as breakfast.
- **One rule, both sides:** `planMealTypeId` in a dependency-free module (the server cannot import
  `log-plan-meal.ts`, which pulls in the local store); the migration's SQL implements the same
  ordering. `listMealTypes` gained a `created_at` tie-break so the list order is the one the SQL
  uses.
- **On the owner's data** (fresh production snapshot, restored with all counts matching, applied through
  the real runner), all 8 meals are typed:

  | Time | Meal | Type |
  |---|---|---|
  | 07:00 | Protein Shake + Rice thins | Pre Workout (Breakfast) |
  | 11:40 | Turkey and Rice Bowl | Post Workout (his own 10-12 window) |
  | 16:20 | Chicken and Sweet Potato | Lunch (nearest) |
  | 21:00 | Greek Yoghurt and Almonds | Dinner |

  The same four apply on both variants. **⚠ Those 8 belong to his only plan, which was soft-deleted
  on 2026-08-11**, so the backfill changes nothing he sees now; the create and edit paths are what
  his next plan uses.
- **Tests:** the rule (containing, gaps, exclusive end, tag, overlap tie, unreadable), and
  real-Postgres create/edit/backfill tests. The meal-plan suites pass (547 plus 119 route tests).
- **Unblocks BF-203a.** The plan screen showing "Lunch · …" is Lane B's.

<a id="2026-09-29-feat-la36-food-item-thumbnails"></a>

# LA-36 — the food pictures were on the device and nothing read them back

**Branch:** `feat/la36-food-item-thumbnails` · **Version:** 1.485.0

Lane A's half shipped on 2026-09-28: every local food read returns `imageDataUri`. Nothing rendered
it. `meal-card.tsx` passed **`thumbSrc={null}`** on every diary row, with a comment saying
*"`food_items` carries no image column, so today this is always the placeholder"* — stale since the
column shipped.

## What shipped

Four lines. `DiaryRow` takes the logged item's `imageDataUri` and passes it to the tile the
artboards already draw. Rows without a picture keep the placeholder, which is the point: BF-32's
rule is that the box is the always-present state, because a row without it makes the list read as
ragged.

No contract was widened. `MealThumb`'s docstring says its `<img>` needs no host exemption
**because** the source is a capped `data:` URI and *"do not widen `src` to accept a remote URL"* —
checked before using it: `food_items.image_data_uri` is a base64 thumbnail capped at
`FOOD_ITEM_IMAGE_MAX_BYTES` (16 KB), the same class as a saved meal's.

**Only the diary.** Search and recent-food rows render no tile today, so giving them one is a look
change to those lists rather than filling a box that already exists — and it is where the entry's
memory note bites (20 search rows at the cap is ~320 KB). Left alone deliberately.

## The test was vacuous twice before it was real

- First it patched `/api/nutrition/food-logs` — but that route answers the **array itself**, not an
  object wrapping it, so the overlay rewrote nothing.
- Fixing that revealed the real problem: **the seeded user has zero food logs today**, so both
  assertions were passing against an empty diary.

So the spec seeds its own row with `psql` — a food item carrying a pixel and a log for today,
removed in `afterAll` (verified: zero rows left). **And the control run is what makes it count:**
against `origin/main`'s `meal-card.tsx` the positive test fails, so it is testing the change rather
than the fixture.

## Verified

- `e2e/la36-food-item-thumbnail.spec.ts` — **2 tests** at 412 px dark: a pictured food renders its
  `data:` URI, and clearing the picture on that same proven row falls back to the tile.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **9,541 passed** · `pnpm build`.

## Not exercised

- **A real photo at the real cap.** The fixture is a 1×1 PNG; nothing here measures a 16 KB
  thumbnail's memory cost in a long list, and only the diary renders one.
- **The device.** No native change, but the pictures live in the device's SQLite and the sandbox
  reads them through the API instead — so this has never been drawn from the local store.
- **`LB-167` is still open** on whether the placeholder tile reads as a failed image. This change
  makes it appear less often where a picture exists; it does not answer that question.

<a id="2026-09-29-feat-lb95-personal-records-overview"></a>

# LB-95 — the one thing the app measured and gave no way to read

**Branch:** `feat/lb95-personal-records-overview` · **Version:** 1.484.0

Lane A built `GET /api/personal-records` on 2026-09-28. Re-verified against `main`: the route exists
and returns `{ records: [{ exerciseName, estimated1rm, achievedAt }] }` exactly as the entry
describes — every exercise, not filtered to the active program, newest first.

This is the surface: a **Lifting** section on More → Details, in the `readingGroups` shape the two
sections above it already use.

## The one real trap: `achievedAt` is an instant

The other readings on this screen carry a calendar day. A personal record carries the **instant** the
set was logged, so the day has to be resolved in the user's zone — `toISOString().slice(0, 10)` would
print the UTC day, which is yesterday for every record set before 10am here.

`personalRecordReadings` goes through `toAestDay(new Date(achievedAt), tz)`, and both the unit test
and the e2e pin the case that matters: **23:30Z on the 29th is already the 30th in Brisbane.** The
e2e asserts `2026-09-30` is present *and* `2026-09-29` is absent, so a UTC slice fails it rather than
passing by coincidence.

## Decisions

- **Its own section, not rows in the daily one** — the reason the tests-and-scans section states:
  each half has to render when the other has nothing.
- **Last on the screen**, because it is the only section that grows on its own. A new record appears
  the moment a set beats the old one; a scan or a test does not.
- **"estimated 1RM" on every row.** These are computed from a logged set through the 1RM formula and
  were never lifted at that weight. Printing a bare number would present a formula's output as a
  performance.
- **A record with no usable number is dropped**, not rendered as `NaN kg`.
- **`TTL_LONG` raw rather than a named constant.** The rule asks for one in `cache-ttl.ts` at two or
  more call sites; this has one, and inventing a constant would put a Lane A edit into a Lane B
  change for no freshness benefit.

## Cross-lane note

One additive line in `lib/cache-groups.ts` (Lane A's): `personal-records` joins
`invalidateWorkoutSummaries`, because a logged set can set a new record and without it the new
number waits out the key's TTL on the one screen that lists it. Same judgement as TN-46's two lines,
recorded for the same reason.

## Verified

- `components/more/details/__tests__/lb95-personal-records.test.ts` — **6 tests**, including the
  same instant resolving to different days in Brisbane and New York, the naive UTC slice asserted as
  the wrong answer, and the empty-group case the section's `null` return depends on.
- `e2e/lb95-personal-records-overview.spec.ts` — **2 tests** at 412 px dark against the real screen,
  payload injected (the seeded user has no record, and the section returns null with none, so every
  assertion would otherwise pass vacuously). Covers the rendered rows, the timezone case, and the
  section being absent when nothing is logged.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **9,528 passed** · `pnpm build`.
- Three date literals are exempted in `check-e2e-stub-dates.js` **with stated reasons**: a record's
  date is the instant it was set and nothing compares it to today, so both sides of the assertion are
  fixed — which is the one condition the rule allows.

## Not exercised

- **Real records.** The seeded user has none, so this has only been drawn against an injected
  payload; the exercise names and weights in it are fixtures.
- **The invalidation firing.** That a completed workout clears `personal-records` is asserted by the
  group's own test, not by observing a record appear after a set.
- **The device.** No native, safe-area or gesture change.

<a id="2026-09-29-feat-tn46-dose-vitals-overlay"></a>

# TN-46 — the overlay half: doses plotted against the vitals they move

**Branch:** `feat/tn46-dose-vitals-overlay` · **Version:** 1.483.0

The engine shipped on 2026-09-28 (Lane A): `GET /api/health/dose-vitals?days=60` joins vial-dosed
administrations to each night's resting HR and HRV beside **the baseline stored for that night**.
This is the Lane B half — the chart.

Re-verified against `main` before building: the route exists and returns exactly the payload the
entry describes, including `effectLookbackDays`.

## The lag rule is the design, not a caption

The measured effect peaks **2–4 days** after a dose, so the one thing this card must not do is
invite a same-day reading. That constraint shaped three decisions:

- `buildDoseVitalsSeries` marks a night `inEffectWindow` only from the day **after** a dose, out to
  `effectLookbackDays`. A night sharing its date with a dose is `dosedOn` and explicitly **not** in
  the window — asserted directly, because it is the assertion the whole entry rests on.
- The card says it in words: *"read the days after a ring rather than the ring itself"*.
- The copy states **2–4** literally rather than deriving it from `effectLookbackDays`. The first
  draft computed `lookback - 3`–`lookback - 1`, which happens to print 2–4 today and would have
  silently lied the moment the constant moved.

## Decisions

- **One metric at a time, not two y-axes.** Resting HR is bpm and HRV is ms; a dual axis at 384 px
  invites reading a crossing as a relationship. A toggle instead, following `sleep-trend-toggle-card`.
- **Doses are rings on the metric line**, not a separate series — they mark *when*, and the eye then
  follows the days after them, which is where the effect is.
- **Hosted on Readiness**, in its existing `extraCards` slot: resting HR and HRV are readiness
  inputs, so the overlay sits beside the score they feed rather than on a screen of its own.
- **Absent rather than empty.** With no vial-dosed log in the window there is nothing to annotate,
  and a card saying so is noise on a screen the owner opens daily. It renders `null`.
- **Annotates, never corrects** — the owner's decision, unchanged. Nothing here feeds a score and no
  threshold is tuned against the dosing period.

## Two bugs caught before they shipped

- **The dose list trusted the route's ordering.** `slice(-3).reverse()` rendered oldest-first
  depending on how the route happened to sort; the screenshot is what showed it. Now `latestDoses`
  sorts by date descending and copies before sorting, with a test that feeds it both orders.
- **The e2e hardcoded dates, and `check:rules` caught it.** The route's window is 60 days back from
  the *real* clock, so a pinned fixture drops out of it and the card silently stops rendering on a
  date nobody chose — the time-bomb class CLAUDE.md names. Every fixture date now derives from the
  seeded user's today.

## Verified

- `components/health/__tests__/tn46-dose-vitals-series.test.ts` — **8 tests**, including the dose
  day being excluded from its own effect window, the window ending exactly at the lookback, and a
  month-end walk (`2026-06-29` + 2) going through `shiftDateStr` rather than hand arithmetic.
- `e2e/tn46-dose-vitals-overlay.spec.ts` — **2 tests** at 412 px dark against the real component,
  payload injected (the seed user has no vial-dosed log, so every assertion would otherwise pass
  vacuously against the absence this fills). Covers the drawn card, the stated lag, the metric
  toggle, and the card being absent with no doses. Both rendered states screenshotted.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **956 files, 9,516 passed** · `pnpm build`.

## Cross-lane note

`lib/cache-groups.ts` is Lane A's file. The new key `dose-vitals:` needed registering in the two
groups whose writes change it — `invalidateSupplements` (a dose is logged) and `invalidateOuraSync`
(the nightly vitals) — so this PR adds two additive lines there. Recorded here and in the baton
rather than filed as a separate Lane A entry: `LB-156` was exactly that shape and cost the entry
several days for five one-line registrations.

## Not exercised

- **Real data.** The seeded user has no vial-dosed log, so the chart has only been drawn against an
  injected payload. The shapes in the screenshots are fixture sawtooth, not a real resting-HR trace.
- **The device.** No native, safe-area or gesture change, but this is a new card with a chart on a
  screen the owner reads daily, and `chart.js` rendering in the Samsung WebView is not exercised here.

<a id="2026-09-29-fix-bf222-prune-failures-to-error-events"></a>

# 2026-09-29 — BF-222: a failed sensor retention prune now leaves a row in `error_events`

**Lane A · `lib/data/postgres/slices/oura.ts`.**

- **Why:** the `oura_heartrate` (180 d) and `rr_intervals` (90 d) prunes are fire-and-forget on the
  write path and ended in `console.error`, i.e. stdout, which nothing reads. Neither has ever run,
  because both tables are still inside their horizon, so their first executions (~2026-10-15 and
  ~2026-12-19) would have failed invisibly.
- **Change:** `recordPruneFailure(db, table, err)` logs as before AND inserts an `error_events` row
  (`url = 'prune:<table>'`), which the session-start read already checks. It uses the slice's own
  handle, because `reportServerError` reaches the database via `@/lib/data`, which would be a cycle.
- **Tests:** a source guard that both prunes route through the helper, and a real-Postgres write of
  the row. The Oura-slice suites (147) and Custom Rules pass.
- **Owed (BF-222 `Keep:`):** confirm the first `rr_intervals` prune after 2026-10-15 (`min(at)` ≈ 90
  days).
- **The size read, recorded so the next session can diff it (BF-222's second point):** 261 MB total,
  93 MB index (2026-09-29); largest tables `oura_raw_samples` 76 MB, `error_events` 52 MB,
  `oura_heartrate` 38 MB, `rr_intervals` 31 MB; oldest `oura_heartrate` 2026-06-22, oldest
  `rr_intervals` 2026-07-17.

<a id="2026-09-29-fix-e2e-route-overlay-outlives-test"></a>

# 2026-09-29 — an e2e route overlay outliving its test took four runs red

**Branch:** `fix/e2e-route-overlay-outlives-test` · test infrastructure only, no product change, no
version bump.

## What was wrong

`E2E shard 4` concluded **failure** on four consecutive runs — `36594986970` (LA-36's predecessor
TN-32), `36598412525`, `36602819608` and `36604843800` — and three of those PRs merged anyway,
because `E2E` is advisory rather than required.

The shard's own summary is the part worth remembering: **`74 expected · 0 unexpected · flaky 0 ·
ok: true`, exit code 1**, under `1 error was not a part of any test`. No test failed. Playwright was
reporting a rejection raised *outside* any test, which is why the log names no spec and why the
failure reads as CI infrastructure.

The cause was in `tn32-heart-rate-graded-by-profile.spec.ts`. Its `/api/readiness-score` overlay
calls `await r.fetch()` inside the route handler — a real network round trip, taken deliberately,
because a thin `{ hrCurrent }` stub crashes that page. When the test ends with one of those requests
still in flight, Playwright rejects the pending call with `route.fetch: Test ended.` and attributes
it to the run rather than to a test.

## How it was found, and the wrong answer it was nearly attributed to

`get_job_logs` gives a log tail, and the tail of a failed shard is Postgres container teardown — the
error is thousands of lines upstream. The answer came from the **uploaded `playwright-report-4`
artifact**, fetched by the repository-scoped REST path `LB-149` already documents
(`/repos/<owner>/<repo>/actions/artifacts/<id>/zip`; the URL the run log prints is refused by the
sandbox proxy with a 403 that looks like an auth failure and is not). The report's `report.json`
carries the run-level `errors[]` array with the full call log and the `spec.ts:25` frame.

**This is not `LB-149`.** That entry is owed one more red E2E read through its repaired `dmesg`
branch, and this run did print the repaired line — *"no OOM kill in dmesg"* — but it is **not the
observation LB-149 is waiting for**: there was no browser death here. The browser was healthy, 74
tests passed, and there is no `chrome-headless-shell` crash stack. LB-149 stays open, untouched, and
still owes its own red run. Attributing this there would have closed it on the wrong evidence, which
is the failure mode its own entry warns about.

## The fix

`tolerateTestEnd(handler)` in `e2e/fixtures.ts` wraps a route callback and swallows **only** the
end-of-test rejections (`Test ended`, `Target page, context or browser has been closed`, `Request
context disposed`), rethrowing everything else — a handler that genuinely cannot serve its overlay
must still fail the test that depends on it, or a spec silently asserts against the real payload it
meant to replace.

Playwright's own hint is `page.unrouteAll({ behavior: 'ignoreErrors' })` before the test ends. That
was rejected: it is per-test and has to be remembered at every exit path including a failing
assertion. Catching at the source cannot be forgotten.

Applied to all **six** specs whose handlers do a real `route.fetch()` — the sibling-surface sweep,
since the other five are the same latent bug and four of them predate this session:
`tn32-heart-rate-graded-by-profile`, `la82-stand-in-hr-sources`, `rv72-progress-bars-composite`,
`score-gap-reason`, `deload-confirm-eviction`, `rv202-stale-numbers-are-labelled`. Each keeps its own
`fulfill` shape untouched — `rv202` preserves response headers via `{ response: res }` and that was
not going to change silently inside a CI fix.

`scripts/check-e2e-route-tolerance.js` holds it, registered in the Custom Rules job
(**`Ran 84 of 84`**). It was verified by restoring `origin/main`'s unwrapped spec and watching it
fail on both offending lines, not by trusting a green run. Scope is deliberately `route.fetch()`
only: there are **69** inline `page.route` handlers across 44 specs, and the 64 that merely `fulfill`
a literal body have never produced this in the suite's history. Wrapping all of them would be a large
diff for a failure that has not happened.

## Verified by a control pair, locally

Both specs, same command, same database, twice:

| tree | result |
|---|---|
| `origin/main`'s specs | `8 passed (1.7m)` · `1 error was not a part of any test` · **exit 1**, at `tn32-heart-rate-graded-by-profile.spec.ts:25` |
| with `tolerateTestEnd` | `8 passed (1.7m)` · **exit 0** |

So CI's signature reproduces locally and the fix removes it — the failure was never environmental.
Note what the control shows about the shape of this bug: **the test count is identical in both
columns.** Nothing about the suite's assertions changed; only the exit code did.

One process note that cost twenty minutes: `pkill -f 'playwright test'` matches nothing here, because
the running process is `cli.js test …`. A first run was believed killed, was not, and raced a second
against the same dev server and database until both were killed by PID — with `next-server` at 9.3 GB
RSS by then. Kill by PID, and confirm with `ps` rather than assuming the pattern matched.

## Also fixed: #1987's Build job

BF-15's own PR was red on **`Build`**, which *is* required — `check-test-typecheck.js` found one type
error in `bf15-recommended-exercise-role.test.ts`. The fixture declared `exerciseType: 'strength'`,
which is not in the union (`'weighted' | 'bodyweight'`), and an `as ExerciseLibraryEntry` cast on the
object literal kept the compiler quiet. **`npx tsc --noEmit` does not cover test files** — they are a
separate project, `tsconfig.tests.json`. The cast is gone as well as the value corrected, so the
fields are now checked where they are written. Ten tests still pass; none of them reads that field.

## Not exercised

- **The device.** Nothing here ships to the APK — test harness and CI only.
- **A full four-shard run.** The two specs are proven; that shard 4 is green *end to end* is what
  this branch's own CI run has to show. A local single-shard run was started and abandoned, because
  edits landing mid-run contaminate it.
- **The five specs that were not already failing.** They are the same shape and the same class, but
  only `tn32` had been observed leaking; the other five are fixed on the argument that the mechanism
  is identical, not on a reproduction of each.

<a id="2026-09-29-fix-la82-stand-in-hr-sources"></a>

# LA-82 — a stand-in heart-rate anchor read exactly like a real one

**Branch:** `fix/la82-stand-in-hr-sources` · **Version:** 1.484.2

Lane A's half shipped on 2026-09-28: `resolveHrProfile` guards all three of its reads, so a
transient fault no longer takes a screen down — it substitutes a value and **names the substitution
in the source field**. Nothing rendered those fields.

Re-verified against `main` before building, because TN-32 had just changed a neighbouring surface:
`observed-hr-card.tsx` still tested `=== "observed"` and printed everything else as
*"age-estimated"*, and the hub's heart card carried no source at all. Both claims held.

## What that meant

- `maxHrSource: 'estimated-age-unread'` is the **generic 190**, not 220 − age. For this owner that
  moves every zone boundary by 6 bpm, and it read identically to an estimate from a known age.
- `restingHrSource: 'unavailable'` (the read failed, 60 assumed) was indistinguishable from
  `'default'` (never measured) — and from a real measurement.

## What shipped

`components/health/hr-source-copy.ts` — one place both surfaces take their wording from, so they
cannot drift into describing the same provenance two ways:

| source | reads as | stand-in |
|---|---|---|
| `observed` | your recorded max | no |
| `estimated` | age-estimated | no |
| `estimated-age-unread` | **a stand-in**, with what it costs the zones | **yes** |
| resting `measured` | *(nothing said)* | — |
| resting `default` | assumed — wear your ring overnight | yes |
| resting `unavailable` | a stand-in — couldn't be read | yes |

Both stand-in lines end with *"zone boundaries are approximate until it loads"*, which is the part
the reader can act on, and a test asserts every stand-in carries it.

One judgement worth recording: **"Still learning your range" is suppressed while a stand-in shows.**
That line describes a profile being built; a value that could not be *read* is a different thing to
tell someone, and showing both at once says two contradictory things about the same number.

## Verified

- `la82-hr-source-copy.test.ts` — **6 tests**, including the age-unread/age-estimated split that is
  the defect, `default` and `unavailable` asserted to say different things, and both fields
  degrading quietly to "not a stand-in" on a payload cached before the route sent them.
- `e2e/la82-stand-in-hr-sources.spec.ts` — **3 tests** at 412 px dark against the real hub, which is
  the entry's own *Done when*: with the age unread the hub renders **and says the max is a
  stand-in**. Plus the failed-resting case suppressing "still learning", and a clean profile saying
  nothing, anchored on a positive assertion so it cannot pass vacuously.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **9,541 passed** · `pnpm build`.

## Not exercised

- **A real failed read.** The sources are injected; reproducing `getUserById` failing would need the
  database taken away mid-request, which the sandbox cannot do. The engine's own guards are Lane A's
  and already tested.
- **The device.** No native, safe-area or gesture change.

<a id="2026-09-29-fix-lb117-explain-sore-provenance"></a>

# LB-117 — the explain page said a muscle was sore beside a score that ignored it

**Branch:** `fix/lb117-explain-sore-provenance` · **Version:** 1.483.1

After BF-173, an accepted *suggestion* is listed as sore and does **not** lower the session score,
while a tick the lifter added does. The explain page showed both on one "Sore muscles" line, so it
could present a muscle as sore next to a recovery figure that had ignored it — the reads-as-broken
shape Q-105 exists to prevent, on the one page whose rule is to show the numbers the recommendation
was actually computed from.

## It was parked, and the block is genuinely gone

The entry carried `Needs: LB-118` and said plainly that it was *"NOT buildable in this lane yet"*.
Verified against the code rather than the queue: `adapter.ts` now returns
`signals.suggestedSoreMuscles` with LB-118's own comment, `NextSessionRecommendation['signals']`
carries the field, and `buildSessionExplainData` passes `signals` straight through. So the value is
already on the client — only the explain types and copy were missing it.

## What shipped

`soreRows(sore, suggested)` in `group-signals.ts` splits one row into two:

| | value | chip |
|---|---|---|
| **Sore muscles** | the lifter's own ticks | `lowered the score` (amber) |
| **Also sore** | the ones the app suggested | `already counted` (green) |

With every tick a suggestion there is no first row to be "also" to, so it keeps the primary label.
A suggestion the lifter later unticked never renders — `suggested` is what the app proposed, not
what survived.

**`suggested == null` falls back to today's single unchipped line.** That is the case worth stating:
the check-in predates provenance, and BF-173's rule is that absent means *unknown* and is scored the
old way. Reading it as "none were suggestions" would claim every tick lowered the score — a guess
dressed as an explanation, which is precisely what this page must not do.

## Lane note

`packages/shared/src/session-explain/**` is on Lane A's path list, but the lane **rule** — which
CLAUDE.md says is the authority over those lists — puts it in Lane B: nothing under `app/api/**`
imports it, and the explain data is built client-side in `app/session-explain/`. Claimed here and
recorded in the baton.

## Verified

- `packages/shared/src/session-explain/__tests__/lb117-sore-provenance.test.ts` — **6 tests**,
  including the null fallback for both `null` and `undefined`, the all-suggested case keeping the
  primary label, and an unticked suggestion not rendering.
- `e2e/lb117-explain-sore-provenance.spec.ts` — **2 tests** at 412 px dark against the real page,
  recommendation injected (`buildSessionExplainData` returns null without a scored ai_dynamic
  session, so every assertion would otherwise pass vacuously against the empty state). The signals
  area is collapsed by default, so each test opens it — which is what the first run found.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **956 files, 9,514 passed** · `pnpm build`. Screenshotted.

## Not exercised

- **Which muscle sits under which chip, through the DOM.** The value and its chip share one span, so
  a DOM assertion on the pairing is brittle; the six unit tests own that and the e2e proves the rows
  reach the screen. Stated in the spec's docstring rather than left implicit.
- **A real check-in.** The seeded user has no sore tick with recorded provenance, so this has only
  been drawn against an injected recommendation.
- **The device.** No native, safe-area or gesture change.

<a id="2026-09-29-fix-lb155-config-screen-bare-fetches"></a>

# LB-155 — three of the ten were a cache bug; six were never blocked on LB-156 at all

**Branch:** `fix/lb155-config-screen-bare-fetches` · **Version:** 1.482.2

LB-155 carried `Needs: LB-156` and read as "10 conversions, blocked on Lane A registering five cache
keys". LB-156 shipped on 2026-09-28. The keys are registered — verified in `cache-groups.ts` rather
than taken from the entry.

**Reading the ten sites is what showed that the group entries were necessary and nowhere near
sufficient.**

## What the ten actually are

| | sites | verdict |
|---|---|---|
| `config-screen.tsx` phase-set re-open + 2 × `workout-templates` post-write refetch | 3 | **converted** |
| `config-screen.tsx` `openPhaseSetEditor` | 1 | **authoritative** — a conversion would break it |
| `day-checkin` ×3, `plan-meal-answers` ×1 | 4 | local-store **fallbacks**, web-only path |
| `bedtime-estimate` ×2 | 2 | notification **schedulers** |

**Six of the ten will never convert as written**, and none of the six was waiting on a cache group.

## The three that converted were a live bug, not lint debt

`config-screen.tsx` **already** fetches `workout-templates` and `phase-sets` through `cachedFetch` at
`TTL_LONG` in `load()`. The three bare GETs were bypassing a cache the file owns: each set this
screen's React state and left the shared entry holding pre-write data for every other reader. So
after applying a workout review or saving from the builder, Config showed the new programs and
everything else kept the old list until its own TTL expired.

The two `workout-templates` refetches were the same three lines twice, so they collapsed into one
`refreshPrograms`. Both writers invalidate first, so the converted reads miss the cache and go to the
network exactly as before — and if a writer ever stops invalidating, the cached paint self-corrects
on revalidation instead of leaving the entry wrong indefinitely.

`config-screen.tsx` leaves the ratchet baseline entirely: **4 → 0**. Totals **62 → 59**, tracked
**17 → 13** across **14 → 13** files.

## The one that must not convert

`openPhaseSetEditor` needs the sets **in sequence** to build the editor state, and its own comment
says why: the editor saves over whatever it opened with, so a stale set wipes migration-added phases.
`cachedFetch` is callback-shaped, so the cached-then-fresh pair would open the editor on the stale
set and then reopen it. It joins `AUTHORITATIVE_READS` with that reason written out — the population
the script already models for exactly this.

## Why the other six are not debt

- **Four are local-store fallbacks.** `day-checkin` ×3 and `plan-meal-answers` sit behind
  `store.getDayCheckin(...)` / `store.getPlanMealAnswers(...)` and run only where `getLocalStore`
  returns null — the web/dev surface, never the APK. They are also one-shot decision reads ("open the
  check-in sheet or not"), which the cached-then-fresh callback pair does not fit.
- **Two are schedulers.** `day-review-reminders.ts` and `meal-reminders.ts` read `bedtime-estimate` to
  compute a notification time. `cachedFetch` fires `onData` twice on a stale entry, so the conversion
  schedules twice — and `freshWithinTtl` is disqualified because the payload derives from sleep rows
  the BLE rollup writes server-side, which is the same RV-67 failure that disqualified
  `readiness-score`.

Both findings are written into the entry so the next session gets a different question rather than a
retry.

## Verified

- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **955 files, 9,508 passed** · `pnpm build`.
- `e2e/lb186-new-exercise-has-a-style.spec.ts` — **3 passing**; it drives the program editor on this
  screen, which is the surface the converted reads feed.
- `check-component-size` — `config-screen.tsx` is a shrink-only hotspot; the change landed
  **net-neutral at 998 lines**, matching `origin/main`, after two rounds of trimming.

## Not exercised

- **The staleness this fixes, observed end to end.** Showing the old bug needs two screens reading
  `workout-templates` across a write; the unit suite covers the call shape and the e2e covers the
  editor, not the cross-screen staleness.
- **The device.** No native, safe-area or gesture change.

<a id="2026-09-29-fix-rv183-user-profile-fresh-within-ttl"></a>

# RV-183 — the last half, and the three writers found while proving it

**Branch:** `fix/rv183-user-profile-fresh-within-ttl` · **Version:** 1.482.1

RV-183's remaining item was one line: put `freshWithinTtl: true` on `more-user-profile` once `LB-180`
removed the `workoutCount` derivation from `/api/user/profile`. LB-180 has shipped — the route is a
pure read of one users row and `user-account-routes.test.ts` asserts the field is gone.

**The entry said "its proof is otherwise complete now — the writer gap is closed". That was wrong,
and writing the proof out is what showed it.**

## Three writers of the users row that cleared nothing

The payload spreads the **whole** users row, so every one of the eleven `update(s.users)` sites is a
writer of this key. Nine were covered. Three were not, each updating local state and nothing else:

| Writer | Column | Why it hid |
|---|---|---|
| `handleGoalsRemindLater` (`session-select-content.tsx`) | `last_goal_review_at` | **The same screen reads it back** to decide whether to re-prompt. The optimistic local write covers this mount only. |
| The password save (`edit-profile-sheet.tsx`) | `password_hash` → `hasPassword` | **That sheet reads this key itself.** A stale `false` re-offers "set a password" and stops asking for the current one. |
| `patchServer` (`lib/user/preferences-sync.ts`) | `preferences` | Nothing reads the bag back through this key today — which is exactly why it would be missed. |

All three are invisible while the key always revalidates. That is the point: the flag is what turns
a stale flash into up to 30 minutes of hard staleness, so the audit has to happen *before* it, not
after a bug report. It is the same shape as the equipped-title writer the earlier half of RV-183
found, and it is the third time this entry has turned one up.

The other two of the eleven cannot go stale here and are recorded at the call site rather than
"fixed": `friendCode` is generated inside `upsertUser` at sign-in and returned by that same call, and
`isActive` is an admin action on another account.

## And one bug I introduced and caught

The preferences fix was first written `void invalidateUserProfile()`. `pnpm test` passed 9,500 tests
and **exited 1 with 7 unhandled `ReferenceError: sessionStorage is not defined` rejections** — the
call sits inside a `.then` with no handler above it, and the cache layer throws outside a browser.
LB-168 documents a "`pnpm test` exits 1 with zero failures" flake, and attributing it to that would
have been the easy and wrong read; the error count went to zero with a `.catch`.

## Verified

- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **952 files, 9,500 passed, 0 errors, exit 0** · `pnpm build`.
- `e2e/profile-details-consolidation.spec.ts` + `profile-group-labelling.spec.ts` — **7 passing**,
  including *a name typed here persists*, which is the PATCH → invalidate → re-read path most at
  risk from the flag.
- **The four new assertions were each proved able to fail** against `origin/main`: all three files
  have zero `invalidateUserProfile()` calls there, and the profile slice has no `freshWithinTtl`.

## Two tests asserted the flag was ABSENT, and both were inverted

`rv183-more-seasons-ttl.test.ts` and `rv183-local-first-reminders.test.ts` each guarded "not eligible
yet — see LB-180". Inverting them is the point of the change, not a test being bent to fit: the
condition they guarded is resolved, and both now assert the flag is present, with the three writer
guards added beside them so a new writer fails CI rather than surfacing as staleness.

## Not exercised

- **The staleness window itself.** Nothing here waits 30 minutes to confirm a cached paint is served
  without a GET; the flag's behaviour is `cachedFetchCore`'s and is covered by its own tests.
- **The device.** No native, safe-area or gesture change. The three fixed writers are all reachable
  in the browser and were exercised there.

<a id="2026-09-29-fix-rv218-earned-not-burned"></a>

# 2026-09-29 — RV-218 ②: "burned" meant two numbers; Nutrition's movement header now says "earned"

**Lane A · `components/nutrition/energy-card.tsx`, plus the e2e assertion.**

- **Traced:** both screens' "burned" TOTALS already come from `computeEnergyBalance`. Day's energy
  timeline spreads `restingBaseKcal + activeKcal` from the same `/api/nutrition/energy-balance`
  response Home prints as `expenditureKcal`. The collision was Nutrition's header, "+237 burned",
  which is only the movement earned today. The Day screen's "Burned 1,694" is the whole day.
- **Changed:** the header now reads "+N earned", matching the "N earned from movement" line
  below. Verified on the owner's snapshot on 09-28 ("+369 earned") with `pnpm dev`. The e2e spec's
  assertion is updated and exact.
- **Not changed:** the budget's resting anchor (measured RMR) against expenditure's `restingBaseKcal`.
  That is BF-152's deliberate choice and part of the owner's LA-180 answer (RV-218 ①).

<a id="2026-09-29-fix-tn32-heart-rate-graded-by-profile"></a>

# TN-32 — the Heart Rate page alarmed at a rate inside the user's own Zone 1

**Branch:** `fix/tn32-heart-rate-graded-by-profile` · **Version:** 1.484.1

`app/health/heart-rate/page.tsx` graded with fixed cuts — `<60` Resting, `<100` Normal, else
Elevated — and painted the 60–100 band `#f87171`, a red the zone palette uses for nothing in that
range. It was the only place in the app a heart rate was graded without the user's own resting and
max.

For this owner that is most of a sitting day: resting 52, max 185, so Zone 1 runs to about 132 bpm
and every reading from 60 up was red while inside his own Recovery band.

## What shipped

`gradeHeartRate(bpm, profile)` in `components/health/hr-grade.ts`, pure and tested:

- the bands come from `computeHrZones` — the one place they are built — and the colour from the
  zone itself, never a second palette;
- a true resting rate reads **Resting**, using `HR_REST_THRESHOLD`, the same rest boundary Body
  Battery and the activity score use, rather than a fourth invented one;
- **with no profile there is no grade.** Returning null is the honest answer; inventing cuts is what
  this entry exists to remove, and the hero already rendered its label conditionally.

The page reads the profile through `useCachedValue('hr-profile', …)` — the same key, route and TTL
every other HR surface uses.

## Two things the checks caught

- **`check:rules` refused my first fetch.** I wrote a mount-time `cachedFetch` in a `useEffect(…, [])`
  and the fetch-once rule rejected it: that shape holds its first payload for the life of the
  process, so a resting-HR baseline that moved would grade against stale bands until the app was
  killed (Q-402). `useCachedValue` is what the rule prescribes and it is simpler.
- **My e2e stub took the whole screen down, and the control run is what proved it was the stub.**
  A thin `{ maxHr, restingHr }` body for `/api/hr-profile` produced *"Something went wrong — Cannot
  read properties of undefined (reading 'max')"*: `ObservedHrCard`, already on this page,
  dereferences the `observed` profile that response carries. Running the same spec against
  `origin/main`'s copy of the page reproduced it exactly, which is what separated "my change broke
  the page" from "my fixture did". Both stubs now overlay the real response and pin only the fields
  under test.

## Verified

- `components/health/__tests__/tn32-hr-grade.test.ts` — **7 tests**, including the entry's own pass
  test asserted as a sweep: no bpm anywhere inside Zone 1 carries the Peak colour, and every colour
  returned comes from `HR_ZONE_META`.
- `e2e/tn32-heart-rate-graded-by-profile.spec.ts` — **3 tests** at 412 px dark against the real page.
  78 bpm reads **Recovery**, "Normal" is absent, and the rendered colour is asserted **not** to be
  `rgb(248, 113, 113)` — the old red, read off `getComputedStyle`. Plus a genuinely high rate still
  grading Peak, and no grade at all when the profile fails.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **9,535 passed** · `pnpm build`.

## Not exercised

- **Real live HR.** Both the reading and the profile are injected; the seeded user has neither, and
  the hero renders an em-dash with no grade without them.
- **The device.** No native, safe-area or gesture change, but this is a colour change on a screen the
  owner reads daily, and Samsung WebView rendering is not covered here.
- **No screenshot.** The computed-colour assertion is a stronger check than an image for this
  particular fix, and it fails if the old red returns.

<a id="2026-09-29-fix-tn75-ai-baseline-marker"></a>

# 2026-09-29 — TN-75: AI-dynamic calibration sessions are stored as `baseline`

**Lane A · `packages/shared/src/workout/log-exercise.ts`. No migration.**

- **Why:** adherence reads could not tell a calibration set (no per-set plan, by design) from a lost
  plan, because `workout_sessions.phase_type` was NULL for AI-dynamic baseline sessions. The column
  and the `'baseline'` value already existed; the log path only ever checked the periodization
  state for `deload`.
- **Change:** it now applies `workout-data`'s own test (`phase === 'baseline' && !baselineComplete`),
  so the server and the workout screen agree this is a calibration session, and new sessions store
  `'baseline'`.
- **Side effect, measured before shipping:** the flag also routes the server's 1RM estimate through
  the AMRAP formula the client already used. On the real 09-07→09-12 round, 15 of 20 loaded logs are
  identical and 5 move by one 0.25 kg rounding step (mean 0.06 kg), computed with the repo's own
  `estimateOneRm` on production set data. `exercise-log-edits.ts` already keyed its recompute on
  `phase_type === 'baseline'`, so edits now agree too.
- **TN-75 leaves the queue:** ① is covered by LA-177's backfill and ② is this change. The bodyweight question stays as LA-169 (Lane O).
- **Not done:** historical sessions stay unmarked, so reads covering 09-07→09-12 still exclude that
  window by date.
- **Verified:** a log-exercise test (an unfinished baseline is stored as `'baseline'`, a finished
  one as nothing); the workout and log-exercise suites pass (329 tests); Custom Rules pass.
  **Not exercised:** a `pnpm dev` log inside an AI-dynamic baseline, which needs a seeded
  periodization state. The route is unchanged and the shared function is covered.

<a id="2026-09-30-docs-bf203a-device-first-replan"></a>

# 2026-09-30 — BF-203a paused after Task 5: the plan's last tasks target a read path the phone does not use

**Branch:** `docs/bf203a-device-first-replan` · **Lane A** · docs only.

Tasks 1–5 merged (#2001 migration, #2004 local v45, #2002 decision module, #2003 storage). No estimate
is written yet, so nothing the owner sees has changed.

Before building Tasks 6 and 8, the read paths were traced, and there are three blockers:
- The device reads answers from the local store and never calls the GET route Task 8 materialises in.
- The Nutrition ring's centre sums LOCAL food logs, while its zone bar, "Eaten" and "kcal left" use the
  server's `intakeKcal`. A server-only estimate would split one card, and that split already exists
  whenever local and server logs differ.
- The outbox push routes every `plan_meal_answers` mutation to the decline path, so a device estimate
  would land as a decline.

The corrected shape is on the BF-203a entry: materialise on the device, give the push branch an
estimate route, carry `est_*` through the pull, and count intake in both places the ring reads. Task 7's
guard must target `packages/shared/src/nutrition/adaptive-tdee.ts`; the plan's two paths do not exist.
How the ring marks assumed calories is filed as **LA-185** (Lane O, mockup owed).

<a id="2026-09-30-docs-lane-b-baton-queue-empty"></a>

# 2026-09-30 — Lane B's queue emptied, so the work became reconciling what was already in it

**Branch:** `docs/lane-b-baton-queue-empty` · docs-only, no version bump

`node scripts/next-item.js --lane B` returns **READY 0**, and that is a real state rather than a
stall. Three head items resolved three different ways in one session: `OR-206` shipped (#2027),
`OR-167` was decided against a build and removed (#2028), and `BF-183` turned out engine-first so its
storage half went to Lane A as `LB-199` (#2028). None was buildable here.

With nothing to build, the productive place is the KEEP list — and what it needed was not building.

## ⚑ Three entries were tracking ONE fault, with no link between them

**I caused the third of these, this morning, and it is the reason the other two surfaced.**

In #2023 I pulled `Received signal 11 SEGV_MAPERR 0000000001b0` out of an E2E artifact and wrote it
onto `LB-149` under the heading **"THE WITNESS ARRIVED"**. It is the **ninth** sighting.
`grep '0x1b0' docs/implementation-backlog.md` returns `LB-56`, which has carried that exact address
**since 2026-09-09, six times**, and which had already settled the mechanism I was treating as open:
its fourth sighting caught one test whose *attempt* died with the `SIGSEGV` and whose *retry* died
with `net::ERR_ABORTED`, proving the two signatures are downstream views of one crash.

**The cost is evidence, not pride.** The prior sightings date the fault to at least 2026-09-09
across eight runs, which supports "one reproducible code path" far better than a single run could,
and they say it predates everything shipped recently.

What that run genuinely added stands: the crash is in the **browser process**, through
`libglib-2.0`'s main loop rather than a renderer — which is why every later test in the shard then
fails to get a context — and a SIGSEGV is not a kill, so **OOM is out**.

Corrected `LB-149`'s novelty claim in place, added the ninth sighting to `LB-56`, and cross-linked
them.

## And the third entry had the answer in its own log

`LB-106` (`preferences-survive-reinstall` fails on CI, passes everywhere else) states **"no cause is
claimed"** — and two bullets earlier notes that the same run carried a `chrome-headless-shell`
segfault with `cr2: 0x1b0`, dismissed as *"runner instability … context for how loaded that run was
rather than a second bug to chase."*

That is the same address, and `LB-56` had already shown `ERR_ABORTED` is what a later test sees
**after the browser process is gone**. The dismissal is what left the entry hunting an app-side
cause that no inspection ever found — which also explains every property that made it baffling: it
never reproduces locally, and it lands on whichever spec navigates next.

**Not claimed as proven.** The segfault in that run was on a different spec and nobody has checked
whether it preceded line 53. The honest next step is written into the entry: re-read run
34814623905's log for a `Received signal` line *before* the abort. That is a read, not an
experiment, and it should happen before the relaunch reshape is treated as the fix.

## Also checked and confirmed NOT startable, so the next session does not repeat it

- **`BF-51` ①** (back from Edit exits the tab) — the fix is **built and deliberately held**: it
  destabilises `e2e/meal-photo-picker.spec.ts` reproducibly, and the entry says reproduce on the S25
  first, because `sheet-back-stack.ts`'s three previous bugs were every one of them found on a
  device. Recorded in the baton rather than re-derived next time.
- **`LB-106`** — its pass test is *ten* consecutive clean CI runs on that spec. I have observed
  about three and have **not** claimed it met.

## The baton

Rewritten in full, as always, and it stays inside its 59-line ratchet. It now carries the true
queue state, the checked-and-not-startable list above, and the lesson: **before writing up a log
signature as a new finding, grep the backlog for it.**

## Verified

`check-backlog-pointers` **522 entries, OK, no cycles, all `Needs:` targets known** ·
`check-doc-index-size` OK. No code changed.

## Not exercised

- **Nothing was run.** This PR is entirely reconciliation of existing entries against each other.
- **`LB-106`'s cause is still not established** — narrowed to a strong suspect with a named read
  that would settle it.

<a id="2026-09-30-docs-lb106-cause-is-the-browser-crash"></a>

# 2026-09-30 — LB-106's cause was in its own log for sixteen days

**Branch:** `docs/lb106-cause-is-the-browser-crash` · docs-only, no version bump

#2029 left one concrete unfinished read: whether `LB-106`'s CI-only `net::ERR_ABORTED` is
`LB-149`'s browser crash. It is, and establishing it took **one log fetch**.

## What was read

Job **103882629107** of run **34814623905** (2026-09-14). The job log is still retained sixteen
days on — the **artifact** is not, at `retention-days: 7`, which is worth knowing: for a
fortnight-old run the log is the only surviving evidence and it is enough.

```
1) [mobile-chromium] › e2e/preferences-survive-reinstall.spec.ts:36:5 …
   Error: page.goto: net::ERR_ABORTED at http://localhost:3100/
   …
   [pid=4243][err] Received signal 11 SEGV_MAPERR 0000000001b0
```

**The SIGSEGV is inside that spec's own failure block, at the same pid as the browser whose
`page.goto` aborted.** `plan-rescale`'s crash in the same run is a separate process, `[pid=5177]` —
so there were **two** crashes, one per failing spec, not one crash plus one mystery. That is
`LB-56`'s fourth sighting exactly: `ERR_ABORTED` is what the harness reports once the browser
process is gone.

## What is deliberately NOT claimed

The crash line is the last entry in that process's stderr and carries **no timestamp** — Chromium's
crash handler prints without the `MMDD/HHMMSS` prefix its console lines have — so the log alone
cannot order the SIGSEGV against line 53's `goto`. **The attribution is Playwright's**, which
reports that browser's stderr under that test's failure, not an ordering I measured. Strong enough
to stop hunting an app-side cause; not strong enough to call the sequence proven, and the entry says
so in those words.

## Three things follow

1. **The relaunch reshape is not the fix.** It is defensible on fidelity, as its own note argues,
   but it cannot address a browser that died.
2. **The service-worker block should go.** The spec's header carried an explicit falsification —
   *"If the abort returns, the SW was not it"* — the abort returned with the block in place, and it
   is now justified by nothing.
3. **`LB-106` is no longer its own investigation.** It is a symptom of `LB-149`, whose remedy is a
   harness decision (a Playwright/Chromium bump, or a flag), and its ten-clean-runs pass test
   measures the runner's luck rather than anything the spec does. `LB-149` now says it owns this.

## Why this is worth a session's tail

`LB-106` is dated 2026-09-14 and carries a careful, correct investigation: it ruled out `storage`
listeners, `location.assign`, and `beforeunload` by reading rather than guessing, and it refused to
lengthen the poll timeout. All of that was sound and none of it could succeed, because the fault was
never in the app. **The one thing not done was reading the rest of its own log** — and the entry
even quotes the crash, two bullets above "no cause is claimed", filed under *"runner instability …
context for how loaded that run was rather than a second bug to chase."*

That is the same shape as this morning's `LB-149` error, inverted: there I wrote a signature up
without grepping for it; here the signature was in hand and read as background. Both are cheap
lookups skipped next to expensive reasoning.

## Verified

`check-backlog-pointers` OK · `check-doc-index-size` OK. No code changed.

## Not exercised

- **Nothing was run.** One archived CI log was fetched and read.
- **The ordering within the crashed process** — see above; it is Playwright's attribution, not a
  measured sequence.

<a id="2026-09-30-docs-or167-keep-both-icon-libraries"></a>

# 2026-09-30 — OR-167 was answered "keep both", so it leaves the queue without code

**Branch:** `docs/or167-keep-both-icon-libraries` · docs-only, no version bump

`OR-167` proposed dropping `@phosphor-icons/react` and moving its five glyphs onto lucide. **The
owner answered on 2026-09-30: keep both — against the recommendation.** He declined to change icons
on screens he reads *mid-run* for a dependency saving, and the size numbers were put to him when he
decided, so the measurement is not a reason to re-ask.

That leaves nothing to build. Per CLAUDE.md — *"if it's superseded or already done, remove the
backlog entry via a docs-only PR with a one-line note on why, instead of forcing a mismatched
implementation just to clear the queue"* — it is removed rather than implemented.

## Re-verified before writing the note that outlives the entry

The entry's figures are from 2026-09-25 and still hold on `main`:

- `lucide-react` — **276** importing files (the entry said 270).
- `@phosphor-icons/react` — **six**: five under `components/activity/**` plus
  `packages/shared/src/constants/activity-icons.ts`.

## The consequence, written where it will be hit

The decision leaves a real gap the entry named itself: **two icon sets ship and nothing says which
to reach for.** A closed backlog entry is not where a future contributor looks, so that went into
[`docs/module-map.md`](../module-map.md) — which exists to answer "what already exists and where"
before new work starts — as a row saying lucide is the default, phosphor is frozen to those six
files, and swapping one of the five is a **look change on a daily screen** needing a 384 px
before/after and his yes, not a cleanup.

If the two-set inconsistency ever becomes a real problem, that is a new entry about consistency, not
a re-run of this one.

## Verified

`check-backlog-pointers` **521 entries, OK** · `check-doc-index-size` OK. No code changed.

---

# Also here: BF-183 routed, because it named its own lane wrong

With `OR-167` cleared, `BF-183` became the Lane B head. **It is not buildable here**, and the entry
says so in its own body — *"this is a schema change and therefore Lane A's to land"* — while
carrying `Lane: B`.

That is the shape CLAUDE.md warns about outright: **the lane field routes work and prose does not.**
The engine half would have sat in Lane B's queue until someone read the paragraph. Split into
**`LB-199`** (Lane A: the stored `suitableMealTypeIds`, its local-SQLite mirror, and the history
seed), with `BF-183` keeping the render half and parked on it via `Needs:`.

Both entries ride in this PR rather than a second one, for the reason the filing-sweep rule gives:
two docs-only PRs editing `docs/implementation-backlog.md` minutes apart is a conflict waiting to
happen, and neither is a code change.

## The open question it left for the implementer, answered by reading the file

`BF-183` asked whether the affinity is computed server-side or client-side and said to
**"decide by checking what `saved-meals-sheet` already fetches"**. Checked:
`components/nutrition/saved-meals-sheet.tsx` fetches exactly two things — `saved-meals` and
`nutrition-meal-types` — plus a local-first `store.getSavedMeals()`. **It holds no log history at
all.** So client-side is not a trade-off, it is a new fetch on a screen that does not want one:
**server-side, on the saved-meals payload.**

That read also surfaced something the entry did not say: the sheet is **local-first**, so the local
SQLite mirror is not optional. Without it the tags vanish offline on a list that otherwise works
offline — the offline-first inversion CLAUDE.md names as a recurring bug class.

## A contradiction inside the entry, reconciled

`BF-183` was answered *"LUCIDE ICONS, not the emoji — against the recommendation"*, and its body
still argued at length for the emoji, ending **"still the recommendation: use the meal type's own
emoji."** Struck, with the reasoning kept visible so the next reader learns it was already argued
rather than re-opening it.

What survives the strike is the **risk**, which is now the build's acceptance test rather than an
argument: a row may show four glyphs at once, in a vocabulary he has not been trained on, at a row's
icon size. And one thing the answer leaves genuinely unsolved — **lucide has no glyph for a
user-created meal type**, where the user-set emoji always did. This account has carried an
*"Afternoon Meal"*. The fallback has to be decided before building rather than discovered when a
type renders nothing.

## Lane B READY is 0 after this, and that is a real state

Three head items, three different outcomes: `OR-206` shipped (#2027), `OR-167` decided against a
build, `BF-183` is engine-first and now Lane A's. None of them was buildable here today.

## Verified

`check-backlog-pointers` **522 entries, OK, no cycles, all `Needs:` targets known** ·
`check-doc-index-size` OK · `next-item.js` confirms `LB-199` in Lane A and `BF-183` parked on it.
No code changed.

<a id="2026-09-30-docs-or174-branch-count-refresh"></a>

# 2026-09-30 — a refreshed branch count, and the baton line my own next PR made stale

**Branch:** `docs/or174-branch-count-refresh` · docs-only, no version bump

Lane B's queue is empty and this is the last useful thing in reach. Two small corrections, both of
them things that were true when written and are not now.

## OR-174's count has grown, and it was measured properly

`OR-174` recorded **45 branches, 39 sweepable** on 2026-09-27. Measured today: **54 non-main remote
branches, 7 with an open PR, so 47 sweepable.**

Two things about *how*, because this entry's own lesson is that the method is where it goes wrong:

- **After `git fetch origin --prune`.** A partial fetch under-counts — my first read said 53 and was
  missing a branch whose PR is open, because I had only fetched `main`.
- **The open-PR figure is from `list_pull_requests`**, not from a name match. `OR-174` exists partly
  because an earlier pass called four branches live work on a name match and not one of them held
  anything.

**None of the 7 open PRs is this lane's**, and four are explicitly held for the owner (#1902, #1849,
#1847, #1499 — auth/security and column-dropping migrations), so a sweep must not touch them.

**Two branches are named `claude/…`**, which the owner banned outright on 2026-09-27. Neither has an
open PR, so both fall inside the sweep rather than needing their own decision — worth naming because
they are the visible half of that rule on a public repo.

## What I deliberately did NOT do

**I did not sweep.** Deleting 47 remote branches is a wide-blast-radius action on a public repo, it
belongs to `OR-174` (Orchestrator's), and that entry itself records the first application of the
rule being wrong about four branches. A refreshed count is what a passing lane can usefully
contribute; the deletions are not.

## The baton line that went stale between two of my own PRs

#2029's baton rewrite recorded `LB-106` as *"pass test is ten clean CI runs; ~3 observed"*. **#2030
then resolved it** — its cause is named, and it is a symptom of `LB-149` rather than its own
investigation. Corrected, because the baton is what survives a compaction and a stale line in it
sends the next session to re-investigate something finished.

Worth noting as a pattern rather than a one-off: **a baton written mid-session describes the session
as it was, not as it ended.** Re-read it before the last PR, not only when rewriting it.

## Verified

`check-backlog-pointers` OK · `check-doc-index-size` OK, baton at 59 within its ratchet. No code
changed.

## Not exercised

- **Nothing was run.** Two counts and a documentation correction.

<a id="2026-09-30-docs-or206-vs-normal-routing"></a>

# 2026-09-30 — the head of Lane B's queue held three items, and none of them was Lane B's

**Branch:** `docs/or206-vs-normal-routing` · docs only, no code.

`node scripts/next-item.js --lane B` printed **5 READY** with `OR-206` at the head and `TN-67`
second. Re-verifying both against `main` before starting — the standing rule that a plan can go
stale while it sits in the queue — found that **neither could be started from Lane B**, for the same
reason in both cases: the buildable half is an engine, and this lane owns surfaces. Routing them
took Lane B's READY list from 5 to 3, and every remaining one is genuinely startable.

## `OR-206` — the rename is a schema change, and the question inside it was invisible

The entry asks for one copy change (*"Compared to yesterday"* → *compared to normal*) and attaches
two things to it. Both belonged elsewhere, and CLAUDE.md names each case outright.

**① The field rename and the history marker are Lane A's alone.** `vs_yesterday` reaches
`schema.ts`, `adapter.ts` (five sites, including an `EXCLUDED.vs_yesterday` upsert), two API routes,
two `packages/shared` files, three `lib/local-store` files, `lib/sqlite/migrations.ts` and
`claude-ro-views.sql` — reached by grep and confirmed by `tsc`. A Postgres migration and a local
SQLite version are Lane A's by rule, and the rule says the finding agent **stops and hands the item
over**. Filed as **`LB-190`** (`Lane: A`), with `OR-206` waiting on it via `Needs:`.

It has to lead rather than follow, which is the part worth keeping: **the copy change is what makes
the stored answers ambiguous.** Rows written before it answer *"vs yesterday"*, rows after answer
*"vs normal"*, and the entry is right that they must not be pooled — the field feeds a scoring
input. A deploy date cannot mark the boundary exactly, because Railway ships on merge and one local
day can hold rows from both sides of the cutover, so `LB-190` recommends a stored question-version
integer, the shape `SLEEP_VERDICT_MODEL_VERSION` already set on this same sheet.

**② The default-selection question was an owner decision living inside a `Lane: B` body**, where the
Orchestrator was never going to see it — the exact trap CLAUDE.md describes, and the one `RV-208`
already hit when its Lane A half stayed described in a Lane B entry until it moved out to `LB-183`.
Filed as **`LB-191`** (`Lane: O`, **ungated** — `Gate: owner` would park it out of the READY list,
and getting the answer *is* the work), with the brief written in the shape the decision rule asks
for: recommendation first, the alternative and what it is genuinely better at, reversal cost.

The recommendation is to ship the rename with **no** default and offer him `TN-82`'s
announce-and-correct shape instead, because the measured record here is unambiguous: `wake_mood`
collected 17 answers then zero, the 1–5 sleep scale 3 of 82, `vs_yesterday` itself 2 of 82, and
`perceived_recovery` **0 touched in 102 check-ins**. A pre-selected neutral makes a reflexive Save
indistinguishable from a considered *"about the same"*. His actual ask — not tapping three things on
a normal morning — is what the sleep announcement already solves on this sheet.

## `TN-67` — "Now Lane B" pointed at an engine that does not exist

The entry's own `Lane:` field says *"nothing to build"*; a ✅ block added on 2026-09-27 says
*"Now Lane B"* for an outlier-gated rating prompt and to *"copy `OR-171`'s threshold"*. So it printed
second on an implementer's READY list carrying, between its two halves, no implementable work.

**Checked by listing the directories rather than by reading around it:**
`packages/shared/src/health/` holds `sleep-verdict.ts`, `readiness-composite.ts` and
`live-readiness.ts`; `app/api/` holds `sleep-verdict` and `readiness-score`. **There is no readiness
equivalent of either half** — no trailing-window outlier rule, and no route a sheet could ask *"is
today unusual?"*. `OR-171`'s threshold is `VERDICT_IQR_MULTIPLIER` inside a `packages/shared` engine
reaching its surface through `/api/sleep-verdict`. Engine-first, both files Lane A's. Filed as
**`LB-192`** (`Lane: A`) and **`LB-193`** (`Lane: B`, `Needs: LB-192`), and `TN-67` re-laned to `T`,
since what remains in it is the dated re-measurement its own last line assigns to Tuning.

**⚠ Two things carried into `LB-192` that reading the entry alone would have lost.** Its instruction
to copy the threshold must not become copying the number: `VERDICT_IQR_MULTIPLIER` is 1.0 because it
was swept to 4–6 prompts a month over the owner's own nights, and `TN-83` records that the first
sweep used the wrong population (raw `sleep_sessions` rows, naps included) and so understated how
loud the rule was. Readiness has its own spread; the rate is the target and the multiplier is only
how it is reached.

And the two owner-approved designs genuinely collide, which `LB-193` says rather than resolves
silently: `TN-67` asks for a **prompt** on outlier days, while `OR-171` — the entry it says to copy
— concluded it should **not ask at all**, and `TN-82` shipped that. An outlier-gated question is a
fourth affordance on a sheet where asking has failed four times. `LB-193` recommends gating the
existing prompt's *prominence* rather than its existence, reusing `SleepAnnouncement`'s two tiers.

## Verified

`node scripts/check-backlog-pointers.js` — **522 entries, no duplicates, all tagged, 82 `Needs:`
with no cycles and all targets known**, exit 0. `node scripts/next-item.js --lane B` — READY 5 → 3,
with `LB-193` correctly parked behind `LB-192`.

## Not done

**No code, deliberately.** Every buildable half named here is filed for the lane that owns it; none
of it was started in this PR. `LB-191` is a question and is nobody's to answer but the owner's.

<a id="2026-09-30-feat-bf138-energy-model-explainer"></a>

# 2026-09-30 — BF-138: say where the calorie numbers come from

**Branch:** `feat/bf138-energy-model-explainer` · v1.486.3. **No calculation is touched.**

Owner, after four screens showed four figures: *"I thought it was eat to 1350 + excercise amount
right? im getting confused- can we have a central idea of everything"*.

## Re-verifying the entry found most of it already built

BF-138's recommendation is *"one explainer, reachable from every number it explains … not a tooltip
per surface — that is how three surfaces came to describe the same model in three vocabularies"*.

**That explainer exists.** `components/nutrition/energy-explainer.tsx` is one shared component
rendered by both surfaces that show these figures, and its own docstring records that it was created
because `energy-card.tsx` and `calorie-balance-bar.tsx` each held the same paragraphs inline and had
already drifted. It postdates the entry. **Building a fresh explainer would have produced a third
copy of the thing the entry complains about.**

So the work was the three things it did not yet say — all from values already passed to it.

## What was added

**① The chain from the number he knows to the number on screen.** He knows his own measured resting
rate, saw a different base, and reasonably suspected an error; every step between was sound and
stated nowhere. Now stated endpoint to endpoint — `restingRateKcal` → `restingBaseKcal` — with the
steps between in words. **Deliberately not as figures:** the ×1.2 multiplier and the step credit are
intermediates this payload does not carry, and deriving them client-side would be the second
implementation of a calculation this entry forbids touching.

**② "Why two numbers", generalised.** BF-134 added that block to `tdee-adaptation-card` behind
`source === 'formula' && drifts`, so the reconciliation was missing from the surfaces where the
numbers actually appear. It now names the saved goal beside today's budget wherever they differ by
≥100 kcal, and **states the relationship rather than picking a winner** — which is right is a
calibration question `BF-137` and `TN-29` own, and this entry must not answer it.

**③ What is actually measured.** The entry's sharpest point: *"the most useful sentence available to
this owner is not any estimate — it is 'your weight was flat across 29 days'"*. That now closes the
panel, distinguishing the one observation from the estimates above it.

## The browser test earned its place three times over

All three paragraphs are conditional, and `BF-220` the previous day showed what that costs: copy
mounted where it cannot be seen is the same defect as no copy, and no unit test finds it. So each is
asserted present when its guard holds and **absent when it does not**, the absent case anchored on a
line that is not conditional so it cannot pass by having failed to open the panel.

Three things the run taught that reading the source did not:

- **Without `ensureEnergyBalanceProfile()` the panel never mounts.** The route answers
  `balance: null` for the seeded user, who is missing only a date of birth, and the card renders
  *"Add your date of birth in Profile"*. `fixtures.ts` already records this as why `Q-402`'s fix could
  not be driven end to end.
- **⚠ Two controls share the accessible name `"How energy balance is calculated"`** —
  `energy-card.tsx:218` and `calorie-balance-bar.tsx:75` — and the tab shell keeps both trees
  mounted. A document-wide `.first()` clicked the **off-screen** one for 60 seconds while
  `aria-expanded` stayed `false`, which reads as a dead button and is a mis-aimed one: the class
  `tapInView` exists for. **Filed as `LB-189`, not fixed here** — renaming a control is a product
  change outside this entry's scope.
- **The panel's open state is local to a card that revalidates in the background**, so one click
  followed by an assertion is a race; the retry waits on `aria-expanded` rather than sleeping.

## Verified

`e2e/bf138-energy-model-explainer.spec.ts` — **2 passing**: one test on the guards-on payload, one on
the guards-off one. `npx tsc --noEmit` · `pnpm check:rules` **Ran 84 of 84** · `pnpm test`
**11,044 passed** · size gate clean.

> **Corrected 2026-09-30 (LB-189).** This said **"4 passing (2 tests × the guards-on and guards-off
> payloads)"** and the file holds **two** `test()` blocks, one payload each. The 4 was Playwright's
> run total, which counts the `auth.setup.ts` and `zero-data.setup.ts` projects alongside the specs —
> so every spec run in this repo reports two more than it has. `grep -c '^test('` is the count to
> quote. The same slip is corrected in `2026-09-29-chore-bf220-rpe-reaches-nothing.md`.

## Not exercised, and one thing deliberately not done

- **The device.** This is an ⓘ panel of dense small text; whether five paragraphs plus three new ones
  still reads on the S25 is a look, and no container can answer it.
- **The real numbers.** The spec overlays the payload, so the paragraphs were proven to render from
  *given* values. The owner's actual figures come from his own profile.
- **The file sits below RV-209's 11px type floor throughout** (`text-[10px]`, on every paragraph).
  That guard only scans `components/workout/`, so nothing stopped me matching it — and matching it is
  what I did, because converting the panel is a visible restyle of a screen he uses and smuggling it
  into a copy-only PR is the wrong way to make that change. It wants its own entry or to ride with
  the next deliberate pass over this surface.

<a id="2026-09-30-feat-bf203a-answer-readers"></a>

# 2026-09-30 — BF-203a Task 6′: the device reads an estimate as an estimate

**Branch:** `feat/bf203a-answer-readers` · **Lane A** · the first of the device-first tasks. Still
nothing writes an estimate, so nothing the owner sees changes.

## What changed

- **Only a `'no'` is a decline.** `use-plan-meal-logging.ts` fed every answer row to the declined
  set, on both the store and the API branch. An estimate there would have hidden the prompt it
  stands in for.
- **One live answer per meal and day, on the device.** `upsertPlanMealAnswer` now updates an existing
  live row for the same meal and day instead of inserting beside it. A decline over an estimate
  replaces it and clears `est_*`, mirroring #2003's server fix.
- **`est_*` travels the whole pull:** the server delta map, the client pull mapper, `applyDelta`
  (behind the same `sync_status='synced'` gate as every other column), `getPlanMealAnswers`, and
  `LocalPlanMealAnswer`.

## Verified

- `bf203a-local-answers.test.ts` runs the shipped `SQLiteLocalStore` on a schema built from
  `MIGRATIONS`. It covers the estimate round-trip, a decline replacing an estimate as one row, and
  macros surviving a pull. It also pins the two hook call sites.
- Local-store, nutrition, sync and plan-meal-answer suites, with LA-137 over a real database: 313 passed.
  Test typecheck is clean, and `check:rules` ran 86 of 86.
- `pnpm dev` on the owner's snapshot, with a seeded estimate: `/api/sync/pull` and
  `GET /api/nutrition/plan-meal-answers` both return it with its macros.

## Not exercised

Native SQLite on the APK. The `node:sqlite` run executes the same SQL strings, but not the Capacitor
bridge.

<a id="2026-09-30-feat-bf203a-device-materialiser"></a>

# 2026-09-30 — BF-203a Task 8′ (1–2): the device writes estimates, and the server accepts them

**Branch:** `feat/bf203a-device-materialiser` · **Lane A** (engine + one hook, per the "both → A" rule).
Estimates are now RECORDED; **no total counts them and nothing displays them** until LA-185 is
answered (Task 8′ 3–4).

## What shipped

- **`packages/shared/src/nutrition/plan-variant.ts`:** `pickPlanVariant`, moved out of
  `meal-plan-section.tsx` so the card and the estimator use one chooser. `variantForEstimates` returns
  null for a split plan whose day type is unknown. The display fallback (rest) is harmless to look at
  and wrong to count.
- **`estimateSlotsFor`** (`meal-estimate.ts`): a variant's meals become slots, typed by LA-172's rule
  with close hours from `slotCloseHour`. A meal it cannot place in time is left out.
- **The device materialiser** (`use-plan-meal-logging.ts`): runs before the answers read, for today
  only and with a local store only. It writes each due estimate locally plus to the outbox, carrying
  its row id. `ActivePlanCard` now passes LA-184's `isTrainingDay` to the hook.
- **`loggedPositions` read `variants[0]`**, which is LA-184's sibling. It now uses the variant the card
  shows.
- **Push branch** (`adapter.ts`): an `answer: 'estimated'` mutation goes to `saveClientEstimate`. That
  runs the same two-level ownership join as a decline, then `upsertEstimatedAnswers` under the device's
  id. An estimate without calories is rejected per item and not retried. Before this, every
  `plan_meal_answers` mutation went to the decline path.

## Verified

- Unit: `plan-variant.test.ts`, three `estimateSlotsFor` cases. The LA-184 source pin now points at the
  shared chooser. Real Postgres: device push stored under its id, replay is a no-op, no estimate over a
  decline, missing calories and a foreign meal are both rejected. Nutrition, shared and local-store
  suites: 1084 passed. tsc, test typecheck and lint are clean, and `check:rules` ran 86 of 86.
- `pnpm dev` on the owner's snapshot, with a temporary plan created through the API:
  `/api/sync/push` stored the estimate under the device id, `GET /api/nutrition/plan-meal-answers`
  returned it with its macros, and declining it returned the same row as `'no'` with macros cleared.
  The plan and rows were removed afterwards.

## Not exercised

The materialiser itself, which runs only with a native local store (APK). The owner has no active plan,
so on his phone it does nothing until he makes one. Known-Issues row updated.

<a id="2026-09-30-feat-bf203a-estimate-decision"></a>

# 2026-09-30 — BF-203a Tasks 3–4: which plan meals are owed an estimate

**Branch:** `feat/bf203a-estimate-decision` · **Lane A** · pure module, not wired to anything yet.

## What shipped

`packages/shared/src/nutrition/meal-estimate.ts`:
- `dueForEstimate`: a slot is owed an estimate once it is over, when no food of its meal type is
  logged and no live answer exists. The bias is spread in proportion to slot size, never below 0 kcal.
- `slotCloseHour`: when a slot is over.

## Two corrections to the plan

1. **Matching is by meal type, and a logged meal satisfies every slot of its type.** The plan passed
   `loggedPlanMealIds`, which no caller can build, because `food_logs` has no plan-meal id. When two
   slots share a type, one goes un-estimated rather than both counting on top of real food. This
   under-counts by one meal and never double-counts.
2. **A slot closes at the later of its type's end and an hour past its suggested time.** LA-172 files
   the owner's 16:20 meal under the nearest window (Lunch, 12–15), so the plan's "type end" would
   have estimated it at 15:00, before it was due. A type ending at 24 never closes the same day, so
   that slot is not estimated. That is accepted: the plan only estimates today.

## Verified

`meal-estimate.test.ts`: 13 passed. It includes the plan's user-local boundary cases, run in a
fixed-offset zone so they fire on every CI run.

<a id="2026-09-30-feat-bf203a-estimated-answer-migration"></a>

# 2026-09-30 — BF-203a Task 1: `plan_meal_answers` can hold an estimate

**Branch:** `feat/bf203a-estimated-answer-migration` · **Lane A** · migration only, shipped alone per
the plan. `BF-203a` stays in the queue for Tasks 2–9.

## What shipped

- Migration `202609292220_plan_meal_answer_estimated.sql`: six nullable `est_*` columns, the
  `answer` CHECK widened from `('no')` to `('no', 'estimated')`, and
  `plan_meal_answers_estimate_shape` (an estimate carries calories; a decline carries none).
  Additive and reversible, and it rewrites no rows.
- `schema.ts` columns; `claude-ro-views.sql` regenerated from a scratch database built from
  migrations. The diff is exactly the six columns.

## Correction to the plan

The plan's migration added the shape constraint but never widened migration 187's
`CHECK (answer IN ('no'))`, so no estimate could ever have been inserted. It was caught by reading
the live constraint before writing the migration.

## Verified

- `bf203a-plan-meal-answer-estimated.test.ts` (real Postgres) passes, with the sibling meal-plan
  suites: 37 passed.
- `claude-ro-readonly-role` + `db-snapshot-integration` over TCP: 34 passed, none skipped.
- Applied to the owner's snapshot: it applied cleanly (he has no answer rows).
- tsc, test typecheck, and `check:rules` (84 of 84) all pass.

## Not exercised

Nothing writes an `estimated` row yet, so no reader has changed behaviour. The readers that assume
every row is a decline are called out on the entry, to fix before Task 5.
